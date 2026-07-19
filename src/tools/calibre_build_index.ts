// calibre_build_index (WRITE) — build the semantic embeddings index for a chosen set of
// books. A selector (bookId | ids | query) is REQUIRED: full-library indexing is deferred
// (it's a ~1-2h job), so this slice never indexes everything by default. Each book is
// extracted (reusing calibre_get_content's cache), chunked, embedded, and persisted; a
// deterministic "[title › authors]" prefix gives each chunk cheap document context.
// Per-book failures are collected, not fatal. The write gate disables this tool by default.

import { z } from "zod";
import { chooseExtractFormat } from "../calibre/extract.js";
import { frontMatterEnd } from "../domain/structure/chapters.js";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "./resolve-id.js";
import { INSTALL_TRANSFORMERS } from "./remediation.js";
import { toolError, toolOk } from "./result.js";
import type { IndexedChunk } from "../semantic/store.js";
import type { ToolDeps } from "./types.js";
import type { EmbedChunk } from "../semantic/chunk.js";
import { chunkForEmbedding } from "../semantic/chunk.js";
import { MAX_TOKENS, PASSAGE_PREFIX } from "../semantic/model.js";

/** Cap on books selected by a query, so a broad query can't kick off a huge build. */
const MAX_QUERY_BOOKS = 100;

/** Floor on the token budget — a pathologically long title/authors prefix can't starve chunks. */
const MIN_TOKEN_BUDGET = 64;

export const buildIndexTool = defineTool({
  name: "calibre_build_index",
  title: "Build semantic index",
  description:
    "Build the semantic index for specific books (required: bookId, ids, or query — full-library indexing is deferred). Extracts, chunks, and embeds each book. Set keywordOnly=true (or when the embedding model is absent, it happens automatically) to build a keyword-only index that powers mode:\"keyword\" search with zero ML dependencies. Re-run after adding books; use force to re-index unchanged ones.",
  inputSchema: {
    bookId: BookId().optional(),
    ids: jsonArray(BookId()).optional(),
    query: z.string().max(512).optional(),
    library: z.string().optional(),
    force: CoercedBool().default(false),
    enableFts: CoercedBool().default(false),
    keywordOnly: CoercedBool().default(false),
  },
  outputSchema: {
    booksRequested: z.number().optional(),
    booksIndexed: z.number().optional(),
    booksSkipped: z.number().optional(),
    chunks: z.number().optional(),
    elapsedMs: z.number().optional(),
    keywordOnly: z.boolean().optional(),
    // Degradation surfacing (issue #41): false whenever the built index has no embeddings —
    // requested (keywordOnly=true) or auto-degraded — with the reason spelled out.
    semanticAvailable: z.boolean().optional(),
    semanticReason: z.string().optional(),
    failures: z.array(z.string()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  // readOnlyHint:false but NOT write-gated: this writes to the server's own index dir, not the
  // user's library, so the library write gate doesn't apply. localWrite marks that carve-out.
  localWrite: true,
  handler: async (args, deps) => {
    if (args.bookId === undefined && !args.ids?.length && !args.query) {
      return toolError("Specify bookId, ids, or query — full-library indexing is deferred.");
    }

    const started = Date.now();
    const notes: string[] = [];
    const failures: string[] = [];
    let libraryId: string;
    try {
      libraryId = await deps.content.resolveLibraryId(args.library);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }

    // Resolve the target set (deduped, preserving discovery order).
    const targets = new Set<number>();
    if (args.bookId !== undefined) {
      const n = await resolveNumericId(deps, args.bookId, args.library);
      if (n === undefined) failures.push(`bookId ${args.bookId}: not found`);
      else targets.add(n);
    }
    for (const raw of args.ids ?? []) {
      const n = await resolveNumericId(deps, raw, args.library);
      if (n === undefined) failures.push(`id ${raw}: not found`);
      else targets.add(n);
    }
    if (args.query) {
      const page = await deps.content.search({ query: args.query, library: args.library, num: MAX_QUERY_BOOKS });
      for (const id of page.bookIds) targets.add(id);
      if (page.total > page.bookIds.length) {
        notes.push(`query matched ${page.total} books; indexing the first ${page.bookIds.length} (cap ${MAX_QUERY_BOOKS}).`);
      }
    }

    const booksRequested = targets.size;
    if (booksRequested === 0) {
      return toolError(`No books resolved from the selector. ${failures.join("; ")}`.trim());
    }

    // Decide the build mode up front. keywordOnly skips the model entirely; otherwise probe
    // the embedder once (warmup does the lazy dynamic-import) so a no-embeddings install
    // degrades to a keyword-only index instead of failing every book (the model-free default).
    let keywordOnly = args.keywordOnly;
    // Why the index has no embeddings (mirrored into structuredContent as semanticReason).
    let semanticReason: string | undefined;
    // The auto-degrade warning LEADS the text block — an automatic downgrade must never
    // read as an unqualified success (issue #41: keywordOnly:true + failures:[] looked fine).
    let degradeWarning: string | undefined;
    // Token budgeting needs a LOADED tokenizer — only true after a successful warmup.
    let tokenBudgeted = false;
    if (keywordOnly) {
      semanticReason =
        "keywordOnly=true requested — no embeddings built; vector & hybrid semantic search need an embedding rebuild.";
      // semanticReason stays short (machine-scannable); the full 3-branch fix goes in the note text.
      notes.push(
        `Keyword-only index (no embeddings): mode:"keyword" search works now. For vector & hybrid semantic search: ${INSTALL_TRANSFORMERS} Then rebuild with force=true.`,
      );
    } else {
      try {
        await deps.embedder.warmup();
        tokenBudgeted = true;
      } catch (err) {
        if (isEmbedderUnavailable(err)) {
          keywordOnly = true;
          semanticReason =
            "embedding model (@huggingface/transformers) unavailable — automatically degraded to a keyword-only index (no vectors).";
          // Must LEAD the text block (test-asserted at index 0) and carry the universal fix (#47).
          degradeWarning =
            `Embedding model unavailable — built a KEYWORD-ONLY index instead (mode:"keyword" search works now). ${INSTALL_TRANSFORMERS} After restarting, rebuild with force=true for vector & hybrid semantic search.`;
        }
        // Other warmup errors (e.g. a download hiccup) fall through — the per-book embed
        // attempt below surfaces them as collected failures (char-budget chunking applies).
      }
    }

    // Pre-warm the reranker on embedding builds (D-011): its one-time ~576 MB download lands
    // inside the build users already expect to be slow, not on the first search. Best-effort —
    // a failure logs to stderr + a note and NEVER fails the build. Keyword-only builds and
    // CALIBRE_MCP_RERANK=off installs skip it (nothing would use the model).
    if (!keywordOnly && tokenBudgeted && deps.reranker && deps.config.rerankEnabled) {
      try {
        await deps.reranker.warmup();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        deps.log.warn("reranker pre-download failed", { reason });
        notes.push(
          "Reranker model could not be pre-downloaded — the first hybrid/vector search will retry (until then results keep the fused order).",
        );
      }
    }

    let booksIndexed = 0;
    let booksSkipped = 0;
    let totalChunks = 0;
    for (const bookId of targets) {
      try {
        const n = await indexBook(deps, libraryId, bookId, args.force, args.library, keywordOnly, tokenBudgeted);
        if (n === "skipped") booksSkipped++;
        else {
          booksIndexed++;
          totalChunks += n;
        }
      } catch (err) {
        failures.push(`book ${bookId}: ${describeError(err)}`);
      }
    }

    if (args.enableFts) {
      notes.push("enableFts is accepted but not yet implemented in this version (semantic-only index).");
    }

    const elapsedMs = Date.now() - started;
    // Surface the first few failure reasons in the text block — clients that ignore
    // structuredContent would otherwise only see an opaque "N failed".
    const failureLines = failures.slice(0, 3).map((f) => `\n- ${f}`);
    if (failures.length > 3) failureLines.push(`\n- …and ${failures.length - 3} more`);
    const summary =
      (degradeWarning ? `${degradeWarning}\n` : "") +
      `${keywordOnly ? "Keyword-only indexed" : "Indexed"} ${booksIndexed}/${booksRequested} book(s) (${booksSkipped} up-to-date, ${totalChunks} chunks) in ${elapsedMs} ms.` +
      (failures.length ? ` ${failures.length} failed:${failureLines.join("")}` : "") +
      notes.map((n) => `\n- ${n}`).join("");

    return toolOk([{ type: "text", text: summary }], {
      booksRequested,
      booksIndexed,
      booksSkipped,
      chunks: totalChunks,
      elapsedMs,
      keywordOnly,
      semanticAvailable: !keywordOnly,
      ...(semanticReason !== undefined ? { semanticReason } : {}),
      failures,
    });
  },
});

/** Index one book. Returns the chunk count, or "skipped" when already up to date. */
async function indexBook(
  deps: ToolDeps,
  libraryId: string,
  bookId: number,
  force: boolean,
  library: string | undefined,
  keywordOnly: boolean,
  tokenBudgeted: boolean,
): Promise<number | "skipped"> {
  const book = await deps.content.getBook(bookId, library);

  if (!force && deps.index.isBookIndexed(libraryId, bookId, book.lastModified ?? "")) {
    return "skipped";
  }

  const fmt = chooseExtractFormat(book.formats);
  if (!fmt) {
    const avail = book.formats.length ? book.formats.join(", ") : "none";
    throw new Error(`no extractable text format (available: ${avail})`);
  }

  const base = deps.config.serverUrl.replace(/\/+$/, "");
  const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${bookId}/${encodeURIComponent(libraryId)}`;
  const cacheKey = `${bookId}:${fmt}:${book.lastModified ?? ""}`;
  const extracted = await deps.extractor.getText({ bookId, format: fmt, downloadUrl, cacheKey });

  if (extracted.text.trim().length === 0) {
    throw new Error(`no extractable text (${fmt}) — likely a scanned/image PDF (no OCR)`);
  }

  // Deterministic context prefix — captures most of contextual-retrieval's benefit at zero
  // LLM cost. It goes into the EMBEDDED text only; the stored body stays the raw chunk so
  // char offsets still line up with calibre_get_content.
  const ctx = `[${book.title} › ${book.authors.join(", ")}]\n`;

  let chunks: EmbedChunk[];
  if (!keywordOnly && tokenBudgeted) {
    // Budget in REAL model tokens: the e5 window minus what the "passage: " + context
    // prefixes consume, so RU chunks stop being over-conservative and EN chunks stop
    // silently wasting window. countTokens is safe here — warmup succeeded (tokenBudgeted).
    const budget = Math.max(MIN_TOKEN_BUDGET, MAX_TOKENS - deps.embedder.countTokens(PASSAGE_PREFIX + ctx));
    chunks = chunkForEmbedding(extracted.text, { budget, lengthFn: (s) => deps.embedder.countTokens(s) });
  } else {
    // No loaded model (keyword-only or a failed warmup) — no token window to respect;
    // the conservative char-based default applies.
    chunks = chunkForEmbedding(extracted.text);
  }
  if (chunks.length === 0) throw new Error("produced no chunks");

  // Chunks that are MOSTLY before the first detected chapter are front matter (TOC/praise/
  // foreword) — search demotes them below body matches (issue #18). Majority overlap, not
  // full containment: chunks run ~2k chars, so the whole front matter usually lands inside
  // one boundary-straddling chunk that a containment rule would never flag.
  const fmEnd = frontMatterEnd(extracted.text);
  const isFrontMatter = (c: EmbedChunk): boolean =>
    fmEnd > 0 && Math.min(c.charEnd, fmEnd) - c.charStart >= 0.5 * (c.charEnd - c.charStart);

  let indexed: IndexedChunk[];
  if (keywordOnly) {
    // No embeddings — chunks are stored raw + pre-stemmed (in the store) for FTS keyword search.
    indexed = chunks.map((c) => ({
      charStart: c.charStart,
      charEnd: c.charEnd,
      body: c.body,
      frontMatter: isFrontMatter(c),
    }));
  } else {
    const vectors = await deps.embedder.embedPassages(chunks.map((c) => ctx + c.body));
    indexed = chunks.map((c, i) => ({
      charStart: c.charStart,
      charEnd: c.charEnd,
      body: c.body,
      frontMatter: isFrontMatter(c),
      vector: vectors[i]!,
    }));
  }
  deps.index.replaceBook(
    libraryId,
    { bookId, title: book.title, authors: book.authors, lastModified: book.lastModified },
    indexed,
  );
  deps.log.info("indexed book", { bookId, chunks: indexed.length, format: fmt, keywordOnly });
  return indexed.length;
}

/** True when an error is the coded "embedding model not installed" signal. */
function isEmbedderUnavailable(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)) === "EMBEDDER_UNAVAILABLE";
}

/** Concise, LLM-actionable reason for a per-book failure (coded errors → plain English). */
function describeError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "EMBEDDER_UNAVAILABLE") {
    return "embedding model unavailable — install @huggingface/transformers";
  }
  if (m === "NO_PDF_BACKEND") return "no PDF text extractor (install poppler or PyMuPDF)";
  if (m === "NO_EPUB_BACKEND") return "no ebook extractor (needs Calibre ebook-convert)";
  if (m === "EXTRACT_TIMEOUT") return "extraction timed out (file too large)";
  if (m === "EXTRACT_FAILED") return "extraction failed";
  return m;
}

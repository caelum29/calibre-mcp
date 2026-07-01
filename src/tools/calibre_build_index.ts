// calibre_build_index (WRITE) — build the semantic embeddings index for a chosen set of
// books. A selector (bookId | ids | query) is REQUIRED: full-library indexing is deferred
// (it's a ~1-2h job), so this slice never indexes everything by default. Each book is
// extracted (reusing calibre_get_content's cache), chunked, embedded, and persisted; a
// deterministic "[title › authors]" prefix gives each chunk cheap document context.
// Per-book failures are collected, not fatal. The write gate disables this tool by default.

import { z } from "zod";
import { chooseExtractFormat } from "../calibre/extract.js";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "./resolve-id.js";
import { toolError, toolOk } from "./result.js";
import type { IndexedChunk } from "../semantic/store.js";
import type { ToolDeps } from "./types.js";
import { chunkForEmbedding } from "../semantic/chunk.js";

/** Cap on books selected by a query, so a broad query can't kick off a huge build. */
const MAX_QUERY_BOOKS = 100;

export const buildIndexTool = defineTool({
  name: "calibre_build_index",
  title: "Build semantic index",
  description:
    "Build the semantic embeddings index for specific books (required: bookId, ids, or query — full-library indexing is deferred). Extracts, chunks, and embeds each book. Re-run after adding books; use force to re-index unchanged ones.",
  inputSchema: {
    bookId: BookId().optional(),
    ids: jsonArray(BookId()).optional(),
    query: z.string().max(512).optional(),
    library: z.string().optional(),
    force: CoercedBool().default(false),
    enableFts: CoercedBool().default(false),
  },
  outputSchema: {
    booksRequested: z.number().optional(),
    booksIndexed: z.number().optional(),
    booksSkipped: z.number().optional(),
    chunks: z.number().optional(),
    elapsedMs: z.number().optional(),
    failures: z.array(z.string()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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

    let booksIndexed = 0;
    let booksSkipped = 0;
    let totalChunks = 0;
    for (const bookId of targets) {
      try {
        const n = await indexBook(deps, libraryId, bookId, args.force, args.library);
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
      `Indexed ${booksIndexed}/${booksRequested} book(s) (${booksSkipped} up-to-date, ${totalChunks} chunks) in ${elapsedMs} ms.` +
      (failures.length ? ` ${failures.length} failed:${failureLines.join("")}` : "") +
      notes.map((n) => `\n- ${n}`).join("");

    return toolOk([{ type: "text", text: summary }], {
      booksRequested,
      booksIndexed,
      booksSkipped,
      chunks: totalChunks,
      elapsedMs,
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

  const chunks = chunkForEmbedding(extracted.text);
  if (chunks.length === 0) throw new Error("produced no chunks");

  // Deterministic context prefix — captures most of contextual-retrieval's benefit at zero
  // LLM cost. It goes into the EMBEDDED text only; the stored body stays the raw chunk so
  // char offsets still line up with calibre_get_content.
  const ctx = `[${book.title} › ${book.authors.join(", ")}]\n`;
  const vectors = await deps.embedder.embedPassages(chunks.map((c) => ctx + c.body));

  const indexed: IndexedChunk[] = chunks.map((c, i) => ({
    charStart: c.charStart,
    charEnd: c.charEnd,
    body: c.body,
    vector: vectors[i]!,
  }));
  deps.index.replaceBook(
    libraryId,
    { bookId, title: book.title, authors: book.authors, lastModified: book.lastModified },
    indexed,
  );
  deps.log.info("indexed book", { bookId, chunks: indexed.length, format: fmt });
  return indexed.length;
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

// One book's trip into the semantic index, split at the write boundary (#99): prepareBook
// does every slow, write-free step (download, extract, chunk, embed) and may run on several
// books at once; commitBook is the single SQLite write and must only run serialized.

import { chooseExtractFormat, noTextReason } from "../calibre/extract.js";
import type { FigureMarker } from "../domain/figures/markers.js";
import type { EmbedChunk } from "../semantic/chunk.js";
import { inThreadEncoder, type BookEncoder } from "../semantic/book-encoder.js";
import type { BookMeta, IndexedChunk, IndexedFigure } from "../semantic/store.js";
import type { ToolDeps } from "./types.js";

/** Per-book diagnostics surfaced to structuredContent — the re-index triage record (#87). */
export interface BookDetail {
  bookId: number;
  format: string;
  backend: string;
  cached: boolean;
  chars: number;
  chunks: number;
  frontMatterChunks: number;
  figures: number;
  unplaced: number;
}

/** A book ready to write — everything replaceBook needs, computed off the writer's turn. */
export interface PreparedBook {
  kind: "ready";
  meta: BookMeta;
  chunks: IndexedChunk[];
  figures: IndexedFigure[];
  detail: BookDetail;
  keywordOnly: boolean;
  /** Wall time per phase (ms) — tells extraction-bound from embed-bound books (#99). */
  phaseMs: { fetch: number; extract: number; chunk: number; embed: number };
}

/**
 * "skipped" = already fresh for this build; "preserved" = a keyword-only build left a book
 * that already has embeddings untouched rather than downgrading it (#197).
 */
export type PrepareResult = PreparedBook | { kind: "skipped" } | { kind: "preserved" };

export interface PrepareOptions {
  libraryId: string;
  /** Library display name as the caller passed it (undefined = server default). */
  library: string | undefined;
  force: boolean;
  keywordOnly: boolean;
  /** True only after a successful embedder warmup — token budgeting needs a loaded tokenizer. */
  tokenBudgeted: boolean;
  /** Chunk+embed engine for this worker; defaults to deps.embedder on the calling thread. */
  encoder?: BookEncoder;
  /** Caller cancellation: kills the in-flight extraction / figure-scan subprocess. */
  signal?: AbortSignal;
}

/**
 * Everything up to (not including) the index write. Returns "skipped" when the book is
 * already indexed at its current lastModified and `force` is off — for a semantic build that
 * also means every chunk has an embedding (#197). Returns "preserved" when a keyword-only
 * build meets an embedded book. Throws on a per-book failure — the caller collects it;
 * nothing has been written at that point.
 */
export async function prepareBook(deps: ToolDeps, bookId: number, opts: PrepareOptions): Promise<PrepareResult> {
  const { libraryId, library, keywordOnly, tokenBudgeted } = opts;
  let mark = Date.now();
  const lap = (): number => {
    const now = Date.now();
    const ms = now - mark;
    mark = now;
    return ms;
  };
  const book = await deps.content.getBook(bookId, library);
  const fetchMs = lap();

  // A semantic build treats keyword-only / half-embedded entries as stale (#197): another
  // writer on the same db (e.g. a model-less .mcpb) may have stored chunks without vectors.
  if (
    !opts.force &&
    deps.index.isBookIndexed(libraryId, bookId, book.lastModified ?? "", { requireVectors: !keywordOnly })
  ) {
    return { kind: "skipped" };
  }
  // Keyword-only never replaces embeddings (even with force): losing vectors is a silent
  // vector/hybrid recall loss, while keeping them costs at most stale text until the next
  // semantic build. Checked here to skip the extraction; replaceBook re-checks atomically.
  if (keywordOnly && deps.index.bookVectorCount(libraryId, bookId) > 0) {
    return { kind: "preserved" };
  }

  const fmt = chooseExtractFormat(book.formats);
  if (!fmt) {
    const avail = book.formats.length ? book.formats.join(", ") : "none";
    throw new Error(`no extractable text format (available: ${avail})`);
  }

  const base = deps.config.serverUrl.replace(/\/+$/, "");
  const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${bookId}/${encodeURIComponent(libraryId)}`;
  const cacheKey = `${bookId}:${fmt}:${book.lastModified ?? ""}`;
  const extracted = await deps.extractor.getText({ bookId, format: fmt, downloadUrl, cacheKey, signal: opts.signal });
  const extractMs = lap();

  if (extracted.text.trim().length === 0) {
    throw new Error(`no extractable text (${fmt}) — ${noTextReason(fmt)}`);
  }

  // Deterministic context prefix — captures most of contextual-retrieval's benefit at zero
  // LLM cost. It goes into the EMBEDDED text only; the stored body stays the raw chunk so
  // char offsets still line up with calibre_get_content.
  const ctx = `[${book.title} › ${book.authors.join(", ")}]\n`;

  // Figure captions (D-018 Phase B / #86): every placed marker becomes a figures row —
  // caption + char_offset come from the marker (same text coordinates as the chunks),
  // source/dims from the figure inventory (already cached by marker injection). Captions get
  // their own embeddings so target:"figures" search ranks them directly.
  const figureRowsP: Promise<IndexedFigure[]> =
    extracted.markers.length > 0
      ? figureRows(deps, { bookId, format: fmt, downloadUrl, cacheKey, signal: opts.signal }, extracted.markers)
      : Promise.resolve([]);
  const encoder = opts.encoder ?? inThreadEncoder(deps.embedder);
  const encoded = await encoder.encode({
    text: extracted.text,
    ctx,
    outline: extracted.outline,
    captions: extracted.markers.map((m) => m.caption),
    keywordOnly,
    tokenBudgeted,
  });
  if (encoded.chunks.length === 0) throw new Error("produced no chunks");

  // Chunks that are MOSTLY before the first detected chapter are front matter (TOC/praise/
  // foreword) — search demotes them below body matches (issue #18). Majority overlap, not
  // full containment: chunks run ~2k chars, so the whole front matter usually lands inside
  // one boundary-straddling chunk that a containment rule would never flag.
  const { fmEnd, vectors, captionVectors } = encoded;
  const isFrontMatter = (c: EmbedChunk): boolean =>
    fmEnd > 0 && Math.min(c.charEnd, fmEnd) - c.charStart >= 0.5 * (c.charEnd - c.charStart);

  // keywordOnly: no vectors — chunks are stored raw + pre-stemmed (in the store) for FTS search.
  const indexed: IndexedChunk[] = encoded.chunks.map((c, i) => ({
    charStart: c.charStart,
    charEnd: c.charEnd,
    body: c.body,
    frontMatter: isFrontMatter(c),
    ...(vectors ? { vector: vectors[i]! } : {}),
  }));
  let figures = await figureRowsP;
  if (captionVectors && figures.length > 0) {
    figures = figures.map((f, i) => ({ ...f, vector: captionVectors[i]! }));
  }

  return {
    kind: "ready",
    meta: { bookId, title: book.title, authors: book.authors, lastModified: book.lastModified },
    chunks: indexed,
    figures,
    keywordOnly,
    // Embed includes the figure inventory lookup (a cache hit after marker injection).
    phaseMs: { fetch: fetchMs, extract: extractMs, ...encoded.phaseMs },
    detail: {
      bookId,
      format: fmt,
      backend: extracted.backend,
      cached: extracted.cached,
      chars: extracted.chars,
      chunks: indexed.length,
      frontMatterChunks: indexed.filter((c) => c.frontMatter).length,
      figures: figures.length,
      unplaced: extracted.unplaced,
    },
  };
}

/**
 * The single index write for a prepared book — one transaction, so a throw here means the
 * book's previous rows are intact. Callers must serialize it (single writer). Returns
 * undefined when a keyword-only write was refused because the book already has embeddings.
 */
export function commitBook(deps: ToolDeps, libraryId: string, book: PreparedBook): BookDetail | undefined {
  const outcome = deps.index.replaceBook(libraryId, book.meta, book.chunks, book.figures, {
    preserveEmbedded: book.keywordOnly,
  });
  if (outcome === "preserved") {
    deps.log.info("kept embedded book — keyword-only build does not downgrade", { bookId: book.meta.bookId });
    return undefined;
  }
  const d = book.detail;
  deps.log.info("indexed book", {
    bookId: d.bookId,
    chunks: d.chunks,
    figures: d.figures,
    unplaced: d.unplaced,
    frontMatterChunks: d.frontMatterChunks,
    format: d.format,
    backend: d.backend,
    keywordOnly: book.keywordOnly,
  });
  return d;
}

/**
 * Marker → IndexedFigure rows. The inventory is best-effort: it should be a cache hit
 * (marker injection just built it), but if it is unavailable the captions still index —
 * only source/dims are omitted (never guessed) — and figure indexing never fails the book.
 */
async function figureRows(
  deps: ToolDeps,
  invArgs: { bookId: number; format: string; downloadUrl: string; cacheKey: string; signal?: AbortSignal },
  markers: FigureMarker[],
): Promise<IndexedFigure[]> {
  let entries: Array<{ source?: "raster" | "page-render" | "svg-render"; width?: number; height?: number }> = [];
  try {
    const { inventory } = await deps.figures.getInventory(invArgs);
    entries = inventory.entries;
  } catch (err) {
    deps.log.warn("figure inventory unavailable at index time — captions indexed without source/dims", {
      bookId: invArgs.bookId,
      msg: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
  return markers.map((m) => {
    const e = entries[m.index];
    return {
      figIndex: m.index,
      page: m.page,
      caption: m.caption,
      charOffset: m.charOffset,
      format: invArgs.format,
      ...(e?.source !== undefined ? { source: e.source } : {}),
      ...(e?.width !== undefined ? { width: e.width } : {}),
      ...(e?.height !== undefined ? { height: e.height } : {}),
    };
  });
}

/** SQLITE_BUSY (5) / SQLITE_LOCKED (6), incl. extended codes: another process holds the index lock. */
export function isDbBusy(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  if (typeof code === "number" && [5, 6].includes(code & 0xff)) return true;
  return err instanceof Error && /database (table )?is locked/i.test(err.message);
}

/**
 * Run an index write, retrying it ONCE after a short pause if another server process still held
 * the db lock past busy_timeout (#196 — Desktop + Claude Code share one index file). Any other
 * error, or a second busy, propagates and is recorded as the book's failure.
 */
export async function withBusyRetry<T>(fn: () => T | Promise<T>, pauseMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isDbBusy(err)) throw err;
    await new Promise((r) => setTimeout(r, pauseMs));
    return await fn();
  }
}

/** Concise, LLM-actionable reason for a per-book failure (coded errors → plain English). */
export function describeError(err: unknown): string {
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

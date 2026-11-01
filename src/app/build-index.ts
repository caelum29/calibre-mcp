// The index-build use case behind calibre_build_index (#346): resolve the selection, pick the
// mode (embeddings or keyword-only), prepare + commit book by book, tally, optionally prune.
// Returns facts, not text — the tool module renders them.

import type { BookPhase } from "./index-book.js";
import {
  commitBook,
  commitRefresh,
  describeError,
  prepareBook,
  withBusyRetry,
  type BookDetail,
  type BookIndexPorts,
  type PrepareResult,
} from "./index-book.js";
import { resolveNumericId } from "./resolve-id.js";
import { runBookPipeline } from "../semantic/book-pipeline.js";
import type { BuildProgress } from "../semantic/index-builds.js";
import type { IndexFreshness, IndexWriter, PruneCounts } from "../semantic/store/index.js";
import type { BaseDeps, DepsWithIndex } from "../tools/deps.js";

/** Page size when listing query matches / the whole library (ids only — the response is tiny). */
const ID_PAGE = 1000;
/** Runaway guard on the id paging loop (1000 × 1000 ids ≫ any real library). */
const ID_MAX_PAGES = 1000;
/** Above this many query-selected books, the result carries a long-build/resume note (#138). */
const LARGE_SELECTION = 100;
/** Progress line to stderr every N books, so a long build is observable in the server log. */
const PROGRESS_EVERY = 25;

/**
 * Books in flight per build call. 1 on purpose (#99 bench): chunking + tokenizing are
 * main-thread JS, so in-thread book concurrency bought 0-6%, while each extra in-flight book
 * makes a concurrent search's query embed wait behind one more passage batch. The real win is
 * worker threads (scripts/reindex.ts --encoder threads) — not wired into the server yet,
 * since each thread loads its own model copy (~0.9 GB) inside the long-lived server process.
 */
const BUILD_CONCURRENCY = 1;

/** The build's index ports (#272): the per-book trip plus the orphan prune. */
export type BuildIndexPorts = BookIndexPorts &
  Pick<IndexFreshness, "indexedBookIds"> &
  Pick<IndexWriter, "deleteBooks">;
/** The build's deps: BaseDeps plus BuildIndexPorts. */
export type BuildIndexDeps = DepsWithIndex<BuildIndexPorts>;

/** What to build, as the tool's input schema parsed it. */
export interface BuildRequest {
  bookId?: number | string | undefined;
  ids?: (number | string)[] | undefined;
  query?: string | undefined;
  library?: string | undefined;
  force: boolean;
  keywordOnly: boolean;
  prune: boolean;
}

/** Client progress: (value, message, total). */
type ReportFn = (value: number, message: string, total?: number) => void;

/** Sub-book phase reporting for one book (#245); `stop` runs whatever the book's outcome. */
interface BookPhases {
  onPhase: (p: BookPhase) => void;
  stop: () => void;
}

/** How the build reports while it runs; every field is optional. */
export interface BuildHooks {
  signal?: AbortSignal | undefined;
  /** Client progress, already muted once the call detached; absent = no client progress. */
  progress?: ReportFn | undefined;
  /** Builds a book's phase reporter whose whole-book step runs from `base` to `base + 1`. */
  bookPhases?: (report: (value: number, message: string) => void, base: number, label: string) => BookPhases;
}

/** Book counts every finished or cancelled build reports. */
export interface BuildCounts {
  booksRequested: number;
  booksIndexed: number;
  booksSkipped: number;
  booksRefreshed: number;
  booksPreserved: number;
  /** Books that really failed (not the ones a cancel cut short), as `<what> <id>: <reason>`. */
  failures: string[];
  chunks: number;
}

/** A finished build's facts — the tool turns them into the summary text + structuredContent. */
export interface BuildSummary extends BuildCounts {
  figures: number;
  /** Figure markers whose caption was not found in the extracted text. */
  unplaced: number;
  bookDetails: BookDetail[];
  keywordOnly: boolean;
  /** Why the index has no embeddings: asked for, or the model was missing (auto-degrade, #41). */
  keywordOnlyReason?: "requested" | "embedder-unavailable";
  rerankerWarmupFailed: boolean;
  /** Set when a query selected more than LARGE_SELECTION books (the resume note, #138). */
  largeSelection?: number;
  /** prune=true only: what was dropped, or why the prune was skipped. */
  prune?: { pruned: PruneCounts } | { skipped: string };
  elapsedMs: number;
}

/** A build's outcome: nothing resolved, cancelled mid-way, or finished. */
export type BuildIndexOutcome =
  | { kind: "no-targets"; failures: string[] }
  | { kind: "cancelled"; counts: BuildCounts }
  | { kind: "done"; summary: BuildSummary };

/**
 * Run one build. `state` is the snapshot other calls see while it runs (#284); per-book
 * failures are collected, never fatal; a cancel stops queued books and keeps committed ones.
 */
export async function runIndexBuild(
  deps: BuildIndexDeps,
  req: BuildRequest,
  libraryId: string,
  state: BuildProgress,
  hooks: BuildHooks = {},
): Promise<BuildIndexOutcome> {
  const { signal, progress } = hooks;
  const started = Date.now();
  const failures: string[] = [];
  // Resolve the target set (deduped, preserving discovery order).
  const targets = new Set<number>();
  if (req.bookId !== undefined) {
    const n = await resolveNumericId(deps, req.bookId, req.library);
    if (n === undefined) failures.push(`bookId ${req.bookId}: not found`);
    else targets.add(n);
  }
  for (const raw of req.ids ?? []) {
    const n = await resolveNumericId(deps, raw, req.library);
    if (n === undefined) failures.push(`id ${raw}: not found`);
    else targets.add(n);
  }
  let largeSelection: number | undefined;
  if (req.query) {
    // Page through EVERY match (#138): a single capped page silently dropped the rest.
    const matched = await allMatchingIds(deps, req.query, req.library);
    for (const id of matched) targets.add(id);
    // Long builds can outlive the client's request timeout; re-running resumes (#138).
    if (matched.size > LARGE_SELECTION) largeSelection = matched.size;
  }

  const booksRequested = targets.size;
  state.total = booksRequested;
  state.selectedIds = [...targets];
  if (booksRequested === 0) return { kind: "no-targets", failures };

  // Decide the build mode up front. keywordOnly skips the model entirely; otherwise probe
  // the embedder once (warmup does the lazy dynamic-import) so a no-embeddings install
  // degrades to a keyword-only index instead of failing every book (the model-free default).
  let keywordOnly = req.keywordOnly;
  let keywordOnlyReason: BuildSummary["keywordOnlyReason"] = keywordOnly ? "requested" : undefined;
  // Token budgeting needs a LOADED tokenizer — only true after a successful warmup.
  let tokenBudgeted = false;
  if (!keywordOnly) {
    try {
      await deps.embedder.warmup();
      tokenBudgeted = true;
    } catch (err) {
      if (isEmbedderUnavailable(err)) {
        keywordOnly = true;
        keywordOnlyReason = "embedder-unavailable";
      }
      // Other warmup errors (e.g. a download hiccup) fall through — the per-book embed
      // attempt below surfaces them as collected failures (char-budget chunking applies).
    }
  }

  // Pre-warm the reranker on embedding builds (D-011): its one-time ~576 MB download lands
  // inside the build users already expect to be slow, not on the first search. Best-effort —
  // a failure logs to stderr + a note and NEVER fails the build. Keyword-only builds and
  // CALIBRE_MCP_RERANK=off installs skip it (nothing would use the model).
  let rerankerWarmupFailed = false;
  if (!keywordOnly && tokenBudgeted && deps.reranker && deps.config.rerankEnabled) {
    try {
      await deps.reranker.warmup();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      deps.log.warn("reranker pre-download failed", { reason });
      rerankerWarmupFailed = true;
    }
  }

  let booksIndexed = 0;
  let booksSkipped = 0;
  let booksRefreshed = 0;
  let booksPreserved = 0;
  // Books whose keyword-only write replaceBook refused at commit time (embedded meanwhile).
  const preservedAtCommit = new Set<number>();
  let totalChunks = 0;
  let totalFigures = 0;
  let totalUnplaced = 0;
  const bookDetails: BookDetail[] = [];
  let settled = 0;
  // Books a cancel cut short: settled, but never processed — kept out of progress.done (#325).
  const cutShort = new Set<number>();
  progress?.(0, `Indexing ${booksRequested} book(s)…`, booksRequested);
  // Book-level pipeline (#99): write-free prepare per book, one serialized writer commits —
  // the same path the threaded bulk re-index uses, so both keep the single-writer invariant.
  const outcomes = await runBookPipeline<PrepareResult>([...targets], BUILD_CONCURRENCY, {
    prepare: async (bookId) => {
      // Cancelled (client sent notifications/cancelled or went away): queued books never start.
      // Books already committed stay indexed; the in-flight subprocess is killed by its signal.
      signal?.throwIfAborted();
      // One book at a time (BUILD_CONCURRENCY), so `settled` is this book's base step.
      const sub =
        progress && hooks.bookPhases
          ? hooks.bookPhases(
              (value, message) => {
                if (!signal?.aborted) progress(value, message, booksRequested);
              },
              settled,
              `Book ${settled + 1}/${booksRequested} (id ${bookId})`,
            )
          : undefined;
      try {
        return await prepareBook(deps, bookId, {
          ...(sub ? { onPhase: sub.onPhase } : {}),
          libraryId,
          library: req.library,
          force: req.force,
          keywordOnly,
          tokenBudgeted,
          signal,
        });
      } finally {
        sub?.stop();
      }
    },
    commit: async (bookId, prepared) => {
      if (prepared.kind === "refreshed") {
        await withBusyRetry(() => commitRefresh(deps, libraryId, prepared));
        return;
      }
      if (prepared.kind !== "ready") return;
      if ((await withBusyRetry(() => commitBook(deps, libraryId, prepared))) === undefined) {
        preservedAtCommit.add(bookId);
      }
    },
    onSettled: (o) => {
      settled++;
      // Only a prepare can be cut short (the extraction is killed by the signal); a commit is a
      // synchronous SQLite write, so a commit failure is a real failure even mid-cancel.
      if (!o.ok && o.stage === "prepare" && signal?.aborted) cutShort.add(o.bookId);
      state.done = settled - cutShort.size;
      // A write refused at commit (embedded meanwhile) kept the old rows — not indexed (#325).
      if (o.ok && o.prepared.kind === "ready" && !preservedAtCommit.has(o.bookId)) {
        state.indexedIds.push(o.bookId);
      }
      if (settled % PROGRESS_EVERY === 0) {
        deps.log.info("build progress", { done: settled, of: booksRequested });
      }
      if (!o.ok && !cutShort.has(o.bookId)) {
        const reason = describeError(o.error);
        // Shared with "still running" reports, so a failure shows up while the build runs.
        state.failures.push(`book ${o.bookId}: ${reason}`);
        deps.log.warn("book failed", { bookId: o.bookId, stage: o.stage, reason });
      }
      if (signal?.aborted) return;
      progress?.(settled, `Indexed ${settled}/${booksRequested} book(s)`, booksRequested);
    },
  });
  // Tally in selection order, so the result reads the same whatever order books finished in.
  for (const o of outcomes) {
    if (!o.ok) {
      // A book cut short by the cancel did not fail — it just never finished.
      if (!cutShort.has(o.bookId)) failures.push(`book ${o.bookId}: ${describeError(o.error)}`);
    } else if (o.prepared.kind === "skipped") {
      booksSkipped++;
    } else if (o.prepared.kind === "refreshed") {
      booksRefreshed++;
    } else if (o.prepared.kind === "preserved" || preservedAtCommit.has(o.bookId)) {
      booksPreserved++;
    } else {
      const d = o.prepared.detail;
      booksIndexed++;
      totalChunks += d.chunks;
      totalFigures += d.figures;
      totalUnplaced += d.unplaced;
      bookDetails.push(d);
    }
  }
  const counts: BuildCounts = {
    booksRequested,
    booksIndexed,
    booksSkipped,
    booksRefreshed,
    booksPreserved,
    failures,
    chunks: totalChunks,
  };
  if (signal?.aborted) return { kind: "cancelled", counts };

  const prune = req.prune ? await pruneOrphans(deps, libraryId, req.library) : undefined;
  return {
    kind: "done",
    summary: {
      ...counts,
      figures: totalFigures,
      unplaced: totalUnplaced,
      bookDetails,
      keywordOnly,
      ...(keywordOnlyReason !== undefined ? { keywordOnlyReason } : {}),
      rerankerWarmupFailed,
      ...(largeSelection !== undefined ? { largeSelection } : {}),
      ...(prune ? { prune } : {}),
      elapsedMs: Date.now() - started,
    },
  };
}

/**
 * Orphan prune (#100): indexing only ever upserts, so books removed from the library (or
 * merged away) keep searchable chunks that 404 on calibre_get_content. Reconcile the index
 * against the CURRENT library id set. A failed prune never fails the build: the indexing
 * already committed.
 */
async function pruneOrphans(
  deps: BuildIndexDeps,
  libraryId: string,
  library: string | undefined,
): Promise<{ pruned: PruneCounts } | { skipped: string }> {
  try {
    // Empty query = every book: the keep-set must be complete, or live rows get deleted.
    const live = await allMatchingIds(deps, "", library);
    // An empty live set means the library listing failed or the server lied — pruning then
    // would wipe the whole index. Refuse instead.
    if (live.size === 0) throw new Error("the library reported 0 books");
    const orphans = deps.index.indexedBookIds(libraryId).filter((id) => !live.has(id));
    return { pruned: deps.index.deleteBooks(libraryId, orphans) };
  } catch (err) {
    return { skipped: describeError(err) };
  }
}

/**
 * Every book id matching `query` (empty = the whole library), paged through the search
 * endpoint by offset. Feeds both the query selector and the orphan-prune keep-set, so it must
 * be complete — a partial walk would under-index (#138) or delete live rows (prune).
 */
async function allMatchingIds(deps: BaseDeps, query: string, library: string | undefined): Promise<Set<number>> {
  const ids = new Set<number>();
  let offset = 0;
  for (let page = 0; page < ID_MAX_PAGES; page++) {
    const res = await deps.content.search({ query, library, num: ID_PAGE, offset });
    for (const id of res.bookIds) ids.add(id);
    if (res.bookIds.length === 0) break;
    offset += res.bookIds.length;
    if (offset >= res.total) break;
  }
  return ids;
}

/** True when an error is the coded "embedding model not installed" signal. */
function isEmbedderUnavailable(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)) === "EMBEDDER_UNAVAILABLE";
}

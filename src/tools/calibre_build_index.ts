// calibre_build_index (WRITE) — build the semantic embeddings index for a chosen set of
// books. A selector (bookId | ids | query) is REQUIRED: full-library indexing is deferred
// (it's a ~1-2h job), so this slice never indexes everything by default. Each book is
// extracted (reusing calibre_get_content's cache), chunked, embedded, and persisted; a
// deterministic "[title › authors]" prefix gives each chunk cheap document context.
// Per-book failures are collected, not fatal. The write gate disables this tool by default.

import { z } from "zod";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import {
  commitBook,
  commitRefresh,
  describeError,
  prepareBook,
  withBusyRetry,
  type BookDetail,
  type PrepareResult,
} from "./index-book.js";
import { resolveNumericId } from "./resolve-id.js";
import { INSTALL_TRANSFORMERS } from "./remediation.js";
import { toolError, toolOk } from "./result.js";
import {
  cancelledResult,
  fromEarlierCall,
  selectorKey,
  stillRunningResult,
  type BuildSelector,
} from "./build-index-results.js";
import type { PruneCounts } from "../semantic/store.js";
import type { ToolContext, ToolDeps, ToolResult } from "./types.js";
import { IndexBuildRegistry, type BuildRun } from "../semantic/index-builds.js";
import { log } from "../logging.js";
import { runBookPipeline } from "../semantic/book-pipeline.js";
import { bookProgress } from "./book-progress.js";

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

/** Fallback when deps carry no registry (server.ts wires one per process). */
const sharedBuilds = new IndexBuildRegistry<ToolResult>({ log });

export const buildIndexTool = defineTool({
  name: "calibre_build_index",
  title: "Build semantic index",
  description:
    'Build the semantic index for specific books (required: bookId, ids, or query — full-library indexing is deferred). A query selects ALL matching books (no 100-book cap); a call still working after ~45 s returns a "still running" status (not an error) while the build keeps committing in the background — re-run the same call to get its result; only one build runs per library at a time, and up-to-date books are skipped. Extracts, chunks, and embeds each book. Set keywordOnly=true (or when the embedding model is absent, it happens automatically) to build a keyword-only index that powers mode:"keyword" search with zero ML dependencies. Re-run after adding books; use force to re-index unchanged ones. Set prune=true to also drop index entries for books that no longer exist in the library (removals/merges leave searchable orphans behind).',
  inputSchema: {
    bookId: BookId().optional(),
    ids: jsonArray(BookId()).optional(),
    query: z.string().max(512).optional(),
    library: z.string().optional(),
    force: CoercedBool().default(false),
    enableFts: CoercedBool().default(false),
    keywordOnly: CoercedBool().default(false),
    prune: CoercedBool().default(false),
  },
  outputSchema: {
    booksRequested: z.number().optional(),
    booksIndexed: z.number().optional(),
    booksSkipped: z.number().optional(),
    // Metadata-only edits (#244): title/authors refreshed in place, text unchanged, no re-embed.
    booksRefreshed: z.number().optional(),
    // Keyword-only build kept these books' existing embeddings instead of downgrading them (#197).
    booksPreserved: z.number().optional(),
    chunks: z.number().optional(),
    figures: z.number().optional(),
    // Orphan prune (#100) — only present when prune=true ran; 0s mean "checked, nothing stale".
    prunedBooks: z.number().optional(),
    prunedChunks: z.number().optional(),
    prunedFigures: z.number().optional(),
    elapsedMs: z.number().optional(),
    // Soft-deadline status (#284): the build is still running in the background — a success, not
    // an error. booksRequested/booksDone/booksIndexed then describe the RUNNING build.
    stillRunning: z.boolean().optional(),
    booksDone: z.number().optional(),
    indexedIds: z.array(z.number()).optional(),
    keywordOnly: z.boolean().optional(),
    // Degradation surfacing (issue #41): false whenever the built index has no embeddings —
    // requested (keywordOnly=true) or auto-degraded — with the reason spelled out.
    semanticAvailable: z.boolean().optional(),
    semanticReason: z.string().optional(),
    failures: z.array(z.string()).optional(),
    // Per-book triage record (#87): format/backend chosen, cache hit, front-matter and
    // figure-marker diagnostics — the raw material for re-index failure-bucket analysis.
    bookDetails: z
      .array(
        z.object({
          bookId: z.number(),
          format: z.string(),
          backend: z.string(),
          cached: z.boolean(),
          chars: z.number(),
          chunks: z.number(),
          frontMatterChunks: z.number(),
          figures: z.number(),
          unplaced: z.number(),
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  // readOnlyHint:false but NOT write-gated: this writes to the server's own index dir, not the
  // user's library, so the library write gate doesn't apply. localWrite marks that carve-out.
  localWrite: true,
  handler: async (args, deps, ctx) => {
    const signal = ctx?.signal;
    if (args.bookId === undefined && !args.ids?.length && !args.query) {
      return toolError("Specify bookId, ids, or query — full-library indexing is deferred.");
    }

    let libraryId: string;
    try {
      libraryId = await deps.content.resolveLibraryId(args.library);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }

    // One build per library at a time (one index file, one writer); past the soft deadline the
    // call returns a "still running" status and the build keeps committing in the background.
    const builds = deps.indexBuilds ?? sharedBuilds;
    const outcome = await builds.run(
      libraryId,
      selectorKey(args),
      (run) => runBuild(args, deps, ctx, libraryId, run),
      signal,
    );
    if (outcome.kind === "running") return stillRunningResult(outcome);
    return outcome.earlierCallFinishedAgoMs === undefined
      ? outcome.result
      : fromEarlierCall(outcome.result, outcome.earlierCallFinishedAgoMs);
  },
});

/** Args of one build call, as parsed by the input schema. */
type BuildArgs = BuildSelector & { library?: string | undefined };

/**
 * The build itself: resolve the selection, pick the mode, then prepare + commit book by book.
 * Progress goes to the client only while the call is still open (`run.detached()` is false);
 * `run.progress` is the snapshot other calls see while this build runs.
 */
async function runBuild(
  args: BuildArgs,
  deps: ToolDeps,
  ctx: ToolContext | undefined,
  libraryId: string,
  run: BuildRun,
): Promise<ToolResult> {
  const signal = ctx?.signal;
  const started = Date.now();
  const notes: string[] = [];
  const failures: string[] = [];
  // After the early return the request is closed: progress for it would be a protocol error.
  const report = ctx?.progress;
  const progress = report
    ? (value: number, message: string, total?: number) => {
        if (!run.detached()) report(value, message, total);
      }
    : undefined;
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
    // Page through EVERY match (#138): a single capped page silently dropped the rest.
    const matched = await allMatchingIds(deps, args.query, args.library);
    for (const id of matched) targets.add(id);
    if (matched.size > LARGE_SELECTION) {
      // Long builds can outlive the client's request timeout; up-to-date books are skipped,
      // so re-running the same call resumes where an interrupted build stopped.
      notes.push(
        `query matched ${matched.size} books — a large build; if it is interrupted, re-run the same call to resume (already-indexed books are skipped).`,
      );
    }
  }

  const booksRequested = targets.size;
  run.progress.total = booksRequested;
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
        degradeWarning = `Embedding model unavailable — built a KEYWORD-ONLY index instead (mode:"keyword" search works now). ${INSTALL_TRANSFORMERS} After restarting, rebuild with force=true for vector & hybrid semantic search.`;
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
  let booksRefreshed = 0;
  let booksPreserved = 0;
  // Books whose keyword-only write replaceBook refused at commit time (embedded meanwhile).
  const preservedAtCommit = new Set<number>();
  let totalChunks = 0;
  let totalFigures = 0;
  let totalUnplaced = 0;
  const bookDetails: BookDetail[] = [];
  let settled = 0;
  progress?.(0, `Indexing ${booksRequested} book(s)…`, booksRequested);
  // Book-level pipeline (#99): write-free prepare per book, one serialized writer commits —
  // the same path the threaded bulk re-index uses, so both keep the single-writer invariant.
  const outcomes = await runBookPipeline<PrepareResult>([...targets], BUILD_CONCURRENCY, {
    prepare: async (bookId) => {
      // Cancelled (client sent notifications/cancelled or went away): queued books never start.
      // Books already committed stay indexed; the in-flight subprocess is killed by its signal.
      signal?.throwIfAborted();
      // One book at a time (BUILD_CONCURRENCY), so `settled` is this book's base step.
      const sub = progress
        ? bookProgress(
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
          library: args.library,
          force: args.force,
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
      run.progress.done = settled;
      if (o.ok && o.prepared.kind === "ready") run.progress.indexedIds.push(o.bookId);
      if (settled % PROGRESS_EVERY === 0) {
        deps.log.info("build progress", { done: settled, of: booksRequested });
      }
      if (signal?.aborted) return;
      if (!o.ok) {
        deps.log.warn("book failed", { bookId: o.bookId, stage: o.stage, reason: describeError(o.error) });
      }
      progress?.(settled, `Indexed ${settled}/${booksRequested} book(s)`, booksRequested);
    },
  });
  // Tally in selection order, so the result reads the same whatever order books finished in.
  for (const o of outcomes) {
    if (!o.ok) {
      // A book cut short by the cancel did not fail — it just never finished.
      if (!signal?.aborted) failures.push(`book ${o.bookId}: ${describeError(o.error)}`);
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
  if (signal?.aborted) {
    const done = booksIndexed + booksSkipped + booksPreserved;
    return cancelledResult({ done, booksRequested, booksIndexed, booksSkipped, chunks: totalChunks });
  }
  if (booksPreserved > 0) {
    notes.push(
      `${booksPreserved} book(s) already have embeddings and were left as-is — a keyword-only build never downgrades them (run an embedding build to refresh them).`,
    );
  }
  if (totalUnplaced > 0) {
    // Unplaced markers are silent figure-linkage gaps — say so instead of a clean-looking count.
    notes.push(
      `${totalUnplaced} figure marker(s) could not be placed (caption not found in extracted text) — those figures are missing from figure search.`,
    );
  }

  // Orphan prune (#100): indexing only ever upserts, so books removed from the library (or
  // merged away) keep searchable chunks that 404 on calibre_get_content. Reconcile the index
  // against the CURRENT library id set. Opt-in: a narrow selector must not imply a sweep.
  let pruned: PruneCounts | undefined;
  if (args.prune) {
    try {
      // Empty query = every book: the keep-set must be complete, or live rows get deleted.
      const live = await allMatchingIds(deps, "", args.library);
      // An empty live set means the library listing failed or the server lied — pruning then
      // would wipe the whole index. Refuse instead.
      if (live.size === 0) throw new Error("the library reported 0 books");
      const orphans = deps.index.indexedBookIds(libraryId).filter((id) => !live.has(id));
      pruned = deps.index.deleteBooks(libraryId, orphans);
      notes.push(
        pruned.books > 0
          ? `Pruned ${pruned.books} book(s) no longer in the library (${pruned.chunks} chunks, ${pruned.figures} figures).`
          : "Prune found no stale books — the index matches the library.",
      );
    } catch (err) {
      // A failed prune never fails the build: the indexing above already committed.
      notes.push(`Prune skipped — could not list the library (${describeError(err)}).`);
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
    `${keywordOnly ? "Keyword-only indexed" : "Indexed"} ${booksIndexed}/${booksRequested} book(s) (${booksSkipped} up-to-date, ${booksRefreshed > 0 ? `${booksRefreshed} metadata-only refreshed without re-embedding, ` : ""}${totalChunks} chunks${totalFigures > 0 ? `, ${totalFigures} figure captions` : ""}) in ${elapsedMs} ms.` +
    (failures.length ? ` ${failures.length} failed:${failureLines.join("")}` : "") +
    notes.map((n) => `\n- ${n}`).join("") +
    // which books are now searchable — Desktop never sees bookDetails (#234)
    (bookDetails.length ? `\nIndexed ids: ${bookDetails.map((d) => d.bookId).join(", ")}.` : "");

  return toolOk([{ type: "text", text: summary }], {
    booksRequested,
    booksIndexed,
    booksSkipped,
    booksRefreshed,
    ...(booksPreserved > 0 ? { booksPreserved } : {}),
    chunks: totalChunks,
    figures: totalFigures,
    ...(pruned ? { prunedBooks: pruned.books, prunedChunks: pruned.chunks, prunedFigures: pruned.figures } : {}),
    elapsedMs,
    keywordOnly,
    semanticAvailable: !keywordOnly,
    ...(semanticReason !== undefined ? { semanticReason } : {}),
    ...(bookDetails.length > 0 ? { bookDetails } : {}),
    failures,
  });
}

/**
 * Every book id matching `query` (empty = the whole library), paged through the search
 * endpoint by offset. Feeds both the query selector and the orphan-prune keep-set, so it must
 * be complete — a partial walk would under-index (#138) or delete live rows (prune).
 */
async function allMatchingIds(deps: ToolDeps, query: string, library: string | undefined): Promise<Set<number>> {
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

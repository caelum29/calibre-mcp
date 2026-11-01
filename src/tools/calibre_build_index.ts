// calibre_build_index (WRITE) — build the semantic embeddings index for a chosen set of
// books. A selector (bookId | ids | query) is REQUIRED: full-library indexing is deferred
// (it's a ~1-2h job), so this slice never indexes everything by default. Each book is
// extracted (reusing calibre_get_content's cache), chunked, embedded, and persisted; a
// deterministic "[title › authors]" prefix gives each chunk cheap document context.
// Per-book failures are collected, not fatal. The write gate disables this tool by default.

import { z } from "zod";
import { BookId, CoercedBool, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { describeError } from "../app/index-book.js";
import { runIndexBuild, type BuildIndexDeps, type BuildSummary } from "../app/build-index.js";
import { INSTALL_TRANSFORMERS } from "./remediation.js";
import { toolError, toolOk, errorFromCatch } from "./result.js";
import {
  backgroundFailedResult,
  buildModeKey,
  cancelledResult,
  fromEarlierCall,
  selectorKey,
  requestedIds,
  stillRunningResult,
  type BuildSelector,
} from "./build-index-results.js";
import type { ToolContext, ToolResult } from "./types.js";
import { IndexBuildRegistry, type BuildRun } from "../semantic/index-builds.js";
import { log } from "../logging.js";
import { bookProgress } from "./book-progress.js";

/** calibre_build_index's deps — the build use case's (app/build-index.ts). */
export type { BuildIndexDeps };

/** The process-wide registry; deps.indexBuilds overrides it only in tests. */
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
    // Soft-deadline status (#284): a build is still running in the background — a success, not
    // an error. runningBuild says whose: "this" = this call's selection; "other" = another
    // selector's build that blocks this one, and booksRequested/booksDone/booksIndexed/indexedIds
    // then count THAT build, not this call's selection (nothing of this call has run yet);
    // failures then lists that build's books failed so far.
    stillRunning: z.boolean().optional(),
    runningBuild: z.enum(["this", "other"]).optional(),
    // The background build an earlier call started threw; failures[0] carries the reason.
    backgroundBuildFailed: z.boolean().optional(),
    booksDone: z.number().optional(),
    indexedIds: z.array(z.number()).optional(),
    keywordOnly: z.boolean().optional(),
    // Degradation surfacing (issue #41): false whenever the built index has no embeddings —
    // requested (keywordOnly=true) or auto-degraded — with the reason spelled out.
    semanticAvailable: z.boolean().optional(),
    semanticReason: z.string().optional(),
    // Per result kind: final = every per-book failure; still running = failures so far;
    // background build failed = [0] is the reason.
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
  handler: async (args, deps: BuildIndexDeps, ctx) => {
    const signal = ctx?.signal;
    if (args.bookId === undefined && !args.ids?.length && !args.query) {
      return toolError("invalid_input", "Specify bookId, ids, or query — full-library indexing is deferred.");
    }

    let libraryId: string;
    try {
      libraryId = await deps.content.resolveLibraryId(args.library);
    } catch (err) {
      return errorFromCatch(err);
    }

    // One build per library at a time (one index file, one writer); past the soft deadline the
    // call returns a "still running" status and the build keeps committing in the background.
    const builds = deps.indexBuilds ?? sharedBuilds;
    const outcome = await builds.run(
      libraryId,
      selectorKey(args),
      (run) => runBuild(args, deps, ctx, libraryId, run),
      // A cancelled build's result must not answer the next call: that call should build.
      { signal, keep: (r) => r.structuredContent?.cancelled !== true },
    );
    if (outcome.kind === "running")
      return stillRunningResult(outcome, { ids: requestedIds(args), mode: buildModeKey(args) });
    if (outcome.kind === "failed") {
      return backgroundFailedResult(describeError(outcome.error), outcome.earlierCallFinishedAgoMs);
    }
    return outcome.earlierCallFinishedAgoMs === undefined
      ? outcome.result
      : fromEarlierCall(outcome.result, outcome.earlierCallFinishedAgoMs);
  },
});

/** Args of one build call, as parsed by the input schema. */
type BuildArgs = BuildSelector & { library?: string | undefined };

/**
 * One build: the use case does the work; this renders its outcome. Progress goes to the client
 * only while the call is still open (`run.detached()` is false) — after the early return the
 * request is closed and progress for it would be a protocol error.
 */
async function runBuild(
  args: BuildArgs,
  deps: BuildIndexDeps,
  ctx: ToolContext | undefined,
  libraryId: string,
  run: BuildRun,
): Promise<ToolResult> {
  // Set before the first await, so a refused call always sees which mode this build runs in.
  run.progress.mode = buildModeKey(args);
  const report = ctx?.progress;
  const progress = report
    ? (value: number, message: string, total?: number) => {
        if (!run.detached()) report(value, message, total);
      }
    : undefined;
  const outcome = await runIndexBuild(deps, args, libraryId, run.progress, {
    signal: ctx?.signal,
    progress,
    bookPhases: bookProgress,
  });
  if (outcome.kind === "no-targets") {
    return toolError("not_found", `No books resolved from the selector. ${outcome.failures.join("; ")}`.trim());
  }
  // Same buckets as the progress text, so the cancel summary and "Books so far" agree.
  if (outcome.kind === "cancelled") return cancelledResult(outcome.counts);
  return summaryResult(outcome.summary, args.enableFts);
}

/** The finished build's text summary + structuredContent. */
function summaryResult(s: BuildSummary, enableFts: boolean): ToolResult {
  const notes: string[] = [];
  if (s.largeSelection !== undefined) {
    // Up-to-date books are skipped, so re-running the same call resumes an interrupted build.
    notes.push(
      `query matched ${s.largeSelection} books — a large build; if it is interrupted, re-run the same call to resume (already-indexed books are skipped).`,
    );
  }
  // Why the index has no embeddings (mirrored into structuredContent as semanticReason).
  let semanticReason: string | undefined;
  // The auto-degrade warning LEADS the text block — an automatic downgrade must never
  // read as an unqualified success (issue #41: keywordOnly:true + failures:[] looked fine).
  let degradeWarning: string | undefined;
  if (s.keywordOnlyReason === "requested") {
    semanticReason =
      "keywordOnly=true requested — no embeddings built; vector & hybrid semantic search need an embedding rebuild.";
    // semanticReason stays short (machine-scannable); the full 3-branch fix goes in the note text.
    notes.push(
      `Keyword-only index (no embeddings): mode:"keyword" search works now. For vector & hybrid semantic search: ${INSTALL_TRANSFORMERS} Then rebuild with force=true.`,
    );
  } else if (s.keywordOnlyReason === "embedder-unavailable") {
    semanticReason =
      "embedding model (@huggingface/transformers) unavailable — automatically degraded to a keyword-only index (no vectors).";
    // Must LEAD the text block (test-asserted at index 0) and carry the universal fix (#47).
    degradeWarning = `Embedding model unavailable — built a KEYWORD-ONLY index instead (mode:"keyword" search works now). ${INSTALL_TRANSFORMERS} After restarting, rebuild with force=true for vector & hybrid semantic search.`;
  }
  if (s.rerankerWarmupFailed) {
    notes.push(
      "Reranker model could not be pre-downloaded — the first hybrid/vector search will retry (until then results keep the fused order).",
    );
  }
  if (s.booksPreserved > 0) {
    notes.push(
      `${s.booksPreserved} book(s) already have embeddings and were left as-is — a keyword-only build never downgrades them (run an embedding build to refresh them).`,
    );
  }
  if (s.unplaced > 0) {
    // Unplaced markers are silent figure-linkage gaps — say so instead of a clean-looking count.
    notes.push(
      `${s.unplaced} figure marker(s) could not be placed (caption not found in extracted text) — those figures are missing from figure search.`,
    );
  }
  const pruned = s.prune && "pruned" in s.prune ? s.prune.pruned : undefined;
  if (s.prune) {
    notes.push(
      "skipped" in s.prune
        ? `Prune skipped — could not list the library (${s.prune.skipped}).`
        : s.prune.pruned.books > 0
          ? `Pruned ${s.prune.pruned.books} book(s) no longer in the library (${s.prune.pruned.chunks} chunks, ${s.prune.pruned.figures} figures).`
          : "Prune found no stale books — the index matches the library.",
    );
  }
  if (enableFts) {
    notes.push("enableFts is accepted but not yet implemented in this version (semantic-only index).");
  }

  const { failures, bookDetails } = s;
  // Surface the first few failure reasons in the text block — clients that ignore
  // structuredContent would otherwise only see an opaque "N failed".
  const failureLines = failures.slice(0, 3).map((f) => `\n- ${f}`);
  if (failures.length > 3) failureLines.push(`\n- …and ${failures.length - 3} more`);
  const summary =
    (degradeWarning ? `${degradeWarning}\n` : "") +
    `${s.keywordOnly ? "Keyword-only indexed" : "Indexed"} ${s.booksIndexed}/${s.booksRequested} book(s) (${s.booksSkipped} up-to-date, ${s.booksRefreshed > 0 ? `${s.booksRefreshed} metadata-only refreshed without re-embedding, ` : ""}${s.chunks} chunks${s.figures > 0 ? `, ${s.figures} figure captions` : ""}) in ${s.elapsedMs} ms.` +
    (failures.length ? ` ${failures.length} failed:${failureLines.join("")}` : "") +
    notes.map((n) => `\n- ${n}`).join("") +
    // which books are now searchable — Desktop never sees bookDetails (#234)
    (bookDetails.length ? `\nIndexed ids: ${bookDetails.map((d) => d.bookId).join(", ")}.` : "");

  return toolOk([{ type: "text", text: summary }], {
    booksRequested: s.booksRequested,
    booksIndexed: s.booksIndexed,
    booksSkipped: s.booksSkipped,
    booksRefreshed: s.booksRefreshed,
    ...(s.booksPreserved > 0 ? { booksPreserved: s.booksPreserved } : {}),
    chunks: s.chunks,
    figures: s.figures,
    ...(pruned ? { prunedBooks: pruned.books, prunedChunks: pruned.chunks, prunedFigures: pruned.figures } : {}),
    elapsedMs: s.elapsedMs,
    keywordOnly: s.keywordOnly,
    semanticAvailable: !s.keywordOnly,
    ...(semanticReason !== undefined ? { semanticReason } : {}),
    ...(bookDetails.length > 0 ? { bookDetails } : {}),
    failures,
  });
}

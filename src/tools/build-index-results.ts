// Non-summary results of calibre_build_index: cancelled, still running past the soft deadline
// (#284), and the re-run that reports a background build. "Still running" is a success: the
// model must not read it as a failure and retry or report an error while books keep committing.

import { toolError, toolOk } from "./result.js";
import type { BuildOutcome } from "../semantic/index-builds.js";
import type { ToolResult } from "./types.js";

/** Build-call args that pick the work; a re-run with the same key claims its build's result. */
export interface BuildSelector {
  bookId?: number | string | undefined;
  ids?: (number | string)[] | undefined;
  query?: string | undefined;
  force: boolean;
  enableFts: boolean;
  keywordOnly: boolean;
  prune: boolean;
}

/** Stable key for "the same call": every arg that changes what the build does (library aside). */
export function selectorKey(a: BuildSelector): string {
  return JSON.stringify([
    a.bookId ?? null,
    a.ids ?? null,
    a.query ?? null,
    a.force,
    a.enableFts,
    a.keywordOnly,
    a.prune,
  ]);
}

/** isError result for a build the client cancelled — partial counts, and how to resume. */
export function cancelledResult(c: {
  done: number;
  booksRequested: number;
  booksIndexed: number;
  booksSkipped: number;
  chunks: number;
}): ToolResult {
  return toolError(
    `Index build cancelled after ${c.done}/${c.booksRequested} book(s) (${c.booksIndexed} indexed, ` +
      `${c.booksSkipped} up-to-date). Books finished before the cancel stay indexed — re-run the same ` +
      "call to continue (finished books are skipped).",
    {
      booksRequested: c.booksRequested,
      booksIndexed: c.booksIndexed,
      booksSkipped: c.booksSkipped,
      chunks: c.chunks,
      cancelled: true,
    },
  );
}

/** Success-shaped status for a build still running past the soft deadline. */
export function stillRunningResult(o: Extract<BuildOutcome<ToolResult>, { kind: "running" }>): ToolResult {
  const p = o.progress;
  const finished =
    p.total > 0
      ? `${p.done}/${p.total} book(s) finished so far`
      : "still preparing (resolving the selection, loading the model)";
  const committed = p.indexedIds.length ? ` Committed so far: ids ${p.indexedIds.join(", ")}.` : "";
  const text = o.sameSelector
    ? `Index build still running in the background — not an error; committed books stay indexed. ${finished}.${committed} ` +
      "Re-run the same call to check: it waits for this build instead of starting another, and reports the final result once it is done."
    : `Another index build for this library is still running (${finished}) — not an error; this call did not start a second build, ` +
      `since two builds would contend for the same index file.${committed} Re-run this call once that build finishes.`;
  return toolOk([{ type: "text", text }], {
    stillRunning: true,
    // Counts of the RUNNING build — for a different selector that is not this call's selection.
    booksRequested: p.total,
    booksDone: p.done,
    booksIndexed: p.indexedIds.length,
    indexedIds: p.indexedIds,
  });
}

/** Lead the text with where the result came from when an earlier call started the build. */
export function fromEarlierCall(result: ToolResult, finishedAgoMs: number): ToolResult {
  const [first, ...rest] = result.content;
  if (first?.type !== "text") return result;
  const when = finishedAgoMs < 1_000 ? "just finished" : `finished ${Math.round(finishedAgoMs / 1_000)} s ago`;
  const lead = `The background build an earlier call started ${when}; its result:\n`;
  // Keep the "Error: " prefix first on a failed or cancelled build, so it still reads as one.
  const textOut = first.text.startsWith("Error: ")
    ? `Error: ${lead}${first.text.slice("Error: ".length)}`
    : lead + first.text;
  return { ...result, content: [{ ...first, text: textOut }, ...rest] };
}

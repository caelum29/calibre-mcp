// Non-summary results of calibre_build_index: cancelled, still running past the soft deadline
// (#284), and the re-run that reports a background build. "Still running" is a success: the
// model must not read it as a failure and retry or report an error while books keep committing.

import { toolError, toolOk } from "./result.js";
import type { BuildOutcome, BuildProgress } from "../semantic/index-builds.js";
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

/**
 * The flags that change what a build does to each selected book. Two calls with the same books
 * but a different mode (say force:true) are different work, so neither covers the other.
 */
export function buildModeKey(a: BuildSelector): string {
  return JSON.stringify([a.force, a.enableFts, a.keywordOnly, a.prune]);
}

/** What a refused call asked for: its ids (see {@link requestedIds}) and {@link buildModeKey}. */
export interface CallerSelection {
  ids: number[] | "query" | "uuid";
  mode: string;
}

/**
 * Numeric ids a call selected, when known without a lookup; otherwise what kind of selection
 * it was — a refused call does not resolve a query or uuids (that can take as long as a build).
 */
export function requestedIds(a: BuildSelector): number[] | "query" | "uuid" {
  if (a.query) return "query";
  const raw = [...(a.bookId === undefined ? [] : [a.bookId]), ...(a.ids ?? [])];
  if (!raw.every((id): id is number => typeof id === "number")) return "uuid";
  return [...new Set(raw)];
}

/**
 * Success-shaped status for a build still running past the soft deadline. `caller` is the
 * calling selection; it matters only when another selection's build is the one running, to
 * say which of this call's books it already covers.
 */
export function stillRunningResult(
  o: Extract<BuildOutcome<ToolResult>, { kind: "running" }>,
  caller?: CallerSelection,
): ToolResult {
  const p = o.progress;
  const status = progressText(p);
  const text = o.sameSelector
    ? `Index build still running in the background — not an error; committed books stay indexed. ${status} ` +
      "Re-run the same call to check: it waits for this build instead of starting another, and reports the final result once it is done."
    : "Another index build for this library is still running — not an error; this call did not start a second build, " +
      `since two builds would contend for the same index file. ${overlapText(p, caller)} ` +
      `That other build (not this call's selection): ${status}`;
  return toolOk([{ type: "text", text }], {
    stillRunning: true,
    runningBuild: o.sameSelector ? "this" : "other",
    // Counts of the build named by runningBuild (see the outputSchema comment).
    booksRequested: p.total,
    booksDone: p.done,
    booksIndexed: p.indexedIds.length,
    indexedIds: p.indexedIds,
    failures: p.failures,
  });
}

/** `6/11 processed (5 indexed, 1 failed)` plus committed ids and failures so far. */
function progressText(p: BuildProgress): string {
  if (p.total === 0) return "still preparing (resolving the selection, loading the model).";
  // "processed" covers skipped and failed books too, so name each kind instead of one count.
  const kept = p.done - p.indexedIds.length - p.failures.length;
  const parts = [`${p.indexedIds.length} indexed`, `${p.failures.length} failed`];
  if (kept > 0) parts.push(`${kept} already in the index`);
  let out = `Books so far: ${p.done}/${p.total} processed (${parts.join(", ")}).`;
  if (p.indexedIds.length) out += ` Committed so far: ids ${p.indexedIds.join(", ")}.`;
  if (p.failures.length) {
    const shown = p.failures.slice(0, 3);
    const more = p.failures.length > 3 ? `; …and ${p.failures.length - 3} more` : "";
    out += ` Failed so far: ${shown.join("; ")}${more}.`;
  }
  return out;
}

/** What a refused call's books have in common with the running build. */
function overlapText(p: BuildProgress, caller: CallerSelection | undefined): string {
  const requested = caller?.ids;
  if (!Array.isArray(requested) || requested.length === 0) {
    const kind = requested === "uuid" ? "uuid ids" : "a query";
    return `This call's selection (${kind}) was not checked against that build. Re-run this call once that build finishes.`;
  }
  const committed = requested.filter((id) => p.indexedIds.includes(id));
  const n = requested.length;
  const head = committed.length
    ? `${committed.length} of this call's ${n} book(s) ${committed.length === 1 ? "is" : "are"} already committed ` +
      `by the running build (${committed.length === 1 ? "id" : "ids"} ${committed.join(", ")}).`
    : `None of this call's ${n} book(s) is committed yet.`;
  // Only a resolved selection can contain the call's books; while preparing, nothing is known.
  // Same books are not the same work: a different mode (force, keywordOnly…) is not covered.
  const covered =
    p.mode === caller?.mode && p.selectedIds.length > 0 && requested.every((id) => p.selectedIds.includes(id));
  return covered
    ? `${head} All of them are part of the running build, so they will be covered when that build finishes ` +
        "(unless one fails) — re-run this call then to confirm."
    : `${head} Re-run this call once that build finishes.`;
}

/** isError result for a background build that threw: the reason, and that a re-run retries. */
export function backgroundFailedResult(reason: string, finishedAgoMs: number): ToolResult {
  return toolError(
    `The background build an earlier call started failed ${ago(finishedAgoMs)}: ${reason}. Books it committed ` +
      "before the failure stay indexed; re-run the same call to retry (finished books are skipped).",
    { backgroundBuildFailed: true, failures: [reason] },
  );
}

/** Lead the text with where the result came from when an earlier call started the build. */
export function fromEarlierCall(result: ToolResult, finishedAgoMs: number): ToolResult {
  const [first, ...rest] = result.content;
  if (first?.type !== "text") return result;
  const lead = `The background build an earlier call started finished ${ago(finishedAgoMs)}; its result:\n`;
  // Keep the "Error: " prefix first on a failed or cancelled build, so it still reads as one.
  const textOut = first.text.startsWith("Error: ")
    ? `Error: ${lead}${first.text.slice("Error: ".length)}`
    : lead + first.text;
  return { ...result, content: [{ ...first, text: textOut }, ...rest] };
}

function ago(ms: number): string {
  return ms < 1_000 ? "just now" : `${Math.round(ms / 1_000)} s ago`;
}

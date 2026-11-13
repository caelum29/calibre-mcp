// Outcome of a failed `calibredb remove` (#584). The Content Server may delete the records before
// calibredb gives up, so a timeout or a mid-request drop is settled by re-reading the ids, never
// reported as a plain failure. Shares the merge re-read (sourcesRemoved) and settleFailedStep;
// also words the steer for a remove the re-read could not confirm.

import { sourcesRemoved, type BookReader } from "./merge-verify.js";
import {
  settleFailedStep,
  unconfirmedNote,
  REREAD_CAUSE_TEXT,
  type FailedWriteOutcome,
  type ReReadCause,
  type UnconfirmedCheck,
  type UnconfirmedWording,
} from "./write-policy.js";

/** A settled remove: the outcome plus which ids the re-read showed gone and which are left. */
export interface FailedRemove {
  outcome: FailedWriteOutcome<readonly number[]>;
  /** Ids a re-read confirmed gone (404): removed, whatever the outcome says about the rest. */
  gone: number[];
  /** Ids not confirmed gone: what a re-run must still remove. */
  remaining: number[];
}

/**
 * Classify the error of a failed `calibredb remove` of `ids`, re-reading them only when the
 * remove may have committed (a drop or a timeout). No retry here: timeouts never retry.
 */
export async function settleFailedRemove(
  deps: BookReader,
  ids: readonly number[],
  err: unknown,
  library?: string,
): Promise<FailedRemove> {
  // no re-read ran (refused / transient / unexpected): nothing is known to be gone
  let remaining = [...ids];
  const outcome = await settleFailedStep(err, async () => {
    const r = await sourcesRemoved(deps, ids, library);
    remaining = r.remaining;
    return r.check;
  });
  const gone = ids.filter((id) => !remaining.includes(id));
  return { outcome, gone, remaining };
}

const idList = (ids: readonly number[]): string => ids.map((id) => `#${id}`).join(", ");

/**
 * Steer for a remove a re-read did not confirm: name what is left (a re-run with an
 * already-trashed id fails not_found) and what already went to the Trash.
 */
export function unconfirmedRemove(
  cause: ReReadCause,
  status: UnconfirmedCheck<unknown>["status"],
  settled: Pick<FailedRemove, "gone" | "remaining">,
): UnconfirmedWording {
  const { gone, remaining } = settled;
  const trashed = gone.length > 0 ? ` (${idList(gone)} already in the Trash)` : "";
  const verify = `calibre_get_book id=${remaining.join(" / id=")}`;
  const rerun = `re-run with ids=[${remaining.join(",")}] and confirm=true`;
  if (status === "not-landed") {
    const hint = `verify with ${verify}`;
    const verb = remaining.length === 1 ? "exists" : "exist";
    return {
      text: `${REREAD_CAUSE_TEXT[cause]}; ${idList(remaining)} still ${verb}${trashed} — ${hint}, then ${rerun}.`,
      hint,
    };
  }
  const note = unconfirmedNote(cause, `the removal of ${idList(remaining)}${trashed}`, verify);
  return { text: `${note.text}; if any still exists, ${rerun}.`, hint: note.hint };
}

// Outcome of a failed `calibredb remove` (#584). The Content Server may delete the records before
// calibredb gives up, so a timeout or a mid-request drop is settled by re-reading the ids, never
// reported as a plain failure. Shares the merge re-read (sourcesRemoved) and settleFailedStep.

import { sourcesRemoved, type BookReader } from "./merge-verify.js";
import { settleFailedStep, type FailedWriteOutcome } from "./write-policy.js";

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

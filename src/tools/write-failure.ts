// The one rendering of a failed routed write (#417): a settled FailedWriteOutcome → the error code
// and model-facing text. calibre_update_book, calibre_bulk_update and calibre_merge_books all
// render through it. The DECISIONS (what a failure amounts to) stay in app/write-policy.ts.

import { describeTransient, foreignNote, WRITE_REFUSED_MESSAGE } from "../app/write-policy.js";
import type { FailedWriteOutcome, ReReadCause, UnconfirmedCheck } from "../app/write-policy.js";
import { errorCodeFor, type ErrorCode } from "../domain/error-codes.js";

/** A failed write as the model sees it: the closed error code plus the text that states the next step. */
export interface FailedWriteText {
  code: ErrorCode;
  text: string;
  /** The next step the text already spells out, for a caller that must not add a second one. */
  hint?: string;
}

/** The outcomes this presenter renders: everything a re-read did not show landing. */
export type FailedWrite<T> = Exclude<FailedWriteOutcome<T>, { kind: "confirmed" | "refusedAfterLanding" }>;

/** What the caller knows about the failed write. */
export interface FailedWriteContext<T> {
  /** The book the write targeted (named in the verify steer). */
  id: number;
  /** Retries that actually ran; omit when the write went through `withTransientRetry` (it records them). */
  retries?: number;
  /** The error the write threw. */
  err: unknown;
  /**
   * Wording for a write a re-read could not confirm, when the tool words its own steer (a merge
   * step names what it verifies). Return undefined to fall back to the shared text.
   */
  unconfirmed?: (cause: ReReadCause, check: UnconfirmedCheck<T>) => string | undefined;
}

/**
 * Render a failed write. A drop is never a plain failure — it may have committed (#33) — and
 * every text carries its own next step.
 */
export function presentFailedWrite<T>(outcome: FailedWrite<T>, ctx: FailedWriteContext<T>): FailedWriteText {
  const { id, err } = ctx;
  switch (outcome.kind) {
    case "refused":
      return { code: "write_refused", text: WRITE_REFUSED_MESSAGE };
    case "transient": {
      const text = describeTransient(err, id, ctx.retries);
      // the last sentence is the step (no "retries" clause or other sentence follows it)
      return { code: "calibre_unreachable", text, hint: text.slice(text.lastIndexOf(". ") + 2) };
    }
    case "unverified":
    case "refusedUnverified": {
      const own = ctx.unconfirmed?.(outcome.cause, outcome.check);
      if (own !== undefined) return { code: "write_unverified", text: own };
      // a drop (refused after or not) keeps the "may have been committed" transient text (#342)
      if (outcome.cause === "dropped") {
        return { code: "write_unverified", text: describeTransient(err, id, ctx.retries) + foreignNote(outcome.check) };
      }
      return { code: "write_unverified", text: timedOutText(outcome.check, id) };
    }
    case "unexpected":
      return { code: errorCodeFor(err), text: err instanceof Error ? err.message : String(err) };
  }
}

/** Why a timed-out write is unverified, by what the re-read showed. */
function timedOutText(check: UnconfirmedCheck<unknown>, id: number): string {
  if (check.status === "unverifiable" && check.foreign) {
    return (
      `calibredb timed out and the write can't be confirmed.${foreignNote(check)} ` +
      `Check with calibre_get_book id=${id} before retrying.`
    );
  }
  if (check.status === "unverifiable") {
    return (
      `calibredb timed out and the book could not be re-read to verify. The write MAY ` +
      `have been applied — check with calibre_get_book id=${id} before retrying.`
    );
  }
  return (
    `calibredb timed out and a re-read does not show the changes applied. Retry, or check ` +
    `with calibre_get_book id=${id} first.`
  );
}

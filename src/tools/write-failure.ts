// The one rendering of a failed routed write (#417): a settled FailedWriteOutcome → the error code
// and model-facing text. calibre_update_book, calibre_bulk_update and calibre_merge_books all
// render through it. The DECISIONS (what a failure amounts to) stay in app/write-policy.ts.

import { describeTransient, foreignNote, WRITE_REFUSED_MESSAGE } from "../app/write-policy.js";
import type { FailedWriteOutcome, ReReadCause, UnconfirmedCheck, UnconfirmedWording } from "../app/write-policy.js";
import { defaultHint, errorCodeFor, type ErrorCode } from "../domain/error-codes.js";

/** A failed write as the model sees it: the closed error code plus the text that states the next step. */
export interface FailedWriteText {
  code: ErrorCode;
  text: string;
  /**
   * The next step, a substring of `text` (so `toolError` adds no second `Next:` line); for an
   * unexpected failure, the code's generic hint. The tool passes code, text and hint on unchanged.
   */
  hint: string | undefined;
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
  unconfirmed?: (cause: ReReadCause, check: UnconfirmedCheck<T>) => UnconfirmedWording | undefined;
}

/**
 * Render a failed write. A drop is never a plain failure — it may have committed (#33) — and
 * every text carries its own next step.
 */
export function presentFailedWrite<T>(outcome: FailedWrite<T>, ctx: FailedWriteContext<T>): FailedWriteText {
  const { id, err } = ctx;
  switch (outcome.kind) {
    case "refused":
      // WRITE_REFUSED_MESSAGE embeds this clause verbatim
      return { code: "write_refused", text: WRITE_REFUSED_MESSAGE, hint: defaultHint("write_refused") };
    case "transient": {
      const text = describeTransient(err, id, ctx.retries);
      // the last sentence is the step (no "retries" clause or other sentence follows it)
      // a gateway 5xx means the server answered — "retry shortly", not "start the server" (#494)
      const code = outcome.transient === "server" ? "calibre_busy" : "calibre_unreachable";
      return { code, text, hint: text.slice(text.lastIndexOf(". ") + 2) };
    }
    case "unverified":
    case "refusedUnverified": {
      const own = ctx.unconfirmed?.(outcome.cause, outcome.check);
      if (own !== undefined) return { code: "write_unverified", ...own };
      // a drop (refused after or not) keeps the "may have been committed" transient text (#342)
      if (outcome.cause === "dropped") {
        return {
          code: "write_unverified",
          text: describeTransient(err, id, ctx.retries) + foreignNote(outcome.check),
          hint: `verify with calibre_get_book id=${id} before retrying`,
        };
      }
      return { code: "write_unverified", ...timedOutWording(outcome.check, id) };
    }
    case "unexpected": {
      const code = errorCodeFor(err);
      return { code, text: err instanceof Error ? err.message : String(err), hint: defaultHint(code) };
    }
  }
}

/** Why a timed-out write is unverified, by what the re-read showed, and the step it names. */
function timedOutWording(check: UnconfirmedCheck<unknown>, id: number): UnconfirmedWording {
  if (check.status === "unverifiable" && check.foreign) {
    const hint = `Check with calibre_get_book id=${id} before retrying`;
    return {
      text: `calibredb timed out and the write can't be confirmed.${foreignNote(check)} ${hint}.`,
      hint,
    };
  }
  if (check.status === "unverifiable") {
    const hint = `check with calibre_get_book id=${id} before retrying`;
    return {
      text: `calibredb timed out and the book could not be re-read to verify. The write MAY have been applied — ${hint}.`,
      hint,
    };
  }
  const hint = `Retry, or check with calibre_get_book id=${id} first`;
  return { text: `calibredb timed out and a re-read does not show the changes applied. ${hint}.`, hint };
}

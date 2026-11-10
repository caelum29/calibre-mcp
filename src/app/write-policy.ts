// Write policy for routed calibredb writes (#260): one home for how every write tool treats
// a refusal, a transient failure and a timeout. Sections, in order: refusal classification,
// transient-failure retry (#233), timed-out-write verification (#33), failed-write outcome (#390).

import { CalibreCliError, CalibreCliTimeoutError } from "../domain/errors.js";
import { CONNECTION_STDERR, DROPPED_MID_REQUEST_STDERR, WRITE_REFUSED_STDERR } from "../domain/calibredb-stderr.js";
import { changesSatisfied, foreignValues, type ForeignValue } from "../domain/book-fields.js";
import type { ChangeValue } from "../domain/book-fields.js";
import type { Book } from "../domain/book.js";
import type { BaseDeps } from "../tools/deps.js";

// ── refusal ──
// Shared classification of a Content-Server write refusal. calibredb routed through the
// server returns Forbidden/401/403 when anonymous local writes are blocked; every write
// tool turns that into the same actionable guidance (CAPABILITIES §2) instead of a raw error.

/** True when a calibredb failure looks like the server refusing an anonymous write. */
export function isWriteRefused(err: unknown): boolean {
  return err instanceof CalibreCliError && WRITE_REFUSED_STDERR.test(err.stderr ?? "");
}

/** The actionable message shown when the server refuses a write. */
export const WRITE_REFUSED_MESSAGE =
  "Calibre refused the write. Anonymous writes are blocked — restart the Content Server " +
  "with --enable-local-write (localhost), or configure an authenticated non-restricted user. " +
  'See the README\'s "Enabling writes" section.';

// ── transient retry ──
// Auto-retry of transient calibredb failures for IDEMPOTENT routed writes only (#233):
// calibre_update_book and calibre_bulk_update (both `set_metadata`). Never wire it into
// add_book (duplicate risk), merge_books or remove_book (partial ops are unpredictable).

/**
 * Transient failure class. `connection` = the Content Server is unreachable or died
 * mid-request (a bulk loop stops on it: every later write would fail the same way);
 * `server` = a gateway-style 5xx for this one request (only that book fails).
 */
export type TransientKind = "connection" | "server";

/** Async pause; injectable via `ToolDeps.sleep` so tests never wait in real time. */
export type Sleep = (ms: number) => Promise<void>;

/** Pauses before retry 1 and retry 2 — 2 retries, 1 s then 3 s (#233 policy). */
export const RETRY_PAUSES_MS: readonly number[] = [1000, 3000];

/** Production sleep. */
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Patterns + probe record: domain/calibredb-stderr.ts.

// Observed with the fake server: mechanize renders a 5xx as "HTTP Error 503: Service Unavailable".
// Whether a real calibre-server ever answers 502/503/504 (vs. only a reverse proxy in front of
// it) is UNCONFIRMED. 500 is deliberately excluded — it is usually a real Calibre exception.
const GATEWAY_5XX = /HTTP Error (50[234])\b/;

/**
 * Classify a calibredb failure as transient, or `undefined` when it must not be retried.
 * Timeouts are never transient: a timed-out routed write may already have committed, and the
 * #33 verify-by-re-read is the only timeout path.
 */
export function classifyTransient(err: unknown): TransientKind | undefined {
  if (!(err instanceof CalibreCliError) || err instanceof CalibreCliTimeoutError) return undefined;
  const stderr = err.stderr ?? "";
  if (CONNECTION_STDERR.test(stderr)) return "connection";
  if (GATEWAY_5XX.test(stderr)) return "server";
  return undefined;
}

/**
 * Run an idempotent write, retrying transient failures per {@link RETRY_PAUSES_MS}. Any other
 * error (refusal, 500, timeout, data error) is rethrown at once; on exhaustion the last
 * transient error is rethrown so the caller can classify it again.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, sleep: Sleep = realSleep): Promise<T> {
  let dropped = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // an earlier attempt may have committed even when a later one fails differently (#370)
      dropped ||= droppedByStderr(err);
      const pause = RETRY_PAUSES_MS[attempt];
      if (pause === undefined || classifyTransient(err) === undefined) {
        if (typeof err === "object" && err !== null) retryRecord.set(err, { dropped, retries: attempt });
        throw err;
      }
      await sleep(pause);
    }
  }
}

// What the retry loop saw before throwing this error: whether SOME attempt dropped mid-request
// (#370) and how many retries ran. A WeakMap keeps the error's type, so classification is unchanged.
const retryRecord = new WeakMap<object, { dropped: boolean; retries: number }>();

function recordOf(err: unknown): { dropped: boolean; retries: number } | undefined {
  return typeof err === "object" && err !== null ? retryRecord.get(err) : undefined;
}

function droppedByStderr(err: unknown): boolean {
  return (
    classifyTransient(err) === "connection" && DROPPED_MID_REQUEST_STDERR.test((err as CalibreCliError).stderr ?? "")
  );
}

/**
 * True when the connection dropped after the request was sent, so the write may have landed —
 * on this error, or on any earlier attempt of the {@link withTransientRetry} that threw it.
 */
export function isDroppedMidRequest(err: unknown): boolean {
  return droppedByStderr(err) || recordOf(err)?.dropped === true;
}

/**
 * Model-facing reason for a write to book `id` that stayed transient after every retry. A
 * mid-request drop is never reported as a plain failure — it may have committed (#33).
 */
export function describeTransient(err: unknown, id: number): string {
  // the real count: a timeout or 500 after a drop ends the loop early (#370)
  const n = recordOf(err)?.retries ?? RETRY_PAUSES_MS.length;
  // a first-attempt failure ran no retry, so it gets no clause rather than "after 0 retries"
  const retries = n === 0 ? "" : n === 1 ? " after 1 retry" : ` after ${n} retries`;
  if (isDroppedMidRequest(err)) {
    return (
      `The connection to the Calibre Content Server dropped mid-request${retries}; the write ` +
      `may have been committed — verify with calibre_get_book id=${id} before retrying.`
    );
  }
  if (classifyTransient(err) === "connection") {
    return (
      `Could not reach the Calibre Content Server (connection refused or dropped)${retries}. ` +
      `Check that Calibre / its Content Server is running, then retry.`
    );
  }
  const status = err instanceof CalibreCliError ? GATEWAY_5XX.exec(err.stderr ?? "")?.[1] : undefined;
  return `The Calibre Content Server answered HTTP ${status ?? "5xx"}${retries}; it may be restarting — retry shortly.`;
}

// ── timeout verification ──
// Shared #33 check for routed writes whose calibredb call TIMED OUT. The Content Server may
// have committed before the CLI gave up, so every write tool re-reads the book and decides
// landed / not-landed / unverifiable from that, instead of reporting the timeout as failure.

/** What a write that may have committed is, judged from a re-read; `after` is what was read. */
export type ReReadCheck<T> =
  | { status: "landed"; after: T }
  | { status: "not-landed" }
  /** `foreign`: the re-read shows values that are neither the old nor ours (#370). */
  | { status: "unverifiable"; foreign?: ForeignValue[] };

/** What a timed-out `set_metadata` is, judged from a re-read of the book. */
export type TimedOutWriteCheck = ReReadCheck<Book>;

/** The write being verified: target book, its pre-write snapshot, and the requested changes. */
export interface TimedOutWrite {
  id: number;
  before: Book;
  changes: Record<string, ChangeValue>;
  library?: string;
}

/**
 * Re-read the book after a timed-out routed write and classify it. A failed re-read is
 * `unverifiable` (the write MAY have landed), never `not-landed`.
 */
export async function verifyTimedOutWrite(deps: BaseDeps, write: TimedOutWrite): Promise<TimedOutWriteCheck> {
  // nothing requested means nothing to confirm — don't let an empty set read as "landed"
  if (Object.keys(write.changes).length === 0) return { status: "unverifiable" };
  let after: Book;
  try {
    after = await deps.content.getBook(write.id, write.library);
  } catch {
    return { status: "unverifiable" };
  }
  if (changesSatisfied(write.before, after, write.changes)) return { status: "landed", after };
  // a third value (GUI edit, stale snapshot) may hide our write — never call that "not landed"
  const foreign = foreignValues(write.before, after, write.changes);
  return foreign.length > 0 ? { status: "unverifiable", foreign } : { status: "not-landed" };
}

/** Why a write's success comes from a re-read, not from calibredb's reply (#370). */
export type ReReadCause = "dropped" | "timeout";

/** Text for a write a re-read confirmed, e.g. ` Confirmed by a re-read after calibredb timed out.` */
export function reReadNote(cause: ReReadCause): string {
  return cause === "dropped"
    ? " Confirmed by a re-read after the connection dropped mid-request."
    : " Confirmed by a re-read after calibredb timed out.";
}

/** Longest value shown per side in a {@link foreignNote}. */
const MAX_NOTE_VALUE = 60;

/**
 * Text naming the third values a re-read found, e.g. ` A re-read shows publisher reads back
 * "GUI", not the requested "New" — …`; "" when the check found none. Same in both channels.
 */
export function foreignNote(check: TimedOutWriteCheck): string {
  if (check.status !== "unverifiable" || !check.foreign?.length) return "";
  const show = (v: unknown): string => {
    const s = JSON.stringify(v ?? null);
    return s.length > MAX_NOTE_VALUE ? `${s.slice(0, MAX_NOTE_VALUE - 1)}…` : s;
  };
  const fields = check.foreign.map(
    (f) => `${f.field} reads back ${show(f.after)}, not the requested ${show(f.intended)}`,
  );
  return (
    ` A re-read shows ${fields.join("; ")} — another edit (e.g. the Calibre GUI) or Calibre's own ` +
    "normalization may explain it."
  );
}

// ── failed-write outcome ──
// One mapping (#390) from a failed routed `set_metadata` to what happened, so the single-book and
// bulk tools only render it. The order is fixed: a refusal that followed a drop is re-read first,
// since the dropped attempt may have committed (#370); a plain timeout is re-read last (#33).

/** A re-read that did not confirm the write: every {@link ReReadCheck} but `landed`. */
export type UnconfirmedCheck<T = Book> = Exclude<ReReadCheck<T>, { status: "landed" }>;

/** What a failed routed write amounts to, judged from its error and, when it may have committed, a re-read. */
export type FailedWriteOutcome<T = Book> =
  /** A re-read shows every requested change: success. `refused`: a refusal followed the drop. */
  | { kind: "confirmed"; cause: ReReadCause; after: T; refused: boolean }
  /** It may have committed, but the re-read can't confirm it: steer to calibre_get_book. */
  | { kind: "unverified"; cause: ReReadCause; check: UnconfirmedCheck<T>; refused: boolean }
  /** The server refused the write, and nothing a dropped attempt sent landed. */
  | { kind: "refused" }
  /** Retries exhausted on a failure that never reached the server. */
  | { kind: "transient"; transient: TransientKind }
  /** None of the above: the caller reports or rethrows `err` as is. */
  | { kind: "unexpected" };

/**
 * Classify the error of a failed routed write, re-reading the book whenever it may have
 * committed (a drop on any attempt, or a timeout). A committed write is never a failure (#33).
 */
export async function settleFailedWrite(
  deps: BaseDeps,
  write: TimedOutWrite,
  err: unknown,
): Promise<FailedWriteOutcome> {
  return settleFailedStep(err, () => verifyTimedOutWrite(deps, write));
}

/**
 * {@link settleFailedWrite} for any routed write (`add_format`, `remove`, …): `reRead` checks
 * whether this write landed and runs only when it may have committed (a drop or a timeout).
 */
export async function settleFailedStep<T>(
  err: unknown,
  reRead: () => Promise<ReReadCheck<T>>,
): Promise<FailedWriteOutcome<T>> {
  const refused = isWriteRefused(err);
  if (isDroppedMidRequest(err)) return judge(await reRead(), "dropped", refused);
  if (refused) return { kind: "refused" };
  const transient = classifyTransient(err);
  if (transient) return { kind: "transient", transient };
  if (err instanceof CalibreCliTimeoutError) return judge(await reRead(), "timeout", false);
  return { kind: "unexpected" };
}

function judge<T>(check: ReReadCheck<T>, cause: ReReadCause, refused: boolean): FailedWriteOutcome<T> {
  if (check.status === "landed") return { kind: "confirmed", cause, after: check.after, refused };
  // a refusal is the answer once the re-read shows the dropped attempt did not land (#370)
  if (refused && check.status === "not-landed") return { kind: "refused" };
  return { kind: "unverified", cause, check, refused };
}

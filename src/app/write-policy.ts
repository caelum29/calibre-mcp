// Write policy for routed calibredb writes (#260): one home for how every write tool treats
// a refusal, a transient failure and a timeout. Sections, in order: refusal classification,
// transient-failure retry (#233), timed-out-write verification (#33).

import { CalibreCliError, CalibreCliTimeoutError } from "../domain/errors.js";
import { changesSatisfied } from "../domain/book-fields.js";
import type { ChangeValue } from "../domain/book-fields.js";
import type { Book } from "../domain/book.js";
import type { ToolDeps } from "../tools/deps.js";

// ── refusal ──
// Shared classification of a Content-Server write refusal. calibredb routed through the
// server returns Forbidden/401/403 when anonymous local writes are blocked; every write
// tool turns that into the same actionable guidance (CAPABILITIES §2) instead of a raw error.

// calibredb never prints "401" for an auth-enabled server, only the credentials prompt (#237)
const WRITE_REFUSED = /forbidden|unauthorized|\b401\b|\b403\b|username and password is required/i;

/** True when a calibredb failure looks like the server refusing an anonymous write. */
export function isWriteRefused(err: unknown): boolean {
  return err instanceof CalibreCliError && WRITE_REFUSED.test(err.stderr ?? "");
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

// Observed in the #233 probes (calibredb 9.x client, `--with-library http://localhost:8099/#lib`
// `set_metadata`; exit code 1 in every case; record: docs/dev/probes/233-transient-stderr.md):
//   stopped server        → "ConnectionRefusedError: [Errno 61] Connection refused" (CONFIRMED, real server)
//   killed mid-request    → "ConnectionResetError: [Errno 54] Connection reset by peer" (CONFIRMED, real server)
//   closed, no response   → "http.client.RemoteDisconnected: Remote end closed connection without response"
//                           (UNCONFIRMED — seen only with a fake server; matched defensively)
const CONNECTION = /connection refused|connection reset|remote end closed connection/i;

// A drop AFTER the request went out: the server may already have committed the write (#33 rule).
// `connection refused` is excluded — that request never reached the server.
const DROPPED_MID_REQUEST = /connection reset|remote end closed connection/i;

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
  if (CONNECTION.test(stderr)) return "connection";
  if (GATEWAY_5XX.test(stderr)) return "server";
  return undefined;
}

/**
 * Run an idempotent write, retrying transient failures per {@link RETRY_PAUSES_MS}. Any other
 * error (refusal, 500, timeout, data error) is rethrown at once; on exhaustion the last
 * transient error is rethrown so the caller can classify it again.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, sleep: Sleep = realSleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const pause = RETRY_PAUSES_MS[attempt];
      if (pause === undefined || classifyTransient(err) === undefined) throw err;
      await sleep(pause);
    }
  }
}

/** True when the connection dropped after the request was sent, so the write may have landed. */
export function isDroppedMidRequest(err: unknown): boolean {
  return classifyTransient(err) === "connection" && DROPPED_MID_REQUEST.test((err as CalibreCliError).stderr ?? "");
}

/**
 * Model-facing reason for a write to book `id` that stayed transient after every retry. A
 * mid-request drop is never reported as a plain failure — it may have committed (#33).
 */
export function describeTransient(err: unknown, id: number): string {
  const retries = `after ${RETRY_PAUSES_MS.length} retries`;
  if (isDroppedMidRequest(err)) {
    return (
      `The connection to the Calibre Content Server dropped mid-request ${retries}; the write ` +
      `may have been committed — verify with calibre_get_book id=${id} before retrying.`
    );
  }
  if (classifyTransient(err) === "connection") {
    return (
      `Could not reach the Calibre Content Server (connection refused or dropped) ${retries}. ` +
      `Check that Calibre / its Content Server is running, then retry.`
    );
  }
  const status = err instanceof CalibreCliError ? GATEWAY_5XX.exec(err.stderr ?? "")?.[1] : undefined;
  return `The Calibre Content Server answered HTTP ${status ?? "5xx"} ${retries}; it may be restarting — retry shortly.`;
}

// ── timeout verification ──
// Shared #33 check for routed writes whose calibredb call TIMED OUT. The Content Server may
// have committed before the CLI gave up, so every write tool re-reads the book and decides
// landed / not-landed / unverifiable from that, instead of reporting the timeout as failure.

/** What a timed-out write is, judged from a re-read of the book. */
export type TimedOutWriteCheck =
  | { status: "landed"; after: Book }
  | { status: "not-landed" }
  | { status: "unverifiable" };

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
export async function verifyTimedOutWrite(deps: ToolDeps, write: TimedOutWrite): Promise<TimedOutWriteCheck> {
  // nothing requested means nothing to confirm — don't let an empty set read as "landed"
  if (Object.keys(write.changes).length === 0) return { status: "unverifiable" };
  let after: Book;
  try {
    after = await deps.content.getBook(write.id, write.library);
  } catch {
    return { status: "unverifiable" };
  }
  return changesSatisfied(write.before, after, write.changes) ? { status: "landed", after } : { status: "not-landed" };
}

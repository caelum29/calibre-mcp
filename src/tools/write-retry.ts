// Auto-retry of transient calibredb failures for IDEMPOTENT routed writes only (#233):
// calibre_update_book and calibre_bulk_update (both `set_metadata`). Never wire it into
// add_book (duplicate risk), merge_books or remove_book (partial ops are unpredictable).

import { CalibreCliError, CalibreCliTimeoutError } from "../domain/errors.js";

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

// Observed in the #233 probe (calibredb 9.x client, `--with-library http://localhost:8099/#lib`
// `set_metadata` against a stopped port and a fake HTTP server; exit code 1 in every case):
//   stopped server  → "ConnectionRefusedError: [Errno 61] Connection refused"
//   socket RST      → "ConnectionResetError: [Errno 54] Connection reset by peer"
//   socket closed   → "http.client.RemoteDisconnected: Remote end closed connection without response"
// The real calibre-server could not be started next to the running GUI (global single-instance
// lock), so which of reset / remote-closed a real mid-request kill or restart produces is
// UNCONFIRMED — both are matched.
const CONNECTION = /connection refused|connection reset|remote end closed connection/i;

// Observed in the same probe: mechanize renders a 5xx as "HTTP Error 503: Service Unavailable".
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

/** Model-facing reason for a write that stayed transient after every retry. */
export function describeTransient(err: unknown): string {
  const retries = `after ${RETRY_PAUSES_MS.length} retries`;
  if (classifyTransient(err) === "connection") {
    return (
      `Could not reach the Calibre Content Server (connection refused or dropped) ${retries}. ` +
      `Check that Calibre / its Content Server is running, then retry.`
    );
  }
  const status = err instanceof CalibreCliError ? GATEWAY_5XX.exec(err.stderr ?? "")?.[1] : undefined;
  return `The Calibre Content Server answered HTTP ${status ?? "5xx"} ${retries}; it may be restarting — retry shortly.`;
}

// One time budget per tool call, shared by every Calibre sub-call inside it. Separate per-call
// timeouts used to stack (30 s saved_searches + 60 s fts_search = 90 s) past the client's 60 s
// window, so the model saw a transport timeout instead of an actionable error.

import { DeadlineExceededError } from "../domain/errors.js";

/**
 * Soft deadline for one tool call: under the MCP SDK client's 60 s DEFAULT_REQUEST_TIMEOUT_MSEC,
 * leaving margin for the result to travel. Shared with calibre_build_index (#284). Guess; tune
 * in #284 once the real-client timeout check is in.
 */
export const TOOL_SOFT_DEADLINE_MS = 45_000;

/**
 * Below this, a sub-call can't do useful work — fail with DeadlineExceededError instead of
 * starting a request that is certain to time out (and would wrongly flag the library busy).
 */
const MIN_SUBCALL_MS = 250;

/** A fixed point in time that every sub-call of one tool call budgets against. */
export class Deadline {
  readonly #endsAt: number;
  readonly #startedAt: number;

  /** `totalMs` from now; `now` is injectable for tests. */
  constructor(
    readonly totalMs: number = TOOL_SOFT_DEADLINE_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.#startedAt = now();
    this.#endsAt = this.#startedAt + totalMs;
  }

  /** Milliseconds left (never negative). */
  remainingMs(): number {
    return Math.max(0, this.#endsAt - this.now());
  }

  /** Milliseconds since the call started. */
  elapsedMs(): number {
    return this.now() - this.#startedAt;
  }

  /**
   * The timeout to hand the next sub-call: whatever is left, capped at `capMs` when given.
   * Throws {@link DeadlineExceededError} when too little remains to be worth starting.
   */
  timeoutFor(capMs?: number): number {
    const left = this.remainingMs();
    if (left < MIN_SUBCALL_MS) throw new DeadlineExceededError(this.totalMs);
    return capMs === undefined ? left : Math.min(left, capMs);
  }
}

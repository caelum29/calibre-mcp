// Per-library "busy" circuit breaker. Calibre runs each Content Server / calibredb request to
// completion even after the client gives up, and a full-text search holds the library's write
// lock for its whole run — so after one timeout, every further call on that library just
// queues behind the stalled one (observed: 3–10 min). Fail fast instead, per library.

import { CalibreBusyError } from "../domain/errors.js";

/**
 * First busy window after a timeout. Basis: a stalled FTS-with-snippets on ~1100 books took
 * ~3 min to drain in the 2026-10-31 run; a 60 s window then doubling covers that in 3 strikes.
 */
const BASE_WINDOW_MS = 60_000;
/** Ceiling for the doubling window, so a long-stalled library is still re-probed regularly. */
const MAX_WINDOW_MS = 5 * 60_000;

/** One library currently flagged busy, as calibre_ping reports it. */
export interface BusyLibrary {
  libraryId: string;
  /** What timed out (e.g. "calibredb", "content-server"). */
  source: string;
  /** ISO time the latest timeout was seen. */
  since: string;
  retryInMs: number;
}

/** The read-only view calibre_ping needs (narrow port). */
export interface BusyStatusPort {
  /** Libraries whose busy window is still open. */
  busyLibraries(): BusyLibrary[];
}

interface Entry {
  until: number;
  strikes: number;
  source: string;
  since: number;
}

/**
 * Open after a timeout, fail fast while open, let calls through once the window ends
 * (half-open): success closes it, another timeout reopens it with a doubled window.
 */
export class LibraryBusyTracker implements BusyStatusPort {
  readonly #entries = new Map<string, Entry>();

  /** Window sizes and clock are injectable for tests. */
  constructor(private readonly opts: { baseWindowMs?: number; maxWindowMs?: number; now?: () => number } = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Throws {@link CalibreBusyError} while `libraryId`'s busy window is open. */
  assertAvailable(libraryId: string): void {
    const e = this.#entries.get(libraryId);
    if (!e) return;
    const left = e.until - this.now();
    if (left > 0) throw new CalibreBusyError(libraryId, left);
  }

  /** Record a timeout on `libraryId`: opens (or, after a half-open probe failed, doubles) the window. */
  markBusy(libraryId: string, source: string): void {
    const prev = this.#entries.get(libraryId);
    const strikes = (prev?.strikes ?? 0) + 1;
    const base = this.opts.baseWindowMs ?? BASE_WINDOW_MS;
    const window = Math.min(base * 2 ** (strikes - 1), this.opts.maxWindowMs ?? MAX_WINDOW_MS);
    const now = this.now();
    this.#entries.set(libraryId, { until: now + window, strikes, source, since: now });
  }

  /** A call on `libraryId` completed: the library answers again, so forget its strikes. */
  markOk(libraryId: string): void {
    this.#entries.delete(libraryId);
  }

  /** {@inheritDoc BusyStatusPort.busyLibraries} */
  busyLibraries(): BusyLibrary[] {
    const now = this.now();
    return [...this.#entries]
      .filter(([, e]) => e.until > now)
      .map(([libraryId, e]) => ({
        libraryId,
        source: e.source,
        since: new Date(e.since).toISOString(),
        retryInMs: e.until - now,
      }));
  }
}

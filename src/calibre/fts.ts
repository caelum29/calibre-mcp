// Full-text search over the Content Server's two-phase FTS API (what Calibre's web UI uses):
// rank matches without snippets, then fetch snippets one book at a time under a time budget.
// Why: `calibredb fts_search --include-snippets` builds a snippet for EVERY match before replying
// (534 rows ≈ 0.3 s each on 1.1k books) while holding the library write lock, so one query
// stalled the whole library for minutes and could not be cancelled.

import {
  CalibreBusyError,
  CalibreHttpTimeoutError,
  DeadlineExceededError,
  FtsError,
  OperationCancelledError,
} from "../domain/errors.js";
import type { FtsMatches } from "../domain/search.js";
import type { Deadline } from "../shared/deadline.js";
import type { ContentServerClient } from "./content-server.js";
import { repairSnippets } from "./fts-highlight.js";
import type { LibId } from "./lib-id.js";

/** Highlight markers wrapped around matched words in snippets. */
export const FTS_MATCH_START = ">>";
/** See {@link FTS_MATCH_START}. */
export const FTS_MATCH_END = "<<";

/** Snippet length in tokens — 64 is Calibre's maximum and what calibredb used before. */
const SNIPPET_SIZE = 64;

/**
 * Wall time one call may spend fetching snippets. Basis: 0.3–4 s per large book measured on
 * 2026-10-31; 20 s leaves the rest of the 45 s deadline for matching, a last slow book and the
 * reply. Guess; tune from call logs.
 */
const SNIPPET_BUDGET_MS = 20_000;
/** Don't start another snippet request with less than this left on the call's deadline. */
const SNIPPET_RESERVE_MS = 10_000;

/**
 * How long a library's "FTS disabled" answer is trusted. The 428 itself costs ~2 ms, but behind
 * a held write lock even that check blocks; 60 s still picks up FTS being enabled in the GUI fast.
 */
const DISABLED_TTL_MS = 60_000;

/** Why snippet fetching stopped before covering every requested book. */
export type SnippetStop = "budget" | "timeout" | "busy" | "error";

/** Snippets for a page of books; `skipped` books got none because fetching stopped early. */
export interface SnippetBatch {
  byBook: Map<number, string[]>;
  skipped: number[];
  stoppedBy?: SnippetStop;
}

/** The full-text search use case calibre_search needs (narrow port; fakeable in tests). */
export interface FtsPort {
  /** Ranked matching books (no snippets). Throws FtsError for FTS-off / bad query. */
  match(query: string, libId: LibId, call: FtsCallBudget): Promise<FtsMatches>;
  /** Snippets for `bookIds`, one book per request, stopping at the snippet time budget. */
  snippets(query: string, libId: LibId, bookIds: number[], call: FtsCallBudget): Promise<SnippetBatch>;
}

/** The calling tool's shared deadline and its cancellation signal. */
export interface FtsCallBudget {
  deadline: Deadline;
  signal?: AbortSignal;
}

type FtsHttp = Pick<ContentServerClient, "ftsSearch" | "ftsSnippets">;

/** {@link FtsPort} over the Content Server, with a per-library "FTS disabled" cache. */
export class FullTextSearch implements FtsPort {
  readonly #disabledAt = new Map<LibId, number>();

  /** Clock is injectable for tests. */
  constructor(
    private readonly http: FtsHttp,
    private readonly now: () => number = Date.now,
  ) {}

  /** {@inheritDoc FtsPort.match} */
  async match(query: string, libId: LibId, { deadline, signal }: FtsCallBudget): Promise<FtsMatches> {
    this.#refuseIfKnownDisabled(libId);
    return this.#track(libId, () => this.http.ftsSearch(query, libId, { timeoutMs: deadline.timeoutFor(), signal }));
  }

  /** {@inheritDoc FtsPort.snippets} */
  async snippets(
    query: string,
    libId: LibId,
    bookIds: number[],
    { deadline, signal }: FtsCallBudget,
  ): Promise<SnippetBatch> {
    this.#refuseIfKnownDisabled(libId);
    const byBook = new Map<number, string[]>();
    const loopStart = deadline.elapsedMs();
    for (const [i, id] of bookIds.entries()) {
      // One book per request: the server's write lock is released between books, and an
      // abandoned request can only overrun by one book's worth of work.
      const overBudget = deadline.elapsedMs() - loopStart >= SNIPPET_BUDGET_MS;
      if (overBudget || deadline.remainingMs() < SNIPPET_RESERVE_MS) {
        return { byBook, skipped: bookIds.slice(i), stoppedBy: "budget" };
      }
      try {
        const got = await this.#track(libId, () =>
          this.http.ftsSnippets(query, libId, [id], {
            timeoutMs: deadline.timeoutFor(),
            signal,
            start: FTS_MATCH_START,
            end: FTS_MATCH_END,
            size: SNIPPET_SIZE,
          }),
        );
        // Calibre can misplace highlights (#308) — fix them before anyone renders them.
        byBook.set(id, repairSnippets(query, got.get(id) ?? [], { start: FTS_MATCH_START, end: FTS_MATCH_END }));
      } catch (err) {
        const stop = snippetStop(err);
        if (stop === undefined) throw err;
        return { byBook, skipped: bookIds.slice(i), stoppedBy: stop };
      }
    }
    return { byBook, skipped: [] };
  }

  #refuseIfKnownDisabled(libId: LibId): void {
    const at = this.#disabledAt.get(libId);
    if (at !== undefined && this.now() - at < DISABLED_TTL_MS) throw new FtsError("FTS_DISABLED", libId);
  }

  // Remember a 428 so repeat calls don't touch Calibre; any successful FTS reply clears it.
  async #track<T>(libId: LibId, run: () => Promise<T>): Promise<T> {
    try {
      const out = await run();
      this.#disabledAt.delete(libId);
      return out;
    } catch (err) {
      if (err instanceof FtsError && err.code === "FTS_DISABLED") this.#disabledAt.set(libId, this.now());
      throw err;
    }
  }
}

// Snippets are a nicety on top of the matches: a stall ends the loop, it doesn't fail the call.
// FTS refusals and cancellation still propagate (they change what the caller should say).
function snippetStop(err: unknown): SnippetStop | undefined {
  if (err instanceof CalibreHttpTimeoutError || err instanceof DeadlineExceededError) return "timeout";
  if (err instanceof CalibreBusyError) return "busy";
  if (err instanceof FtsError || err instanceof OperationCancelledError) return undefined;
  return "error";
}

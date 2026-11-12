// Search-time check that semantic hits still exist in the library (#579): books removed or merged
// in the Calibre GUI keep their index rows until a pruning build, and a hit on one sends the model
// into a not_found. One Content Server request for the hit ids only; best-effort by contract.

import type { LibraryReader } from "../calibre/content-server.js";
import type { LogSink } from "../logging.js";
import type { IndexWriter } from "../semantic/store/types.js";
import { within } from "../shared/within.js";
import { pruneRemovedBooks } from "./prune-removed.js";

/** The ports the check uses: one id search, and the index prune for what it finds gone. */
export interface LiveHitsDeps {
  content: Pick<LibraryReader, "search">;
  index: Pick<IndexWriter, "deleteBooks">;
  log: LogSink;
}

// The check is a nicety on top of a finished ranking: past this it gives up and keeps every hit.
// Live probes answer a top-50 id query in ~25 ms, so this only bites on a stuck server.
export const LIVE_CHECK_MS = 1500;

/**
 * Ids among `bookIds` the library no longer holds, pruned from the index best-effort. Empty when
 * every book is live, and also when the check failed, timed out or got an answer that does not
 * fit the question: then nothing is dropped (today's behaviour). Never throws.
 */
export async function goneBooks(
  deps: LiveHitsDeps,
  libraryId: string,
  bookIds: readonly number[],
): Promise<ReadonlySet<number>> {
  const asked = [...new Set(bookIds)];
  if (asked.length === 0) return new Set();
  const live = await within(liveSubset(deps, libraryId, asked), LIVE_CHECK_MS, undefined);
  if (!live) {
    deps.log.warn("live-hit check skipped; stale hits are kept", { libraryId, ids: asked.length });
    return new Set();
  }
  const gone = new Set(asked.filter((id) => !live.has(id)));
  // the prune's own note is for write results; here the hit is already dropped, so it only logs
  if (gone.size > 0) pruneRemovedBooks(deps, libraryId, [...gone]);
  return gone;
}

/** The live subset of `asked`, or undefined when the answer can't be trusted. */
async function liveSubset(
  deps: LiveHitsDeps,
  libraryId: string,
  asked: readonly number[],
): Promise<Set<number> | undefined> {
  try {
    const page = await deps.content.search({
      query: asked.map((id) => `id:=${id}`).join(" or "),
      library: libraryId,
      num: asked.length,
      timeoutMs: LIVE_CHECK_MS,
      // a slow read-only probe must not flag the library busy for the real calls after it
      noBreaker: true,
    });
    const got: unknown = page.bookIds;
    if (!Array.isArray(got)) return undefined;
    const want = new Set(asked);
    // an id we did not ask about means the server answered some other question
    if (!got.every((id) => typeof id === "number" && want.has(id))) return undefined;
    return new Set(got as number[]);
  } catch (err) {
    deps.log.warn("live-hit check failed", { libraryId, error: String(err) });
    return undefined;
  }
}

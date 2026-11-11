// Follow a confirmed remove or merge into the semantic index (#496): drop the vanished ids so
// semantic search stops returning books the library no longer holds. Best-effort by contract —
// the library write already committed, so a prune problem only adds one note, never an error.

import type { LogSink } from "../logging.js";
import { isIndexBusy } from "../semantic/index-busy.js";
import type { IndexWriter } from "../semantic/store/types.js";

/** The one index port the prune needs. */
export interface PruneRemovedDeps {
  index: Pick<IndexWriter, "deleteBooks">;
  log: LogSink;
}

/**
 * Drop `bookIds` from library `libraryId`'s index without waiting on another process's lock.
 * Call it only after the remove is confirmed. Returns undefined when done (or nothing was
 * indexed), else the one model-facing note for the write result. Never throws.
 */
export function pruneRemovedBooks(
  deps: PruneRemovedDeps,
  libraryId: string,
  bookIds: readonly number[],
): string | undefined {
  try {
    deps.index.deleteBooks(libraryId, [...bookIds], { noWait: true });
    return undefined;
  } catch (err) {
    deps.log.warn("index prune after remove skipped", { libraryId, bookIds, error: String(err) });
    // a lock is transient: say "busy", not that the index is broken
    const why = isIndexBusy(err) ? "the index is busy (another process holds it)" : "the index could not be written";
    return (
      `Semantic index not updated: ${why}. The removed book(s) can still show up in ` +
      "calibre_semantic_search until calibre_build_index runs with prune=true."
    );
  }
}

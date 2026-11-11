// A no-op semantic-index prune port for remove/merge fakes (#496): those tools drop removed ids
// from the index after a confirmed write; tests that don't look at the index just need the port.

import type { BaseDeps } from "../../src/tools/deps.js";

/** Spread into a fake's deps: an index whose prune succeeds and removes nothing. */
export const noPruneIndex = {
  index: { deleteBooks: () => ({ books: 0, chunks: 0, figures: 0 }) },
};

/** BaseDeps plus the no-op prune port — what calibre_remove_book / calibre_merge_books take. */
export type WithPrune = BaseDeps & typeof noPruneIndex;

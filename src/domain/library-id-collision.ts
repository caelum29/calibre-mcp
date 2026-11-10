// Case-only library id clashes (#388): Calibre ids are case-sensitive ("Books" ≠ "books"), but on a
// case-insensitive volume (default APFS) both name ONE index file and ONE progress log. Detect and
// refuse: the library indexed first owns the files (#414, decided in semantic/store/library-owner.ts).
// SDK-free.

/** A library refused for indexing: its id differs only in letter case from `owner`, indexed first (#388, #414). */
export class LibraryIdCollisionError extends Error {
  constructor(
    readonly refused: string,
    readonly owner: string,
  ) {
    super(
      `Library "${refused}" can't be indexed: its id differs only in letter case from library "${owner}", ` +
        "which was indexed first and owns the index. On a case-insensitive disk (the macOS default) both ids " +
        "would share one index file and one progress log. " +
        `Rename the folder of library "${refused}" (e.g. "${refused}" → "${refused}-2") and restart Calibre's ` +
        `Content Server; library "${owner}" keeps working meanwhile. ` +
        `If an index for this pair existed before, it may hold the other library's books: after renaming, rebuild "${owner}" ` +
        "with calibre_build_index { force: true }.",
    );
    this.name = "LibraryIdCollisionError";
  }
}

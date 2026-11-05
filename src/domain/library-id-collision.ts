// Case-only library id clashes (#388): Calibre ids are case-sensitive ("Books" ≠ "books"), but on a
// case-insensitive volume (default APFS) both name ONE index file and ONE progress log. Option 3,
// detect and refuse: the code-point-first id keeps its files, every other one is refused. SDK-free.

/**
 * The id that owns the shared files when `libraryId` clashes case-insensitively with a known id,
 * else undefined (no clash, or `libraryId` is the owner itself). The owner is the code-point-first
 * id, so the verdict never depends on the order Calibre lists libraries in.
 */
export function caseCollisionOwner(libraryId: string, knownIds: Iterable<string>): string | undefined {
  const folded = libraryId.toLowerCase();
  let owner = libraryId;
  for (const id of knownIds) {
    if (id !== libraryId && id.toLowerCase() === folded && id < owner) owner = id;
  }
  return owner === libraryId ? undefined : owner;
}

/** A library refused for indexing: its id differs from `owner` only in letter case (#388). */
export class LibraryIdCollisionError extends Error {
  constructor(
    readonly refused: string,
    readonly owner: string,
  ) {
    super(
      `Library "${refused}" can't be indexed: its id differs only in letter case from library "${owner}", ` +
        "and on a case-insensitive disk (the macOS default) both would share one index file and one progress log. " +
        `Rename one of the two library folders (e.g. "${refused}" → "${refused}-2") and restart Calibre's Content Server; ` +
        `library "${owner}" keeps working meanwhile.`,
    );
    this.name = "LibraryIdCollisionError";
  }
}

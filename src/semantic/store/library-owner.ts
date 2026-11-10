// The one home of the case-only library-id decision (#388, #414). On a case-insensitive volume
// "books" and "Books" name ONE index file. The library indexed first owns it: its id is recorded
// in the file's meta, and every other id that differs from it only in letter case is refused.

import { readdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { LibraryIdCollisionError } from "../../domain/library-id-collision.js";
import { ensureIndexOwner, indexFileName, readIndexOwner } from "./schema.js";

/**
 * Decides whether a library may use its index file (#414). Required by `IndexConnections`, so no
 * store can be built without it.
 */
export interface LibraryIdGuard {
  /**
   * The refusal for `libraryId` when an index file of the same case-folded name is owned by an id
   * that differs from it only in letter case, else undefined. Reads only; never creates a file. A
   * file locked past a short wait gives no verdict; a missing index directory means no owner; any
   * other failure to list the directory (e.g. EACCES) is rethrown.
   */
  collision(libraryId: string): LibraryIdCollisionError | undefined;
  /**
   * Record `libraryId` as the owner of a writable `db` that has none (a first build, or a legacy
   * index). Throws LibraryIdCollisionError when the db already belongs to a case variant.
   */
  claim(db: DatabaseSync, libraryId: string): void;
}

/** {@link LibraryIdGuard} over the index directory: owners are read from each file's meta. */
export class IndexFileOwners implements LibraryIdGuard {
  // owners per case-folded file name; only non-empty answers are kept, since a recorded owner
  // never changes and a new file appears only through claim()
  readonly #owners = new Map<string, string[]>();

  constructor(private readonly indexDir: string) {}

  collision(libraryId: string): LibraryIdCollisionError | undefined {
    if (this.indexDir === ":memory:") return undefined; // one db per handle: nothing is shared
    return refusal(libraryId, this.#ownersOf(libraryId));
  }

  claim(db: DatabaseSync, libraryId: string): void {
    // An owner already on record needs no write: a plain open never takes the write lock, so it
    // is not blocked behind another process's write transaction (#196). Only an unowned file is
    // claimed, atomically.
    const recorded = this.#ownersOf(libraryId);
    const refused = refusal(libraryId, recorded);
    if (refused) throw refused;
    if (recorded.includes(libraryId)) return;
    const owner = ensureIndexOwner(db, libraryId);
    const clash = refusal(libraryId, [owner]);
    if (clash) throw clash;
    const key = indexFileName(libraryId).toLowerCase();
    const known = this.#owners.get(key) ?? [];
    if (!known.includes(owner)) this.#owners.set(key, [...known, owner]);
  }

  // Every recorded owner of an index file whose name equals this library's case-insensitively:
  // one file on a case-insensitive volume, possibly several on a case-sensitive one.
  #ownersOf(libraryId: string): string[] {
    const key = indexFileName(libraryId).toLowerCase();
    const cached = this.#owners.get(key);
    if (cached) return cached;
    let entries: string[];
    try {
      entries = readdirSync(this.indexDir);
    } catch (err) {
      // no index directory yet = no index file = no owner
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const owners = entries
      .filter((e) => e.toLowerCase() === key)
      .map((e) => readIndexOwner(path.join(this.indexDir, e)))
      .filter((o): o is string => o !== undefined);
    if (owners.length > 0) this.#owners.set(key, owners);
    return owners;
  }
}

// The refusal when an owner other than `libraryId` differs from it only in letter case. A
// sanitize-only match ("a b" vs "a_b") is not a case clash and is left alone, as before.
function refusal(libraryId: string, owners: readonly string[]): LibraryIdCollisionError | undefined {
  if (owners.includes(libraryId)) return undefined;
  const folded = libraryId.toLowerCase();
  const owner = owners.filter((o) => o.toLowerCase() === folded).sort()[0];
  return owner === undefined ? undefined : new LibraryIdCollisionError(libraryId, owner);
}

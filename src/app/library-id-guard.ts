// Early #388 refusal for build paths (calibre_build_index, pnpm reindex): check the library list
// for a case-only id clash BEFORE any index file or progress log is touched.

import type { LibraryReader } from "../calibre/content-server.js";
import { caseCollisionOwner, LibraryIdCollisionError } from "../domain/library-id-collision.js";

/**
 * The refusal for `libraryId` when another library's id equals it case-insensitively and owns the
 * shared files, else undefined. An unavailable library list never refuses: the build's own
 * calls report that outage, and the index-open guard still catches a clash it can see.
 */
export async function libraryIdCollision(
  content: Pick<LibraryReader, "libraryInfo">,
  libraryId: string,
): Promise<LibraryIdCollisionError | undefined> {
  let ids: string[];
  try {
    ids = Object.keys((await content.libraryInfo()).libraryMap);
  } catch {
    return undefined;
  }
  const owner = caseCollisionOwner(libraryId, ids);
  return owner === undefined ? undefined : new LibraryIdCollisionError(libraryId, owner);
}

// Book-id resolution for use cases and tools. BookId() coerces numeric strings to numbers, so
// a string that reaches here is a uuid — resolved to a numeric db id via a uuid: search.

import type { LibraryReader } from "../calibre/content-server.js";

/** The one read id resolution makes: a uuid: search on the Content Server. */
export interface IdResolverDeps {
  content: Pick<LibraryReader, "search">;
}

/** Resolve a BookId (number | uuid string) to a numeric db id, or undefined if not found. */
export async function resolveNumericId(
  deps: IdResolverDeps,
  id: number | string,
  library?: string,
): Promise<number | undefined> {
  if (typeof id === "number") return id;
  const page = await deps.content.search({ query: `uuid:${id}`, num: 1, library });
  return page.bookIds[0];
}

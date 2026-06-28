// Shared book-id resolution. BookId() coerces numeric strings to numbers, so a string
// that reaches a handler is a uuid — resolve it to a numeric db id via a uuid: search.

import type { ToolDeps } from "./types.js";

/** Resolve a BookId (number | uuid string) to a numeric db id, or undefined if not found. */
export async function resolveNumericId(
  deps: ToolDeps,
  id: number | string,
  library?: string,
): Promise<number | undefined> {
  if (typeof id === "number") return id;
  const page = await deps.content.search({ query: `uuid:${id}`, num: 1, library });
  return page.bookIds[0];
}

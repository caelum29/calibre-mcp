// Book-id arg picking shared by the single-book tools. The uuid → numeric resolution itself
// lives in app/resolve-id.ts, so use cases resolve ids without reaching up into tools/ (#346).

/**
 * Pick a book id from either `id` or its `bookId` alias. Single-book tools take `id`, but the
 * model naturally reuses the `bookId` field it just got from search results (calibre_search /
 * calibre_semantic_search expose `bookIds`), so both are accepted. `id` wins if both are given.
 */
export function bookIdArg(a: { id?: number | string; bookId?: number | string }): number | string | undefined {
  return a.id ?? a.bookId;
}

// The calibre://book/{id} resource address. Neutral home (#261): tools emit resource_links to
// it and resources/book.ts serves it, so the URI shape and MIME live in one place for both.

export const BOOK_MIME = "application/json";

/** Canonical resource URI for a book. */
export function bookResourceUri(id: number | string): string {
  return `calibre://book/${id}`;
}

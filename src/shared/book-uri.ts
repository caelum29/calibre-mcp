// The calibre://book/{libId}/{id} resource address (#432: book ids are per-library). Neutral home (#261): tools emit resource_links to
// it and resources/book.ts serves it, so the URI shape and MIME live in one place for both.

/** MIME type of a `calibre://book/{libId}/{id}` resource body (JSON). */
export const BOOK_MIME = "application/json";

/**
 * Canonical resource URI for a book. `libId` is the library ID (D-008), never the display name:
 * ids repeat across libraries, so a link without it would open another library's book.
 */
export function bookResourceUri(id: number | string, libId: string): string {
  return `calibre://book/${encodeURIComponent(libId)}/${id}`;
}

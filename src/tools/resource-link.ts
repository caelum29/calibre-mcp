// Build lightweight resource_links from book summaries instead of shipping full records
// — the biggest context-window win at ~801 books (DESIGN §2). The host readResource's
// only the books it actually needs via the calibre://book/{id} template.

import type { BookSummary } from "../domain/book.js";
import type { ResourceLinkBlock } from "./types.js";

export const BOOK_MIME = "application/json";

/** Canonical resource URI for a book. */
export function bookResourceUri(id: number | string): string {
  return `calibre://book/${id}`;
}

/** A resource_link content block pointing at a book, with a one-line description. */
export function bookResourceLink(b: BookSummary): ResourceLinkBlock {
  const description = [b.authors.join(", "), b.snippet].filter(Boolean).join(" — ");
  return {
    type: "resource_link",
    uri: bookResourceUri(b.id),
    name: b.title || `book ${b.id}`,
    title: b.title || undefined,
    description: description || undefined,
    mimeType: BOOK_MIME,
  };
}

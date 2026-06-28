// Read logic for the calibre://book/{id} resource. SDK-free; server.ts wraps it in a
// ResourceTemplate callback. RESOURCE CONTRACT: this THROWS on failure (the opposite of
// the return-not-throw tool contract) — the SDK turns the throw into a protocol error.

import type { ToolDeps } from "../tools/types.js";
import { fence } from "../tools/result.js";
import { bookResourceUri, BOOK_MIME } from "../tools/resource-link.js";

export interface BookResource {
  uri: string;
  mimeType: string;
  text: string;
}

/** Fetch a book and render it as a fenced JSON document. Throws if the book can't be read. */
export async function readBookResource(deps: ToolDeps, id: number): Promise<BookResource> {
  const book = await deps.content.getBook(id);
  // Fence the document: it embeds free-text (comments) that is attacker-influenceable.
  const text = fence("BOOK METADATA", JSON.stringify(book, null, 2));
  return { uri: bookResourceUri(id), mimeType: BOOK_MIME, text };
}

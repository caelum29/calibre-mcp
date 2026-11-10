// Read logic for the calibre://book/{libId}/{id} resource. SDK-free; server.ts wraps it in a
// ResourceTemplate callback. RESOURCE CONTRACT: this THROWS on failure (the opposite of
// the return-not-throw tool contract) — the SDK turns the throw into a protocol error.

import type { Book } from "../domain/book.js";
import { fence } from "../shared/fence.js";
import { bookResourceUri, BOOK_MIME } from "../shared/book-uri.js";

/** The one read this resource needs — a narrow port instead of the whole ToolDeps (#261). */
export interface BookSource {
  getBook(id: number, libId: string): Promise<Book>;
}

export interface BookResource {
  uri: string;
  mimeType: string;
  text: string;
}

// Strict digits only: Number() alone would accept "1e3", "0x10" and " 42" as ids.
const BOOK_ID_RE = /^\d+$/;

function invalidId(raw: unknown): Error {
  return new Error(
    `Invalid book id in calibre://book/{libId}/{id}: expected a positive integer, got ${JSON.stringify(raw)}.`,
  );
}

/**
 * Parse the `{id}` template variable of calibre://book/{libId}/{id}. Throws on anything but a positive
 * integer, so a malformed URI fails as the caller's error before any Content Server request.
 */
export function parseBookResourceId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !BOOK_ID_RE.test(value)) throw invalidId(value);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalidId(value);
  return id;
}

/**
 * Fetch a book from library `libId` and render it as a fenced JSON document. Throws if the id is
 * invalid, the library is unknown (the source names the valid ids) or the book can't be read.
 */
export async function readBookResource(source: BookSource, id: number, libId: string): Promise<BookResource> {
  // Guard here too: the reader is exported, so a caller that skipped parsing still can't send NaN over HTTP.
  if (!Number.isSafeInteger(id) || id <= 0) throw invalidId(id);
  const book = await source.getBook(id, libId);
  // Fence the document: it embeds free-text (comments) that is attacker-influenceable.
  const text = fence("BOOK METADATA", JSON.stringify(book, null, 2));
  return { uri: bookResourceUri(id, libId), mimeType: BOOK_MIME, text };
}

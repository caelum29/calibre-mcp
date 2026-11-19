// The per-book metadata text of the semantic index (#631, "row-to-text"): one book's Calibre
// record turned into plain text — title, authors, series, tags and the comments blurb — so an
// image-only or near-empty book still has something to embed and keyword-index.

import type { Book } from "./book.js";

/** Blurb cap in characters: the p75 blurb length on Programming_Books, roughly one e5 chunk (#631). */
export const BLURB_MAX_CHARS = 1800;

/** The metadata text of one book and the length of the blurb it carries (0 = none). */
export interface BookMetadataText {
  text: string;
  blurbChars: number;
}

/**
 * Title, authors, series and tags one per line (empty fields skipped), then a blank line and
 * the HTML-stripped blurb cut to {@link BLURB_MAX_CHARS} at a word boundary. No field labels:
 * a label word would sit in every row and match every keyword query naming it.
 */
export function bookMetadataText(
  book: Pick<Book, "title" | "authors" | "series" | "tags" | "comments">,
): BookMetadataText {
  const head = [book.title, book.authors.join(", "), book.series ?? "", book.tags.join(", ")]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const blurb = cutAtWord(plainBlurb(book.comments ?? ""), BLURB_MAX_CHARS);
  return { text: blurb ? `${head.join("\n")}\n\n${blurb}` : head.join("\n"), blurbChars: blurb.length };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Calibre's comments are HTML: block ends become line breaks, tags go, entities decode, spaces collapse. */
function plainBlurb(html: string): string {
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => decodeEntity(e) ?? m);
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodeEntity(e: string): string | undefined {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()];
  const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
  // Out-of-range code points stay as written rather than throw.
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** At most `max` chars, cut at the last whitespace within the cap; a hard cut when there is none. */
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const ws = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  return (ws > 0 ? s.slice(0, ws) : s.slice(0, max)).trimEnd();
}

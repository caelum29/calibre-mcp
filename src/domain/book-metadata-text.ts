// The per-book metadata text of the semantic index (#631, "row-to-text"): one book's Calibre
// record turned into plain text — title, authors, series, tags and the comments blurb — so an
// image-only or near-empty book still has something to embed and keyword-index.

import type { Book } from "./book.js";
import { CHARACTER_RULES, normaliseText } from "./normalise/normalise.js";

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
 * a label word would sit in every row and match every keyword query naming it. Every part goes
 * through the character normalisation book text gets (#655), so `ﬁ` and soft hyphens stem alike.
 */
export function bookMetadataText(
  book: Pick<Book, "title" | "authors" | "series" | "tags" | "comments">,
): BookMetadataText {
  const head = [book.title, book.authors.join(", "), book.series ?? "", book.tags.join(", ")]
    .map((s) => normalise(s).trim())
    .filter((s) => s.length > 0);
  const blurb = cutAtWord(normalise(plainBlurb(book.comments ?? "")), BLURB_MAX_CHARS);
  return { text: blurb ? `${head.join("\n")}\n\n${blurb}` : head.join("\n"), blurbChars: blurb.length };
}

/**
 * The character rules only, never a converter's EPUB artefact set: Calibre's own fields are not
 * converter output. The offset map is dropped — the row has no char offsets to map.
 */
function normalise(text: string): string {
  return normaliseText(text, [CHARACTER_RULES]).text;
}

// The named entities Calibre's comments editor and publisher blurbs actually use.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  laquo: "\u00AB",
  raquo: "\u00BB",
  copy: "\u00A9",
  trade: "\u2122",
};

/**
 * Calibre's comments are HTML: script/style bodies go whole, block tags become line breaks,
 * other tags go, entities decode, spaces collapse.
 */
function plainBlurb(html: string): string {
  const text = html
    .replaceAll(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replaceAll(/<\s*br\s*\/?>/gi, "\n")
    // Opening and closing block tags both separate, so `one<div>two</div>three` keeps three words.
    .replaceAll(/<\/?\s*(p|div|li|ul|ol|h[1-6]|blockquote|tr|table)\b[^>]*>/gi, "\n")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => decodeEntity(e) ?? m);
  return text
    .split("\n")
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodeEntity(e: string): string | undefined {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()];
  const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
  // Out-of-range code points stay as written rather than throw.
  return code > 0 && code <= 0x10_ff_ff ? String.fromCodePoint(code) : undefined;
}

/** At most `max` chars, cut at the last whitespace within the cap; a hard cut when there is none. */
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const ws = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  const cut = ws > 0 ? s.slice(0, ws) : s.slice(0, max);
  // A hard cut can split a surrogate pair; a lone high surrogate is invalid UTF-16 downstream.
  return (/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut).trimEnd();
}

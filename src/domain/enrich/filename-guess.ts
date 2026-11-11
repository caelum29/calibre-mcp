// Decide whether a book's title is a real title or a raw filename left over from import.
// Drives the lookup-key choice in calibre_recover_metadata (a raw-filename title can't be
// searched, so we fall back to ISBN) and the title-weak check in proposal.ts. This is the
// single source of truth for the raw-filename heuristics — the raw_filename_title quality
// check (curation/quality.ts) routes through looksLikeRawFilename so the two stay in sync.
// slugTitleQuery turns a slug-shaped one back into a searchable title query (#549).
//
// Heuristics (see issue #200): all-digits, a digit-pair id (215479-01), an ASIN, a
// *.ext leftover, an all-lowercase hyphenated slug, a placeholder word (Cover, "book (3)"),
// a browser/OS duplicate-copy suffix ("Title (1)"), or a real-looking title whose trailing
// "(Name)" parenthetical is just the author.
const DIGITS = /^\d+$/;
const DIGIT_PAIR = /^\d+[-_]\d+$/;
const ASIN = /^B0[A-Z0-9]{8}$/i;
const EXT = /\.(pdf|epub|mobi|azw3?|dvi|djvu|txt|docx?|fb2|cbz|cbr|rtf)$/i;
// An all-lowercase hyphenated slug with no spaces: "pro-vim-2014", "bdd-in-action".
// Real book titles are effectively never in this shape (title case, spaces).
const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
// Placeholder words Calibre / importers leave when no title was found, incl. "book (N)".
const PLACEHOLDER = /^(?:cover|title|untitled|contents|book\s*\(\d+\))$/i;
// Download-duplicate suffix "Title (1)". A bare trailing number ("Python 3") stays a title.
const COPY_SUFFIX = /\s\(\d+\)$/;

/** Normalize an author or parenthetical for comparison: case, whitespace. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True if the title ends with a "(Name)" parenthetical that equals one of the book's authors
 * (case/whitespace-insensitive). This catches filenames like "Go Design Patterns (Mario Castro
 * Contreras)" where the file was named after the author.
 */
function endsWithAuthorName(t: string, authors: string[]): boolean {
  const m = /\(([^()]*)\)\s*$/.exec(t);
  if (!m) return false;
  const inner = norm(m[1] ?? "");
  if (!inner) return false;
  // Exact match only: containment flags real titles like "Clean Code (Robert C. Martin Series)".
  // Calibre's "Unknown" author is a placeholder, not a name, so it never matches.
  return authors.some((a) => {
    const na = norm(a);
    return na.length > 0 && na !== "unknown" && inner === na;
  });
}

/**
 * True if the title looks like a raw import filename, not a human title. Pass `authors` when
 * available to also catch the trailing-author form ("Real Title (Author Name)").
 */
export function looksLikeRawFilename(title: string, authors: string[] = []): boolean {
  const t = title.trim();
  if (
    DIGITS.test(t) ||
    DIGIT_PAIR.test(t) ||
    ASIN.test(t) ||
    EXT.test(t) ||
    KEBAB_SLUG.test(t) ||
    PLACEHOLDER.test(t) ||
    COPY_SUFFIX.test(t)
  ) {
    return true;
  }
  return authors.length > 0 && endsWithAuthorName(t, authors);
}

/** True if the title is an importer placeholder (Cover, Untitled, "book (3)"): no search value at all. */
export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER.test(title.trim());
}

/** True if the title is usable as a title/author search key (real words, not a filename). */
export function isUsableTitle(title: string, authors: string[] = []): boolean {
  const t = title.trim();
  return t.length >= 3 && !looksLikeRawFilename(t, authors);
}

// Word's PDF export prefixes the document title: "Microsoft Word - Report.docx".
const WORD_PREFIX = /^microsoft word\s*-\s*/i;
// A slug with no spaces whose words are joined by - or _: "modular-monoliths", "ddd_distilled".
const JOINED_SLUG = /^[\p{L}\p{N}]+(?:[-_]+[\p{L}\p{N}]+)+$/u;
// One word ("top" from top.dvi) is too little to search on; two letter-bearing words are a title.
const MIN_QUERY_WORDS = 2;

/**
 * Derive a title query from a slug-shaped filename title (#549): strips a "Microsoft Word - "
 * prefix and a file extension, and turns a space-free `-`/`_` slug into words
 * ("modular-monoliths" → "modular monoliths"). Returns undefined when the title is not
 * slug-shaped, or when what is left is an identifier (digits, ASIN, placeholder) or a single word.
 */
export function slugTitleQuery(title: string): string | undefined {
  const t = title.trim();
  let q = t.replace(WORD_PREFIX, "").replace(EXT, "").trim();
  if (JOINED_SLUG.test(q)) q = q.replace(/[-_]+/g, " ");
  q = q.replace(/\s+/g, " ").trim();
  if (q === t) return undefined; // not slug-shaped: nothing was unwrapped
  if (DIGITS.test(q) || DIGIT_PAIR.test(q) || ASIN.test(q) || PLACEHOLDER.test(q)) return undefined;
  const words = q.split(" ").filter((w) => /\p{L}/u.test(w));
  return words.length >= MIN_QUERY_WORDS ? q : undefined;
}

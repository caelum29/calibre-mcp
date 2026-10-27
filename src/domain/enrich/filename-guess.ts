// Decide whether a book's title is a real title or a raw filename left over from import.
// Drives the lookup-key choice in calibre_recover_metadata (a raw-filename title can't be
// searched, so we fall back to ISBN) and the title-weak check in proposal.ts. This is the
// single source of truth for the raw-filename heuristics — the raw_filename_title quality
// check (curation/quality.ts) routes through looksLikeRawFilename so the two stay in sync.
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

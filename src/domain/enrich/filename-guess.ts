// Decide whether a book's title is a real title or a raw filename left over from import
// (all-digits, an ASIN, or a `*.pdf`-style leftover). Drives the lookup-key choice in
// calibre_recover_metadata: a raw-filename title can't be searched, so we fall back to ISBN.
// The patterns mirror the raw_filename_title quality check (independent, kept local).

const DIGITS = /^\d+$/;
const ASIN = /^B0[A-Z0-9]{8}$/i;
const EXT = /\.(pdf|epub|mobi|azw3?|dvi|djvu|txt|docx?|fb2|cbz|cbr|rtf)$/i;

/** True if the title looks like a raw import filename, not a human title. */
export function looksLikeRawFilename(title: string): boolean {
  const t = title.trim();
  return DIGITS.test(t) || ASIN.test(t) || EXT.test(t);
}

/** True if the title is usable as a title/author search key (real words, not a filename). */
export function isUsableTitle(title: string): boolean {
  const t = title.trim();
  return t.length >= 3 && !looksLikeRawFilename(t);
}

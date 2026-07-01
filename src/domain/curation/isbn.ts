// ISBN validation — checksum only, clean-room from the published ISBN-10/13 formulas
// (independent reimplementation, NOT ported from Calibre's GPL check_isbn). Reused by the
// quality report now and metadata recovery / isbn_tools later.

/** Strip hyphens, spaces, and surrounding junk; upper-case the ISBN-10 check char 'X'. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** ISBN-10: Σ (i × digitᵢ) for i=1..10 ≡ 0 (mod 11); the last char may be 'X' = 10. */
export function isValidIsbn10(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i]!;
    const v = c === "X" ? 10 : c.charCodeAt(0) - 48;
    sum += (i + 1) * v;
  }
  return sum % 11 === 0;
}

/** ISBN-13 (EAN-13): alternating ×1/×3 weights, total ≡ 0 (mod 10). */
export function isValidIsbn13(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const v = s.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? v : v * 3;
  }
  return sum % 10 === 0;
}

/** True if the value is a checksum-valid ISBN-10 or ISBN-13. */
export function isValidIsbn(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (s.length === 10) return isValidIsbn10(s);
  if (s.length === 13) return isValidIsbn13(s);
  return false;
}
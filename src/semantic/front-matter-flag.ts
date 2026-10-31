// Which chunks count as front matter (#18): one rule shared by the encode path and the
// in-place flag backfill (#269), so a backfilled flag is exactly what a re-index would store.

/**
 * True when a chunk lies MOSTLY before the front-matter boundary `fmEnd` (0 = none). Majority
 * overlap, not full containment: chunks run ~2k chars, so the whole front matter usually lands
 * inside one boundary-straddling chunk that a containment rule would never flag.
 */
export function isFrontMatterSpan(span: { charStart: number; charEnd: number }, fmEnd: number): boolean {
  return fmEnd > 0 && Math.min(span.charEnd, fmEnd) - span.charStart >= 0.5 * (span.charEnd - span.charStart);
}

// Where a figure sits, as the model and the viewer see it (#553): a PDF figure's number is a
// page (`p.N`); an EPUB figure's is the spine-section index (`§N`) — EPUB has no pages. The
// index rows keep one `page` column; this maps it per format at the output layer.

/** Output-side location of a figure: `{ page }` for PDF, `{ section }` for every other format. */
export type FigureLocation = { page: number } | { section: number };

/** Map the stored per-figure number onto the field its format means. */
export function figureLocation(format: string, n: number): FigureLocation {
  return format.toLowerCase() === "pdf" ? { page: n } : { section: n };
}

/** Text label for a figure's location: `p.N` (PDF page) or `§N` (EPUB spine section). */
export function figureLocationLabel(format: string, n: number | undefined): string {
  const v = n ?? "?";
  return format.toLowerCase() === "pdf" ? `p.${v}` : `§${v}`;
}

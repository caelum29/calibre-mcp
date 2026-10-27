// Page ↔ char-offset mapping over extracted PDF text. Both PDF backends (pdftotext,
// PyMuPDF) separate pages with `\f` (#133), so this holds whichever one ran. Pure, SDK-free.

/** Start offset of each 1-based page (index p-1), from the text's `\f` page breaks. */
export function scanPageStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\f") starts.push(i + 1);
  }
  return starts;
}

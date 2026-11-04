// Which book format to extract text from, and why an extraction came back empty. Pure policy,
// no I/O: use-cases (src/app) import it from here so they never reach into the calibre adapters (#354).

/**
 * Extractable formats in preference order (best text structure first).
 * Markdown ranks above PDF: it round-trips through ebook-convert with headings intact,
 * which the chunker leans on, while a PDF of the same book loses that structure (#12).
 */
const FORMAT_PREFERENCE = [
  "epub",
  "md",
  "markdown",
  "pdf",
  "txt",
  "txtz",
  "text",
  "azw3",
  "mobi",
  "docx",
  "odt",
  "htmlz",
  "fb2",
  "rtf",
];

/** Plain-text-family formats — an empty extraction means an empty file, not a broken one. */
const TEXT_FAMILY = new Set(["md", "markdown", "txt", "txtz", "text"]);

/** Pick a format to extract: honor `preference` if available, else first preferred present. */
export function chooseExtractFormat(formats: string[], preference?: string): string | undefined {
  const have = new Set(formats.map((f) => f.toLowerCase()));
  if (preference && have.has(preference.toLowerCase())) return preference.toLowerCase();
  for (const f of FORMAT_PREFERENCE) if (have.has(f)) return f;
  return undefined;
}

/**
 * Why a format yielded zero text, worded for the format actually extracted (#100): a
 * scanned-page diagnosis is only honest for PDFs — an empty EPUB/AZW3 is a DRM/structure
 * problem, and naming "PDF" there sent triage down the wrong path.
 */
export function noTextReason(format: string): string {
  const fmt = format.toLowerCase();
  if (fmt === "pdf") return "likely a scanned/image PDF (Calibre has no OCR)";
  if (TEXT_FAMILY.has(fmt)) return `the ${format.toUpperCase()} file is empty or holds no readable text`;
  return `the ${format.toUpperCase()} has no extractable text layer (image-only pages, or DRM/structure the converter can't read)`;
}

// PDF outline (bookmarks) reader (#134): poppler's `pdftohtml -xml` emits the document
// outline whatever page range it converts, so a single-page run is enough (~0.03 s). The
// outline is a best-effort chapter source — every failure degrades to [] (text detectors).

import { existsSync } from "node:fs";
import { type OutlineEntry, parsePdfOutlineXml } from "../domain/structure/pdf-outline.js";
import { log } from "../logging.js";
import { spawnCollect } from "./spawn.js";

// Same probe order as pdftotext — the server may run with a minimal PATH (Claude Desktop).
const PDFTOHTML_CANDIDATES = ["/opt/homebrew/bin/pdftohtml", "/usr/local/bin/pdftohtml", "/usr/bin/pdftohtml"];

const OUTLINE_TIMEOUT_MS = 20_000;
// Page 1's text rides along in the XML; a huge first page plus a big outline stays far below this.
const OUTLINE_MAX_BUFFER = 16 * 1024 * 1024;

/** Absolute pdftohtml path, or null when poppler's pdftohtml isn't installed in a known spot. */
export function pdftohtmlBinary(): string | null {
  return PDFTOHTML_CANDIDATES.find(existsSync) ?? null;
}

/** pdftohtml argv: quiet, no images, XML to stdout, first page only (the outline is global). */
export function pdftohtmlOutlineArgs(src: string): string[] {
  return ["-q", "-i", "-xml", "-stdout", "-f", "1", "-l", "1", src];
}

/** Read a PDF's outline entries. Never throws: a missing binary, timeout or junk output → []. */
export async function readPdfOutline(
  bin: string,
  src: string,
  timeoutMs = OUTLINE_TIMEOUT_MS,
): Promise<OutlineEntry[]> {
  try {
    const { code, stdout } = await spawnCollect(bin, pdftohtmlOutlineArgs(src), {
      timeoutMs,
      maxBuffer: OUTLINE_MAX_BUFFER,
    });
    // pdftohtml exits non-zero on some damaged-but-readable files; parse what it printed.
    if (code !== 0) log.debug("pdftohtml non-zero exit", { code });
    return parsePdfOutlineXml(stdout);
  } catch (err) {
    log.warn("pdf outline unavailable", { msg: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return [];
  }
}

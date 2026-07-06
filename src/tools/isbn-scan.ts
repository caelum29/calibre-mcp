// Shared best-effort ISBN text-scan: download a book's format, extract its front matter, and
// return the first checksum-valid ISBN. Used by calibre_recover_metadata (as a lookup key) and
// calibre_extract_isbn (to stamp identifiers:isbn). Bounded on two axes so a big/slow PDF can
// never hang the stdio server: the budget threads into download+convert (kills the subprocess /
// aborts the fetch) AND caps the summed per-layer timeouts via a wall-clock race. Never throws.

import { chooseExtractFormat } from "../calibre/extract.js";
import { extractIsbns } from "../domain/enrich/extract-isbn.js";
import type { Book } from "../domain/book.js";
import type { ToolDeps } from "./types.js";

// Bare digit runs are capped to the front/tail slices (ISBN_SCAN_CHARS each) — sweeping the whole
// book for BARE runs invites false positives. Labeled "ISBN …" tokens carry no such risk, so the
// middle sweep scans the whole text for labeled matches only.
export const ISBN_SCAN_CHARS = 20_000;
// The scan is a best-effort optimization, never worth minutes. Each extraction layer (download,
// convert) is individually bounded but their sum is not — a big/slow PDF once hung the stdio
// server ~4 min. This cap threads into the subprocess/download timeouts AND bounds wall clock.
export const ISBN_SCAN_TIMEOUT_MS = 30_000;

export type IsbnScanOutcome = "found" | "no-isbn" | "no-format" | "timeout" | "error";

export interface IsbnScanResult {
  isbn?: string;
  outcome: IsbnScanOutcome;
}

/** Sentinel used to distinguish a scan-budget timeout from an extraction error. */
const SCAN_TIMEOUT = Symbol("isbn-scan-timeout");

/** Reject after `ms`, resolving the returned canceller to clear the timer when the race settles. */
function deadline(ms: number): { race: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const race = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(SCAN_TIMEOUT), ms);
  });
  return { race, cancel: () => clearTimeout(timer) };
}

/**
 * Scan a book's first pages for a valid ISBN (best-effort). Bounded by ISBN_SCAN_TIMEOUT_MS on
 * two axes: `timeoutMs` threads into download+convert (SIGTERMs the subprocess / aborts the
 * fetch), and a wall-clock race caps the summed per-layer timeouts. Never throws → the caller
 * degrades gracefully.
 */
export async function scanForIsbn(
  deps: ToolDeps,
  book: Book,
  id: number,
  library?: string,
): Promise<IsbnScanResult> {
  const fmt = chooseExtractFormat(book.formats);
  if (!fmt) return { outcome: "no-format" };
  const { race, cancel } = deadline(ISBN_SCAN_TIMEOUT_MS);
  try {
    const work = (async () => {
      const libId = await deps.content.resolveLibraryId(library);
      const base = deps.config.serverUrl.replace(/\/+$/, "");
      const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${id}/${encodeURIComponent(libId)}`;
      const cacheKey = `${id}:${fmt}:${book.lastModified ?? ""}`;
      const { text } = await deps.extractor.getText({
        bookId: id,
        format: fmt,
        downloadUrl,
        cacheKey,
        timeoutMs: ISBN_SCAN_TIMEOUT_MS,
      });
      // Front matter (copyright page) first, then the tail — an ISBN often prints on the back
      // cover / last page (the kiwidude plugin scans front pages then last pages).
      const front = extractIsbns(text.slice(0, ISBN_SCAN_CHARS))[0];
      if (front) return front;
      if (text.length <= ISBN_SCAN_CHARS) return undefined;
      const tail = extractIsbns(text.slice(-ISBN_SCAN_CHARS))[0];
      if (tail) return tail;
      // Middle sweep: front + tail missed on a long book. A labeled "ISBN …" token is safe to
      // trust anywhere (near-zero false positives), so sweep the whole text for LABELED matches
      // only. A page/spine-LOCATED walk (per EPUB spine item / PDF page) awaits epub-spine.ts
      // (idea 02); this is the location-free recall improvement.
      return extractIsbns(text, 1, { labeledOnly: true })[0];
    })();
    const isbn = await Promise.race([work, race]);
    return isbn ? { isbn, outcome: "found" } : { outcome: "no-isbn" };
  } catch (err) {
    // no backend / scanned PDF / download failure / budget exceeded → let the caller degrade.
    return { outcome: err === SCAN_TIMEOUT ? "timeout" : "error" };
  } finally {
    cancel(); // no dangling timer once the race settles
  }
}

/** Human-readable tail explaining why a scan produced no ISBN, for an error/preview message. */
export function scanOutcomeHint(outcome: IsbnScanOutcome): string {
  switch (outcome) {
    case "timeout":
      return "the text scan timed out before finding one";
    case "no-format":
      return "the book has no extractable format";
    case "error":
      return "the text scan found none (no extractable text)";
    default:
      return "no valid ISBN was found in the book's front matter";
  }
}
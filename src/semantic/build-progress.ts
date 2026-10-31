// Resumable progress log for long index builds (#87, #99): one JSON line appended per
// SETTLED book, in completion order. Resume reads back the ids that committed ok — order
// never matters, so a concurrent build resumes exactly like a sequential one.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** One settled book. Extra telemetry (bookDetails fields, ms, worker) rides alongside. */
export interface ProgressRecord {
  bookId: number;
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Ids whose LAST record says ok. Tolerant by design: a crash can leave a torn final line,
 * which is skipped (that book simply re-runs) instead of making the whole log unreadable.
 */
export function readCompletedIds(file: string): Set<number> {
  const done = new Set<number>();
  if (!existsSync(file)) return done;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let rec: Partial<ProgressRecord>;
    try {
      rec = JSON.parse(line) as Partial<ProgressRecord>;
    } catch {
      continue; // torn write from an interrupted run
    }
    if (typeof rec.bookId !== "number") continue;
    // Last record wins: a later failed retry (e.g. a forced rebuild) un-completes the book.
    if (rec.ok) done.add(rec.bookId);
    else done.delete(rec.bookId);
  }
  return done;
}

/** Append one record as a single line. Sync on purpose — called from the serialized writer. */
export function appendProgress(file: string, rec: ProgressRecord): void {
  appendFileSync(file, JSON.stringify(rec) + "\n");
}

/**
 * Open a progress log for resuming: terminate a torn final line (a crash mid-append) so the
 * next record starts on its own line instead of being glued onto the garbage — then return
 * the completed ids.
 */
export function resumeProgress(file: string): Set<number> {
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    if (text.length > 0 && !text.endsWith("\n")) appendFileSync(file, "\n");
  }
  return readCompletedIds(file);
}

/**
 * Default resume-log path for one library. Book ids are per library and overlap, so a log shared
 * across the index dir would make the second library skip books it never indexed (#285).
 */
export function defaultProgressPath(indexDir: string, libraryId: string, flagsOnly: boolean): string {
  // Library ids come from the server — keep the file inside the index dir whatever they contain.
  const safeId = libraryId.replace(/[^\w.-]/g, "_");
  return path.join(indexDir, `${flagsOnly ? "flags-progress" : "progress"}-${safeId}.jsonl`);
}

// Resumable progress log for long index builds (#87, #99): one JSON line appended per
// SETTLED book, in completion order. Resume reads back the ids that committed ok — order
// never matters, so a concurrent build resumes exactly like a sequential one.

import { createHash } from "node:crypto";
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

// One file name is capped at 255 — bytes on ext4, characters on APFS — so count bytes, the stricter.
const NAME_MAX_BYTES = 255;
// Never emitted by the sanitiser below, so a plain id ("a_b-6783a31e") can't equal a hashed name (#370).
const HASH_SEP = "~";

/**
 * Default resume-log path for one library. Book ids are per library and overlap, so a log shared
 * across the index dir would make the second library skip books it never indexed (#285, #344).
 */
export function defaultProgressPath(indexDir: string, libraryId: string, flagsOnly: boolean): string {
  const prefix = `${flagsOnly ? "flags-progress" : "progress"}-`;
  const ext = ".jsonl";
  // Library ids come from the server — keep the file inside the index dir whatever they contain.
  // Unicode-aware so distinct non-ASCII ids stay distinct.
  const clean = libraryId.replace(/[^\p{L}\p{N}_.-]/gu, "_");
  // Untouched ids that fit keep today's name: renaming one would orphan its resume log.
  const plain = `${prefix}${clean}${ext}`;
  if (clean === libraryId && Buffer.byteLength(plain) <= NAME_MAX_BYTES) return path.join(indexDir, plain);
  // "a:b", "a/b" and "a_b" all sanitise to "a_b" (#285), and a long id would fail with ENAMETOOLONG:
  // hash the raw id and cut the readable part to whatever the name budget leaves.
  const hash = `${HASH_SEP}${createHash("sha256").update(libraryId).digest("hex").slice(0, 8)}`;
  const budget = NAME_MAX_BYTES - Buffer.byteLength(prefix + hash + ext);
  return path.join(indexDir, `${prefix}${truncateBytes(clean, budget)}${hash}${ext}`);
}

// Longest prefix of `s` within `max` UTF-8 bytes, cut on a code point (never mid surrogate pair).
function truncateBytes(s: string, max: number): string {
  let out = "";
  let n = 0;
  for (const ch of s) {
    n += Buffer.byteLength(ch);
    if (n > max) break;
    out += ch;
  }
  return out;
}

/** The progress log a run uses: an explicit --progress file wins, else the per-library default. */
export function resolveProgressPath(
  explicit: string | undefined,
  indexDir: string,
  libraryId: string,
  flagsOnly: boolean,
): string {
  return explicit ?? defaultProgressPath(indexDir, libraryId, flagsOnly);
}

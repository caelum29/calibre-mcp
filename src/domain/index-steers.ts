// The one written copy of each index-repair steer (#720): the delete-then-rebuild way out of an
// incompatible index, and the re-stem step for stale keyword stems. The store's error, the error
// hint, the semantic status, calibre_ping and the labelled-lines format all build on these.

import path from "node:path";

/** The index file name for a library: the id sanitized into a safe filename component. */
export function indexFileName(libraryId: string): string {
  const safe = libraryId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return `${safe}.sqlite`;
}

/** The library's index file under `indexDir`; an in-memory store has no file. */
export function indexFilePath(indexDir: string, libraryId: string): string {
  return indexDir === ":memory:" ? ":memory:" : path.join(indexDir, indexFileName(libraryId));
}

/** A placeholder file for steers that don't know the index dir (the generic error hint). */
const ANY_INDEX_FILE = "<index dir>/<library id>.sqlite";

/**
 * The way out of an incompatible index (#655 review): the guard refuses EVERY open, the build's
 * included, so `force=true` alone cannot rebuild it; the file and its WAL side files must go first.
 * `form` picks the opening capital for a sentence start; no closing period either way.
 */
export function rebuildSteer(file: string = ANY_INDEX_FILE, form: "sentence" | "clause" = "clause"): string {
  const target = file === ":memory:" ? "the index file" : `${file} (and ${file}-wal, ${file}-shm if present)`;
  return `${form === "sentence" ? "Delete" : "delete"} ${target}, then run calibre_build_index force=true to rebuild`;
}

/**
 * The stale-stems warning after a book count (#654): keyword search still works, and a force
 * rebuild re-stems the books — an ordinary build the model can run itself, no delete needed.
 */
export const STALE_STEMS_STEER =
  "books with stale keyword stems — keyword search still works; re-stem them with calibre_build_index force=true and a query that matches every book";

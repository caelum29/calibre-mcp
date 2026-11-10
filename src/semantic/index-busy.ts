// A semantic index another process holds locked (#442). Diagnostic reads (calibre_ping) wait only
// briefly on it and report "busy" instead of stalling ping and calling the file "unreadable".

/** Busy wait for diagnostic reads; searches and builds keep CALIBRE_MCP_INDEX_BUSY_TIMEOUT_MS. */
export const DIAGNOSTIC_BUSY_TIMEOUT_MS = 200;

// node:sqlite puts the SQLite result code on the error; SQLITE_BUSY is 5 (extended codes keep it in the low byte)
const SQLITE_BUSY = 5;

/** True when `err` is SQLite's "database is locked" (SQLITE_BUSY). */
export function isIndexBusy(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && (code & 0xff) === SQLITE_BUSY;
}

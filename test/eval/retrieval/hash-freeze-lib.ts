// Pure helpers behind `pnpm eval:hash-freeze` (#392 decision 1): the script re-freezes
// hash-baseline.json in one command, so it also clears the hash-tier allow entries the new
// baseline makes stale (the list-diff gate fails on stale entries).

import { rowKey, type AllowEntry } from "./gate.js";

/** list-diff-allow.json: `$comment` plus the entries array (extra keys kept as-is). */
interface AllowFile {
  entries: AllowEntry[];
  [key: string]: unknown;
}

/**
 * Drop every `tier: "hash"` entry: after a re-freeze the baseline already holds those lists.
 * Returns the file to write back (same object when nothing changed) and the removed `mode/id`s.
 */
export function pruneHashAllowEntries<F extends AllowFile>(file: F): { file: F; removed: string[] } {
  const removed = file.entries.filter((e) => e.tier === "hash").map((e) => rowKey(e.mode, e.id));
  if (removed.length === 0) return { file, removed };
  return { file: { ...file, entries: file.entries.filter((e) => e.tier !== "hash") }, removed };
}

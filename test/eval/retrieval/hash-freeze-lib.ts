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

/** Files the freeze itself writes: dirty copies of these are expected, not a dirty tree. */
const FREEZE_OUTPUTS = ["test/eval/retrieval/hash-baseline.json", "test/eval/retrieval/list-diff-allow.json"];
const THRESHOLDS = "test/eval/retrieval/thresholds.json";

/**
 * D-012 guard from `git status --porcelain` (repo-root paths): an uncommitted thresholds.json
 * means the rule isn't committed before the freeze, so refuse; any other dirty file means the
 * recorded gitSha doesn't describe the tree, so the sha is marked `-dirty`.
 */
export function freezeTreeCheck(porcelain: string, sha: string): { refuse?: string; gitSha: string; dirty: string[] } {
  const paths = porcelain
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""));
  if (paths.includes(THRESHOLDS)) {
    return {
      refuse: `${THRESHOLDS} has uncommitted changes: commit the rule before freezing (D-012)`,
      gitSha: sha,
      dirty: paths,
    };
  }
  const dirty = paths.filter((p) => !FREEZE_OUTPUTS.includes(p));
  return { gitSha: dirty.length ? `${sha}-dirty` : sha, dirty };
}

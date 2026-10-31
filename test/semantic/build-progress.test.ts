// Per-library default progress log (#285): ids overlap across libraries, so a shared log makes
// the second library's resume skip books it never indexed.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  appendProgress,
  defaultProgressPath,
  resolveProgressPath,
  resumeProgress,
} from "../../src/semantic/build-progress.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "progress-"));
  dirs.push(d);
  return d;
};

describe("defaultProgressPath", () => {
  it("keys the full and flags-only logs by library id", () => {
    expect(defaultProgressPath("/idx", "Humanities", false)).toBe(path.join("/idx", "progress-Humanities.jsonl"));
    expect(defaultProgressPath("/idx", "Humanities", true)).toBe(path.join("/idx", "flags-progress-Humanities.jsonl"));
  });

  it("keeps a library id with path separators inside the index dir", () => {
    expect(defaultProgressPath("/idx", "../evil/x", false)).toBe(path.join("/idx", "progress-.._evil_x.jsonl"));
  });

  it("leaves library B's resume set empty after library A completes with overlapping ids", () => {
    const dir = scratch();
    const a = defaultProgressPath(dir, "Programming_Books", false);
    for (const bookId of [1, 2, 3]) appendProgress(a, { bookId, ok: true });
    expect([...resumeProgress(a)]).toEqual([1, 2, 3]);
    expect([...resumeProgress(defaultProgressPath(dir, "Humanities", false))]).toEqual([]);
  });
});

describe("defaultProgressPath non-ASCII ids", () => {
  it("keeps distinct same-length Cyrillic ids apart", () => {
    expect(defaultProgressPath("/idx", "Книги", false)).toBe(path.join("/idx", "progress-Книги.jsonl"));
    expect(defaultProgressPath("/idx", "Мови_", false)).not.toBe(defaultProgressPath("/idx", "Книги", false));
  });
});

describe("resolveProgressPath", () => {
  it("lets an explicit --progress file win", () => {
    expect(resolveProgressPath("/tmp/x.jsonl", "/idx", "Humanities", false)).toBe("/tmp/x.jsonl");
  });

  it("falls back to the per-library default", () => {
    expect(resolveProgressPath(undefined, "/idx", "Humanities", true)).toBe(
      path.join("/idx", "flags-progress-Humanities.jsonl"),
    );
  });

  it("is what scripts/reindex.ts uses, fed the resolved library id", () => {
    const src = readFileSync(path.join(import.meta.dirname, "../../scripts/reindex.ts"), "utf8");
    expect(src).toContain("resolveProgressPath(opt.progress, indexDir, libraryId, flagsOnly)");
  });
});

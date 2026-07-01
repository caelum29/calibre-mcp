import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool, parseAddedIds } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addbook-"));
  file = path.join(root, "sample.epub");
  writeFileSync(file, "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function deps(calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>): ToolDeps {
  const content = { resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books" };
  return {
    config: loadConfig({ CALIBRE_MCP_ADD_ROOTS: root }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    log,
  };
}

describe("parseAddedIds", () => {
  it("extracts a single id", () => {
    expect(parseAddedIds("Added book ids: 1234")).toEqual([1234]);
  });
  it("extracts multiple ids", () => {
    expect(parseAddedIds("Added book ids: 12, 13, 14")).toEqual([12, 13, 14]);
  });
  it("returns empty when nothing was added", () => {
    expect(parseAddedIds("Books with the same title already exist")).toEqual([]);
  });
  it("does not sweep in a trailing 0 from a later output line", () => {
    // Regression: `\s`-based matching crossed the newline and captured the "0" below.
    expect(parseAddedIds("Added book ids: 895\n\n0 books ignored")).toEqual([895]);
  });
});

describe("calibre_add_book handler", () => {
  it("adds a whitelisted file and returns the new id", async () => {
    const spy = vi.fn(async () => ({ stdout: "Added book ids: 999", stderr: "" }));
    const r = await addBookTool.handler({ path: file }, deps(spy));
    expect(r.isError).toBeFalsy();
    // The handler passes the symlink-resolved real path to calibredb.
    expect(spy).toHaveBeenCalledWith(
      ["add", realpathSync(file)],
      expect.objectContaining({ library: "Programming_Books" }),
    );
    expect(r.structuredContent?.addedIds).toEqual([999]);
  });

  it("rejects a path outside the allowed roots without calling calibredb", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const outside = path.join(tmpdir(), "not-allowed.epub");
    writeFileSync(outside, "x");
    const r = await addBookTool.handler({ path: outside }, deps(spy));
    rmSync(outside, { force: true });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

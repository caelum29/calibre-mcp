// Follow-up to #555: an add that wrote nothing for a non-duplicate reason is an error (isError),
// explained in our own words with one next step; calibredb's raw text is logged, never quoted.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

let root: string;
let file: string;
let real: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addbook-555e-"));
  file = path.join(root, "book.xyz");
  writeFileSync(file, "x");
  real = realpathSync(file);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function deps(stderr: string, warn = vi.fn()): BaseDeps {
  const content = { resolveLibraryId: async (): Promise<string> => "Programming_Books" };
  return {
    config: loadConfig({ CALIBRE_MCP_ADD_ROOTS: root }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb: async () => ({ stdout: "", stderr }) } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log: { ...log, warn },
  };
}

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

const TRACEBACK =
  "Traceback (most recent call last):\n" +
  '  File "/Applications/calibre.app/Contents/Frameworks/plugins/python-lib.bypy.frozen/calibre/db/cli/main.py", line 1\n' +
  "ValueError: invalid literal for int() with base 10: 'x'\n";

describe("calibre_add_book non-duplicate failure (follow-up to #555)", () => {
  it("returns an unsupported format as an invalid_input error", async () => {
    const r = await addBookTool.handler({ path: file }, deps("Unsupported format: xyz\n"));
    expect([r.isError, r.structuredContent?.errorCode]).toEqual([true, "invalid_input"]);
  });

  it("explains an unsupported format in our own words", async () => {
    const r = await addBookTool.handler({ path: file }, deps("Unsupported format: xyz\n"));
    expect(text(r).split("\n")[0]).toBe(
      `Error: No book was added from ${real}: Calibre does not support this file's format.`,
    );
  });

  it("returns a permission error as write_failed", async () => {
    const r = await addBookTool.handler(
      { path: file },
      deps(`PermissionError: [Errno 13] Permission denied: '${real}'\n`),
    );
    expect([r.isError, r.structuredContent?.errorCode]).toEqual([true, "write_failed"]);
  });

  it("explains a permission error in our own words", async () => {
    const r = await addBookTool.handler(
      { path: file },
      deps(`PermissionError: [Errno 13] Permission denied: '${real}'\n`),
    );
    expect(text(r).split("\n")[0]).toBe(
      `Error: No book was added from ${real}: the Calibre server could not read the file (permission denied).`,
    );
  });

  it("returns any other stderr as write_failed", async () => {
    const r = await addBookTool.handler({ path: file }, deps(TRACEBACK));
    expect([r.isError, r.structuredContent?.errorCode]).toEqual([true, "write_failed"]);
  });

  it("never quotes a traceback", async () => {
    const r = await addBookTool.handler({ path: file }, deps(TRACEBACK));
    const all = `${text(r)}\n${JSON.stringify(r.structuredContent)}`;
    expect([all.includes("Traceback"), all.includes("ValueError"), all.includes("python-lib")]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("logs calibredb's raw output instead", async () => {
    const warn = vi.fn();
    await addBookTool.handler({ path: file }, deps(TRACEBACK, warn));
    expect(warn).toHaveBeenCalledWith("add_book added nothing", {
      cause: "other",
      stderr: TRACEBACK.trim(),
    });
  });

  it("puts one next step in the text and in structuredContent.hint", async () => {
    const r = await addBookTool.handler({ path: file }, deps("Unsupported format: xyz\n"));
    const hint = r.structuredContent?.hint as string;
    expect([typeof hint, text(r).includes(`Next: ${hint}`)]).toEqual(["string", true]);
  });

  it("never labels the failure a skip", async () => {
    const r = await addBookTool.handler({ path: file }, deps("Unsupported format: xyz\n"));
    expect(r.structuredContent?.skipped).toBeUndefined();
  });

  it("drops skipped: unknown and reason from the outputSchema", () => {
    const schema = addBookTool.outputSchema!;
    expect(["reason" in schema, schema.skipped!.safeParse("unknown").success]).toEqual([false, false]);
  });
});

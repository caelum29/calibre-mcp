// #555 review: only a duplicate report (or empty stderr) is a duplicate skip; any other
// no-ids output is an error (follow-up to #555). Plus the parser variants and a failing lookup.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

let root: string;
let file: string;
let real: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addbook-555r-"));
  file = path.join(root, "free-as-in-freedom.epub");
  writeFileSync(file, "x");
  real = realpathSync(file);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HEADER =
  "The following books were not added as they already exist in the database (see --duplicates option or --automerge option):";
const FORMAT_HINT =
  "Convert the file to a format Calibre imports (EPUB, PDF, MOBI, AZW3…), then retry calibre_add_book.";
const PERMISSION_HINT = "Give the Calibre server process read access to the file, then retry calibre_add_book.";
const OTHER_HINT =
  "Check that the file opens and is not corrupt, then retry calibre_add_book; calibre_search for its title " +
  "shows whether it is already in the library.";

const free928: Book = {
  id: 928,
  uuid: "u",
  title: "Free as in Freedom",
  authors: ["Sam Williams"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
};

function deps(out: { stdout?: string; stderr?: string }, opts: { searchThrows?: boolean } = {}): BaseDeps {
  const content = {
    resolveLibraryId: async (): Promise<string> => "Programming_Books",
    search: async () => {
      if (opts.searchThrows) throw new Error("ECONNRESET");
      return { bookIds: [928], total: 1, num: 1, offset: 0, sort: "title", libraryId: "Programming_Books" };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, id === 928 ? free928 : null] as const)),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_ADD_ROOTS: root }),
    content: content as unknown as ToolDeps["content"],
    calibre: {
      calibredb: async () => ({ stdout: out.stdout ?? "", stderr: out.stderr ?? "" }),
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

const run = (out: { stdout?: string; stderr?: string }, opts?: { searchThrows?: boolean }) =>
  addBookTool.handler({ path: file }, deps(out, opts));
const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

describe("calibre_add_book no-ids outcomes (#555 review)", () => {
  // Follow-up to #555: a non-duplicate no-ids add is an error in our own words, not `skipped: "unknown"`.
  it("returns a Python traceback as a write_failed error without quoting it", async () => {
    const stderr =
      "Traceback (most recent call last):\n" +
      '  File "/Applications/calibre.app/Contents/Frameworks/plugins/python-lib.bypy.frozen/calibre/db/cli/main.py", line 1\n' +
      "ValueError: invalid literal for int() with base 10: 'x'\n";
    const r = await run({ stderr });
    expect(r.structuredContent).toEqual({
      error: `No book was added from ${real}: calibredb reported an error (details are in the server log).`,
      errorCode: "write_failed",
      hint: OTHER_HINT,
    });
  });

  it("returns an Unsupported format message as an invalid_input error", async () => {
    const r = await run({ stderr: "Unsupported format: xyz\n" });
    expect(r.structuredContent).toEqual({
      error: `No book was added from ${real}: Calibre does not support this file's format.`,
      errorCode: "invalid_input",
      hint: FORMAT_HINT,
    });
  });

  it("returns a PermissionError as a write_failed error", async () => {
    const stderr = `PermissionError: [Errno 13] Permission denied: '${real}'\n`;
    const r = await run({ stderr });
    expect(r.structuredContent).toEqual({
      error: `No book was added from ${real}: the Calibre server could not read the file (permission denied).`,
      errorCode: "write_failed",
      hint: PERMISSION_HINT,
    });
  });

  it("says the same in the text: no book added, why, the code and the next step", async () => {
    const r = await run({ stderr: "Unsupported format: xyz\n" });
    expect(text(r)).toBe(
      `Error: No book was added from ${real}: Calibre does not support this file's format.\n` +
        `Code: invalid_input\nNext: ${FORMAT_HINT}`,
    );
  });

  it("does not use duplicate wording for a failure", async () => {
    const r = await run({ stderr: "Unsupported format: xyz\n" });
    expect([text(r).includes("duplicate"), r.isError]).toEqual([false, true]);
  });

  it("never quotes a very long calibredb line", async () => {
    const r = await run({ stderr: `${"e".repeat(400)}\n` });
    expect(text(r).includes("eeee")).toBe(false);
  });

  it("treats whitespace-only stderr as empty (a duplicate skip)", async () => {
    const r = await run({ stderr: "  \n\t\n" });
    expect([r.structuredContent?.skipped, r.structuredContent?.duplicateOf]).toEqual(["duplicate", undefined]);
  });

  it("finds the duplicate report in stdout too", async () => {
    const r = await run({ stdout: `${HEADER}\n  Free as in Freedom\n    ${real}\n` });
    expect([r.structuredContent?.skipped, r.structuredContent?.duplicateOf]).toEqual(["duplicate", 928]);
  });
});

describe("calibre_add_book duplicate report parsing (#555 review)", () => {
  it("parses a CRLF report", async () => {
    const r = await run({ stderr: `${HEADER}\r\n  Free as in Freedom\r\n` });
    expect(r.structuredContent?.duplicateOf).toBe(928);
  });

  it("parses a report with text before the header", async () => {
    const r = await run({ stderr: `Warning: font cache rebuilt\n${HEADER}\n  Free as in Freedom\n` });
    expect(r.structuredContent?.duplicateOf).toBe(928);
  });

  it("leaves the book unidentified when a blank line follows the header", async () => {
    const r = await run({ stderr: `${HEADER}\n\n  Free as in Freedom\n` });
    expect([
      r.structuredContent?.skipped,
      r.structuredContent?.duplicateOf,
      text(r).includes("could not be identified"),
    ]).toEqual(["duplicate", undefined, true]);
  });

  it("still returns the skip result when the lookup throws", async () => {
    const r = await run({ stderr: `${HEADER}\n  Free as in Freedom\n` }, { searchThrows: true });
    expect([r.isError, r.structuredContent?.skipped, r.structuredContent?.duplicateOf]).toEqual([
      undefined,
      "duplicate",
      undefined,
    ]);
  });
});

// #555: a skipped (duplicate) add and an update no-op explain themselves in BOTH channels —
// Claude Desktop shows only text, the Code tab only structuredContent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addbook-555-"));
  file = path.join(root, "free-as-in-freedom.epub");
  writeFileSync(file, "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

// calibredb's skip report (calibre 9.x cmd_add): the header + indented titles on stderr, paths on stdout.
const HEADER =
  "The following books were not added as they already exist in the database (see --duplicates option or --automerge option):";
const skipped = (title: string) => async () => ({
  stdout: `  ${realpathSync(file)}\n`,
  stderr: `${HEADER}\n  ${title}\n`,
});

/** Library fake: every search returns `library`; booksByIds serves from it. */
function deps(calibredb: () => Promise<{ stdout: string; stderr: string }>, library: Book[] = []): BaseDeps {
  const byId = new Map(library.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async (): Promise<string> => "Programming_Books",
    search: async () => ({
      bookIds: library.map((b) => b.id),
      total: library.length,
      num: library.length,
      offset: 0,
      sort: "title",
      libraryId: "Programming_Books",
    }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({ CALIBRE_MCP_ADD_ROOTS: root }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

const free928 = book({ id: 928, title: "Free as in Freedom", authors: ["Sam Williams"] });

describe("calibre_add_book duplicate skip (#555)", () => {
  it("marks the skip in structuredContent and names the matching book", async () => {
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [free928]));
    expect(r.structuredContent).toMatchObject({ addedIds: [], skipped: "duplicate", duplicateOf: 928 });
  });

  it("puts the next step in structuredContent", async () => {
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [free928]));
    expect(r.structuredContent?.hint).toContain("calibre_find_duplicates mode=compare");
  });

  it("names the matching book and the next step in the text", async () => {
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [free928]));
    expect([
      text(r).includes("duplicate of book #928"),
      text(r).includes("calibre_find_duplicates mode=compare"),
    ]).toEqual([true, true]);
  });

  it("is not an error", async () => {
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [free928]));
    expect(r.isError).toBeFalsy();
  });

  it("matches the title modulo case, punctuation and accents", async () => {
    const r = await addBookTool.handler({ path: file }, deps(skipped("FREE as in freedom!"), [free928]));
    expect(r.structuredContent?.duplicateOf).toBe(928);
  });

  it("does not guess when two library books share the title", async () => {
    const twin = book({ id: 929, title: "Free As In Freedom", authors: ["Richard Stallman"] });
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [free928, twin]));
    expect([
      r.structuredContent?.skipped,
      r.structuredContent?.duplicateOf,
      text(r).includes("could not be identified"),
    ]).toEqual(["duplicate", undefined, true]);
  });

  it("does not name a book whose title only contains the skipped title", async () => {
    const longer = book({ id: 930, title: "Free as in Freedom 2.0", authors: ["Sam Williams"] });
    const r = await addBookTool.handler({ path: file }, deps(skipped("Free as in Freedom"), [longer]));
    expect([r.structuredContent?.duplicateOf, text(r).includes("could not be identified")]).toEqual([undefined, true]);
  });

  it("still reports the skip when calibredb printed no title", async () => {
    const r = await addBookTool.handler(
      { path: file },
      deps(async () => ({ stdout: "", stderr: "" }), [free928]),
    );
    expect([r.structuredContent?.skipped, r.structuredContent?.duplicateOf]).toEqual(["duplicate", undefined]);
  });

  it("does not mark a real add as skipped", async () => {
    const r = await addBookTool.handler(
      { path: file },
      deps(async () => ({ stdout: "Added book ids: 999", stderr: "" })),
    );
    expect([r.structuredContent?.addedIds, r.structuredContent?.skipped]).toEqual([[999], undefined]);
  });

  it("no longer calls the duplicate check advisory in the description", () => {
    expect(addBookTool.description).not.toMatch(/advisory/i);
  });
});

describe("calibre_update_book no-op reason (#555)", () => {
  it("carries the no-op reason in structuredContent", async () => {
    const b = book({ id: 658, title: "Old", authors: ["A"], tags: ["old"] });
    const content = {
      getBook: async (): Promise<Book> => b,
      resolveLibraryId: async (): Promise<string> => "Programming_Books",
    };
    const d = {
      ...deps(async () => ({ stdout: "", stderr: "" })),
      config: loadConfig({}),
      content: content as unknown as ToolDeps["content"],
    };
    const r = await updateBookTool.handler({ id: 658, changes: { tags: ["old"] } }, d);
    expect(r.structuredContent).toMatchObject({ noop: true, reason: "values already current" });
  });
});

// #341: the add_book duplicate probe decides with the curation matcher (same answer as
// find_duplicates mode:similar), flags copies added in the same call, and says when ids past
// the probe cap were not checked — in the text and in structuredContent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import { findDuplicateGroups } from "../../src/domain/curation/duplicates.js";
import type { LogSink } from "../../src/logging.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addprobe341-"));
  file = path.join(root, "book.pdf");
  writeFileSync(file, "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const book = (over: Partial<Book>): Book => ({
  id: 1,
  uuid: "u",
  title: "",
  authors: [],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...over,
});

// calibredb reports `added`; every title search returns `titleHits`; ISBN searches return nothing
function deps(added: number[], books: Book[], titleHits: number[]): BaseDeps {
  const byId = new Map(books.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async ({ query }: { query: string }) => {
      const ids = query.startsWith("identifiers:isbn:") ? [] : titleHits;
      return { bookIds: ids, total: ids.length, num: ids.length, offset: 0, sort: "title", libraryId: "Lib" };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  const calibredb = async () => ({ stdout: `Added book ids: ${added.join(", ")}`, stderr: "" });
  const log: LogSink = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
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

const text = (r: Awaited<ReturnType<typeof addBookTool.handler>>): string =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

// probe verdict for "existing" vs the just-added book, next to find_duplicates' verdict
async function verdicts(existing: Book, added: Book): Promise<[boolean, boolean]> {
  const r = await addBookTool.handler({ path: file }, deps([added.id], [existing, added], [existing.id, added.id]));
  const probe = r.structuredContent?.possibleDuplicates !== undefined;
  const similar = findDuplicateGroups([existing, added], "similar").length > 0;
  return [probe, similar];
}

describe("add_book probe agrees with find_duplicates mode:similar (#341)", () => {
  it("should_keep_editions_years_apart_like_find_duplicates", async () => {
    const author = ["Robert C. Martin"];
    const existing = book({ id: 10, title: "Clean Code", authors: author, pubdate: "2008-08-01T00:00:00+00:00" });
    const added = book({ id: 11, title: "Clean Code", authors: author, pubdate: "2012-01-01T00:00:00+00:00" });
    expect(await verdicts(existing, added)).toEqual([false, false]);
  });

  it("should_flag_a_leading_article_difference_like_find_duplicates", async () => {
    const author = ["Andrew Hunt"];
    const existing = book({ id: 20, title: "The Pragmatic Programmer", authors: author });
    const added = book({ id: 21, title: "Pragmatic Programmer", authors: author });
    expect(await verdicts(existing, added)).toEqual([true, true]);
  });
});

describe("add_book probe compares books added in the same call (#341)", () => {
  it("should_list_each_same_call_copy_as_a_duplicate_of_the_other", async () => {
    const author = ["John Ferguson Smart"];
    const books = [
      book({ id: 1300, title: "BDD in Action", authors: author }),
      book({ id: 1301, title: "BDD in Action", authors: author }),
    ];
    const r = await addBookTool.handler({ path: file }, deps([1300, 1301], books, [1300, 1301]));
    expect(r.structuredContent?.possibleDuplicates).toEqual([
      { id: 1300, of: [1301], reason: "title" },
      { id: 1301, of: [1300], reason: "title" },
    ]);
  });

  it("should_name_both_copies_in_the_text", async () => {
    const books = [book({ id: 1300, title: "BDD in Action" }), book({ id: 1301, title: "BDD in Action" })];
    const t = text(await addBookTool.handler({ path: file }, deps([1300, 1301], books, [1300, 1301])));
    expect([
      t.includes("#1300: possible duplicate of #1301"),
      t.includes("#1301: possible duplicate of #1300"),
    ]).toEqual([true, true]);
  });
});

describe("add_book probe reports ids past the cap (#341)", () => {
  const ids = Array.from({ length: 12 }, (_, i) => 1401 + i);
  const books = ids.map((id) => book({ id, title: `Unique Title ${String.fromCharCode(65 + id - 1401)}` }));

  it("should_say_in_the_text_how_many_were_not_probed", async () => {
    const r = await addBookTool.handler({ path: file }, deps(ids, books, []));
    expect(text(r)).toContain(
      "Duplicate probe checked the first 10 of 12 added book(s); 2 not probed (#1411, #1412) — run calibre_find_duplicates to check them.",
    );
  });

  it("should_list_the_unprobed_ids_in_structuredContent", async () => {
    const r = await addBookTool.handler({ path: file }, deps(ids, books, []));
    expect(r.structuredContent?.notProbed).toEqual([1411, 1412]);
  });

  it("should_add_no_cap_note_at_or_under_the_cap", async () => {
    const r = await addBookTool.handler({ path: file }, deps(ids.slice(0, 10), books, []));
    expect([text(r).includes("not probed"), r.structuredContent?.notProbed]).toEqual([false, undefined]);
  });
});

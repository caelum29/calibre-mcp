// #370 §add_book (from #352): the duplicate probe also searches the main title (before the
// subtitle colon / parenthetical), so "Clean Code: A Handbook" finds "Clean Code"; and a raw
// import's embedded PDF pubdate doesn't split it from the book it duplicates. The fake search
// matches like Calibre's `title:"…"`: case-insensitive substring, `\"` escapes a quote.
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
  root = mkdtempSync(path.join(tmpdir(), "addprobe370-"));
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

/** Library of `books`; calibredb adds `added`; title searches are substring matches. */
function deps(added: Book, books: Book[], queries: string[]): BaseDeps {
  const all = [...books, added];
  const byId = new Map(all.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async ({ query }: { query: string }) => {
      queries.push(query);
      const m = /^title:"((?:[^"\\]|\\.)*)"$/.exec(query);
      const needle = m ? m[1]!.replace(/\\(.)/g, "$1").toLowerCase() : undefined;
      const ids =
        needle === undefined ? [] : all.filter((b) => b.title.toLowerCase().includes(needle)).map((b) => b.id);
      return { bookIds: ids, total: ids.length, num: ids.length, offset: 0, sort: "title", libraryId: "Lib" };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  const calibredb = async () => ({ stdout: `Added book ids: ${added.id}`, stderr: "" });
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

/** The probe's flagged-of ids for `added` against an existing library. */
async function flagged(existing: Book[], added: Book, queries: string[] = []): Promise<number[] | undefined> {
  const r = await addBookTool.handler({ path: file }, deps(added, existing, queries));
  const dups = r.structuredContent?.possibleDuplicates as { id: number; of: number[] }[] | undefined;
  return dups?.find((d) => d.id === added.id)?.of;
}

const similar = (a: Book, b: Book): boolean => findDuplicateGroups([a, b], "similar").length > 0;

const martin = ["Robert C. Martin"];

describe("add_book probe searches the main title before the subtitle (#370)", () => {
  it("should_find_clean_code_for_clean_code_colon_a_handbook", async () => {
    const existing = book({ id: 10, title: "Clean Code", authors: martin });
    const added = book({ id: 11, title: "Clean Code: A Handbook of Agile Software Craftsmanship", authors: martin });
    expect(await flagged([existing], added)).toEqual([10]);
    expect(similar(existing, added)).toBe(true); // the matcher already agreed; only the search missed
  });

  it("should_cut_at_the_first_colon_when_a_title_has_several", async () => {
    const existing = book({ id: 20, title: "Domain-Driven Design", authors: ["Eric Evans"] });
    const added = book({
      id: 21,
      title: "Domain-Driven Design: Tackling Complexity: In the Heart of Software",
      authors: ["Eric Evans"],
    });
    expect(await flagged([existing], added)).toEqual([20]);
  });

  it("should_find_a_cyrillic_main_title", async () => {
    const existing = book({ id: 30, title: "Чистый код", authors: ["Роберт Мартин"] });
    const added = book({ id: 31, title: "Чистый код: создание, анализ и рефакторинг", authors: ["Роберт Мартин"] });
    expect(await flagged([existing], added)).toEqual([30]);
  });

  it("should_cut_before_a_parenthetical_like_the_matcher_drops_it", async () => {
    const existing = book({ id: 40, title: "Refactoring", authors: ["Martin Fowler"] });
    const added = book({ id: 41, title: "Refactoring (Addison-Wesley Signature Series)", authors: ["Martin Fowler"] });
    expect(await flagged([existing], added)).toEqual([40]);
  });

  it("should_escape_a_quote_in_the_main_title_query", async () => {
    const existing = book({ id: 50, title: 'The "Unix" Way', authors: ["Ann Lee"] });
    const added = book({ id: 51, title: 'The "Unix" Way: Second Look', authors: ["Ann Lee"] });
    const queries: string[] = [];
    expect(await flagged([existing], added, queries)).toEqual([50]);
    expect(queries).toContain('title:"The \\"Unix\\" Way"');
  });

  it("should_not_flag_a_different_book_that_only_shares_a_short_main_title", async () => {
    const existing = book({ id: 60, title: "Go Programming Blueprints", authors: ["Mat Ryer"] });
    const added = book({ id: 61, title: "Go: The Complete Guide", authors: ["Jane Doe"] });
    expect(await flagged([existing], added)).toBeUndefined();
    expect(similar(existing, added)).toBe(false);
  });

  it("should_not_send_a_second_identical_title_query_when_there_is_no_subtitle", async () => {
    const existing = book({ id: 70, title: "Clean Architecture", authors: martin });
    const added = book({ id: 71, title: "Clean Architecture", authors: martin });
    const queries: string[] = [];
    expect(await flagged([existing], added, queries)).toEqual([70]);
    expect(queries.filter((q) => q.startsWith("title:"))).toHaveLength(1);
  });
});

describe("add_book probe vs an embedded PDF pubdate on a raw import (#370)", () => {
  it("should_flag_a_raw_slug_import_whose_pdf_date_is_years_after_the_existing_book", async () => {
    const existing = book({ id: 80, title: "Clean Code", authors: martin, pubdate: "2008-08-01T00:00:00+00:00" });
    // raw import: filename-slug title, no authors, pubdate read from the PDF's own metadata
    const added = book({ id: 81, title: "clean-code", authors: [], pubdate: "2023-05-17T00:00:00+00:00" });
    expect(await flagged([existing], added)).toEqual([80]);
  });

  it("should_still_keep_an_authored_edition_years_apart_separate_like_find_duplicates", async () => {
    const existing = book({ id: 90, title: "Clean Code", authors: martin, pubdate: "2008-08-01T00:00:00+00:00" });
    const added = book({ id: 91, title: "Clean Code", authors: martin, pubdate: "2012-01-01T00:00:00+00:00" });
    expect(await flagged([existing], added)).toBeUndefined();
    expect(similar(existing, added)).toBe(false);
  });

  it("should_still_split_a_raw_import_whose_title_names_another_edition", async () => {
    // same pubdate year: the split must come from the title's edition, not the date
    const existing = book({
      id: 100,
      title: "Learning Go, 2nd Edition",
      authors: ["Jon Bodner"],
      pubdate: "2024-01-10T00:00:00+00:00",
    });
    const added = book({
      id: 101,
      title: "learning-go-1st-edition",
      authors: [],
      pubdate: "2024-02-01T00:00:00+00:00",
    });
    expect(await flagged([existing], added)).toBeUndefined();
  });
});

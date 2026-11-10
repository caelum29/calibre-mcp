// #370 (PR #377): a main title starting with `=`/`~`/`^` must not reach Calibre as an exact
// or regex `title:` search — an invalid regex throws and the whole probe degrades to
// "unavailable". The fake search throws on such queries the way Calibre rejects them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import type { LogSink } from "../../src/logging.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addprobe377-"));
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

const MODIFIED = /^title:"[=~^\s]/;

function deps(added: Book, books: Book[], queries: string[]): BaseDeps {
  const all = [...books, added];
  const byId = new Map(all.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async ({ query }: { query: string }) => {
      queries.push(query);
      if (MODIFIED.test(query)) throw new Error(`invalid regular expression in ${query}`);
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

async function run(existing: Book[], added: Book) {
  const queries: string[] = [];
  const r = await addBookTool.handler({ path: file }, deps(added, existing, queries));
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const dups = r.structuredContent?.possibleDuplicates as { id: number; of: number[] }[] | undefined;
  return { queries, text, of: dups?.find((d) => d.id === added.id)?.of };
}

const author = ["Ann Lee"];

describe("add_book probe never sends a `=`/`~`/`^`-led title search (PR #377 review)", () => {
  it("should_strip_a_leading_tilde_and_still_flag_the_duplicate", async () => {
    const r = await run(
      [book({ id: 10, title: "Foo", authors: author })],
      book({ id: 11, title: "~Foo: bar", authors: author }),
    );
    expect(r.of).toEqual([10]);
    expect(r.queries).toContain('title:"Foo"');
    expect(r.queries.filter((q) => MODIFIED.test(q))).toEqual([]);
    expect(r.text).not.toContain("Duplicate probe unavailable");
  });

  it("should_strip_leading_equals_caret_and_spaces", async () => {
    const r = await run(
      [book({ id: 20, title: "Go", authors: author })],
      book({ id: 21, title: "= ^Go: x", authors: author }),
    );
    expect(r.of).toEqual([20]);
    expect(r.queries).toContain('title:"Go"');
    expect(r.queries.filter((q) => MODIFIED.test(q))).toEqual([]);
  });

  it("should_skip_the_main_query_when_only_prefix_characters_are_left", async () => {
    // the full-title words query ("x y") still runs and still finds the exact copy
    const r = await run(
      [book({ id: 30, title: "~= x y", authors: author })],
      book({ id: 31, title: "~=: x y", authors: author }),
    );
    expect(r.queries.filter((q) => q.startsWith("title:"))).toEqual(['title:"x y"']);
    expect(r.text).not.toContain("Duplicate probe unavailable");
  });
});

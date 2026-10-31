// #204 — calibre_add_book runs a read-only post-add duplicate probe (ISBN / raw-title match)
// and surfaces an advisory hint in the TEXT content; the add itself never fails because of it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import type { LogSink } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addprobe-"));
  file = path.join(root, "advanced-microservices.pdf");
  writeFileSync(file, "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function book(over: Partial<Book>): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

interface Fx {
  books: Book[];
  /** ids the ISBN-identifier query returns */
  isbnHits?: number[];
  /** ids any other (title) query returns */
  titleHits?: number[];
  searchThrows?: boolean;
}

function deps(newId: number, fx: Fx, warn: LogSink["warn"] = () => {}): ToolDeps {
  const byId = new Map(fx.books.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async ({ query }: { query: string }) => {
      if (fx.searchThrows) throw new Error("content server down");
      const ids = query.startsWith("identifiers:isbn:") ? (fx.isbnHits ?? []) : (fx.titleHits ?? []);
      return { bookIds: ids, total: ids.length, num: ids.length, offset: 0, sort: "title", libraryId: "Lib" };
    },
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  const calibredb = async () => ({ stdout: `Added book ids: ${newId}`, stderr: "" });
  const log: LogSink = { debug: () => {}, info: () => {}, warn, error: () => {} };
  return {
    config: loadConfig({ CALIBRE_MCP_ADD_ROOTS: root }),
    content: content as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

const text = (r: Awaited<ReturnType<typeof addBookTool.handler>>): string =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe("calibre_add_book duplicate probe (#204)", () => {
  it("flags a raw-slug title that matches an existing book, with a compare next step", async () => {
    const fx: Fx = {
      books: [
        book({ id: 1270, title: "advanced-microservices" }),
        book({ id: 210, title: "Advanced Microservices", authors: ["Thomas Hunter II"] }),
      ],
      titleHits: [210, 1270],
    };
    const r = await addBookTool.handler({ path: file }, deps(1270, fx));
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Added 1 book(s) (id 1270)");
    expect(text(r)).toContain("possible duplicate of #210");
    expect(text(r)).toContain("calibre_find_duplicates mode=compare ids=[210,1270]");
    expect(r.structuredContent?.addedIds).toEqual([1270]);
    expect(r.structuredContent?.possibleDuplicates).toEqual([{ id: 1270, of: [210], reason: "title" }]);
  });

  it("flags an identical ISBN even when titles differ", async () => {
    const fx: Fx = {
      books: [
        book({ id: 1298, title: "BDD in Action (2)", identifiers: { isbn: "9781617291656" } }),
        book({ id: 1293, title: "Behaviour-Driven Development", identifiers: { isbn: "9781617291656" } }),
      ],
      isbnHits: [1293, 1298],
    };
    const r = await addBookTool.handler({ path: file }, deps(1298, fx));
    expect(text(r)).toContain("possible duplicate of #1293");
    expect(text(r)).toContain("ids=[1293,1298]");
    expect(r.structuredContent?.possibleDuplicates).toEqual([{ id: 1298, of: [1293], reason: "isbn" }]);
  });

  it("stays silent when the only title hit is a different book or the book itself", async () => {
    const fx: Fx = {
      books: [
        book({ id: 1270, title: "advanced-microservices" }),
        book({ id: 300, title: "Advanced Microservices Patterns" }),
      ],
      titleHits: [300, 1270],
    };
    const r = await addBookTool.handler({ path: file }, deps(1270, fx));
    expect(r.isError).toBeFalsy();
    expect(text(r)).not.toContain("possible duplicate");
    expect(r.structuredContent?.possibleDuplicates).toBeUndefined();
  });

  // Twin of #241: stripping every combining mark folds Cyrillic й into и, so different RU titles collide.
  it("keeps Cyrillic й distinct from и when matching titles", async () => {
    const fx: Fx = {
      books: [book({ id: 501, title: "Мой Python" }), book({ id: 502, title: "Мои Python" })],
      titleHits: [501, 502],
    };
    const r = await addBookTool.handler({ path: file }, deps(502, fx));
    expect(r.structuredContent?.possibleDuplicates).toBeUndefined();
  });

  it("degrades to a plain success and logs a warning when the probe read fails", async () => {
    const warn = vi.fn();
    const fx: Fx = { books: [book({ id: 1270, title: "advanced-microservices" })], searchThrows: true };
    const r = await addBookTool.handler({ path: file }, deps(1270, fx, warn));
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Added 1 book(s) (id 1270)");
    expect(r.structuredContent?.addedIds).toEqual([1270]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("duplicate probe");
  });
});

// #563: `identifiers` merges by scheme in update_book and bulk_update — listed schemes are set,
// unlisted ones stay, `null` removes a scheme. Other fields still replace.

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { formatFieldValue } from "../../src/calibre/metadata-fields.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

const URL = "http://www.gutenberg.org/5768";
const ISBN = "9780132350884";

const book = (over: Partial<Book> = {}): Book => ({
  id: 658,
  uuid: "u-658",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
});

const ok = async (_args: readonly string[], _opts?: unknown) => ({ stdout: "", stderr: "" });

/** getBook returns successive snapshots per id (snapshot, then re-read); the last one repeats. */
function deps(
  reads: Record<number, (Book | Error)[]>,
  calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }> = ok,
): BaseDeps {
  const queues = new Map(
    Object.entries(reads).map(([id, list]) => [Number(id), [...list]] as [number, (Book | Error)[]]),
  );
  const next = (id: number): Book => {
    const q = queues.get(id) ?? [];
    const v = q.length > 1 ? q.shift()! : q[0]!;
    if (v instanceof Error) throw v;
    return v;
  };
  const ids = Object.keys(reads).map(Number);
  const content = fakeContent({
    resolveLibraryId: async (name) => asLibId(name ?? "Programming_Books"),
    getBook: async (id: number) => next(id),
    search: async () => ({
      bookIds: ids,
      total: ids.length,
      num: ids.length,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (want) => new Map(want.map((id) => [id, next(id)] as const)),
  });
  return {
    config: loadConfig({}),
    content,
    calibre: fakeCalibre({ calibredb }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder: fakeEmbedder(),
    log,
  };
}

const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

describe("calibre_update_book — identifiers merge by scheme (#563)", () => {
  it("keeps an unlisted scheme (the url-dropped repro)", async () => {
    const spy = vi.fn(ok);
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: ISBN } } },
      deps(
        {
          658: [book({ identifiers: { url: URL } }), book({ identifiers: { url: URL, isbn: ISBN } })],
        },
        spy,
      ),
    );
    expect(spy).toHaveBeenCalledWith(
      ["set_metadata", "658", "--field", `identifiers:url:${URL},isbn:${ISBN}`],
      expect.objectContaining({ library: "Programming_Books" }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([
      { field: "identifiers", before: { url: URL }, after: { url: URL, isbn: ISBN } },
    ]);
    expect(r.structuredContent?.noop).toBe(false);
  });

  it("replaces a listed scheme's value in place", async () => {
    const spy = vi.fn(ok);
    await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: ISBN } } },
      deps({ 658: [book({ identifiers: { isbn: "0000000000", url: URL } })] }, spy),
    );
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "658", "--field", `identifiers:isbn:${ISBN},url:${URL}`]);
  });

  it("removes a scheme given null and keeps the rest", async () => {
    const spy = vi.fn(ok);
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: null } } },
      deps({ 658: [book({ identifiers: { url: URL, isbn: ISBN } }), book({ identifiers: { url: URL } })] }, spy),
    );
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "658", "--field", `identifiers:url:${URL}`]);
    expect(r.structuredContent?.changed).toEqual([
      { field: "identifiers", before: { url: URL, isbn: ISBN }, after: { url: URL } },
    ]);
  });

  it("clears identifiers when null removes the last scheme", async () => {
    const spy = vi.fn(ok);
    await updateBookTool.handler(
      { id: 658, changes: { identifiers: { url: null } } },
      deps({ 658: [book({ identifiers: { url: URL } }), book()] }, spy),
    );
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "658", "--field", "identifiers:"]);
  });

  it("accepts null scheme values in the input schema", () => {
    const schema = z.object(updateBookTool.inputSchema);
    expect(schema.safeParse({ id: 658, changes: { identifiers: { isbn: null, url: URL } } }).success).toBe(true);
    // the -32602 path: the whole changes object as a JSON string
    expect(schema.safeParse({ id: 658, changes: '{"identifiers":{"isbn":null}}' }).success).toBe(true);
  });

  it("is a noop when the listed scheme is already current", async () => {
    const same = book({ identifiers: { url: URL, isbn: ISBN } });
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: ISBN } } },
      deps({ 658: [same, same] }),
    );
    expect(r.structuredContent?.changed).toEqual([]);
    expect(r.structuredContent?.noop).toBe(true);
    expect(text(r)).toContain("No changes applied to book 658");
  });

  it("shows the merged map as the intended diff when the re-read fails", async () => {
    const r = await updateBookTool.handler(
      { id: 658, changes: { identifiers: { isbn: ISBN } } },
      deps({ 658: [book({ identifiers: { url: URL } }), new CalibreHttpError(0, "u", "timed out")] }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.changed).toEqual([
      { field: "identifiers", before: { url: URL }, after: { url: URL, isbn: ISBN } },
    ]);
    expect(text(r)).toContain(`identifiers: {"url":"${URL}"} → {"url":"${URL}","isbn":"${ISBN}"}`);
  });

  it("still replaces other fields (tags)", async () => {
    const spy = vi.fn(ok);
    await updateBookTool.handler(
      { id: 658, changes: { tags: ["new"] } },
      deps({ 658: [book({ tags: ["a", "b"] }), book({ tags: ["new"] })] }, spy),
    );
    expect(spy.mock.calls[0]?.[0]).toEqual(["set_metadata", "658", "--field", "tags:new"]);
  });
});

describe("calibre_bulk_update — identifiers merge per book (#563)", () => {
  const fixture = {
    1: [book({ id: 1, identifiers: { url: URL } })],
    2: [book({ id: 2, identifiers: { doi: "10.1/x", isbn: "0000000000" } })],
  };

  it("writes each book's own merged map", async () => {
    const spy = vi.fn(ok);
    const r = await bulkUpdateTool.handler(
      { changes: { identifiers: { isbn: ISBN } }, ids: [1, 2], preview: false },
      deps(fixture, spy),
    );
    expect(r.isError).toBeFalsy();
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      ["set_metadata", "1", "--field", `identifiers:url:${URL},isbn:${ISBN}`],
      ["set_metadata", "2", "--field", `identifiers:doi:10.1/x,isbn:${ISBN}`],
    ]);
  });

  it("previews the merged map without a replace-all warning", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { identifiers: { isbn: ISBN, doi: null } }, ids: [1, 2], preview: true },
      deps(fixture),
    );
    const books = r.structuredContent?.books as { id: number; changed: unknown[]; warnings?: string[] }[];
    expect(books.map((b) => b.changed)).toEqual([
      [{ field: "identifiers", before: { url: URL }, after: { url: URL, isbn: ISBN } }],
      [{ field: "identifiers", before: { doi: "10.1/x", isbn: "0000000000" }, after: { isbn: ISBN } }],
    ]);
    expect(books.map((b) => b.warnings)).toEqual([undefined, undefined]);
    expect(text(r)).not.toContain("replaces all existing identifiers");
    expect(text(r)).toContain(`identifiers: {"url":"${URL}"} → {"url":"${URL}","isbn":"${ISBN}"}`);
  });
});

describe("formatFieldValue — a null scheme never reaches calibredb (#563)", () => {
  it("leaves null schemes out of the --field value", () => {
    expect(formatFieldValue("identifiers", { isbn: null, url: URL })).toBe(`url:${URL}`);
  });
});

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { findDuplicatesTool } from "../../src/tools/calibre_find_duplicates.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

/** Fake content client: search returns all ids; booksByIds serves from a fixture map. */
function deps(fixture: Book[]): BaseDeps {
  const byId = new Map(fixture.map((b) => [b.id, b] as const));
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async () => ({
      bookIds: fixture.map((b) => b.id),
      total: fixture.length,
      num: fixture.length,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({ mode: "identical" as const, limit: 50, ...over });

describe("calibre_find_duplicates handler", () => {
  it("returns identical-title groups with resource_links + merge safety", async () => {
    const fixture = [
      book({ id: 1, title: "Rust", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "rust", authors: ["a"], formats: ["epub"] }),
      book({ id: 3, title: "Go", authors: ["B"] }),
    ];
    const r = await findDuplicatesTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "identical", groupCount: 1, booksScanned: 3 });
    expect(r.content.some((b) => b.type === "resource_link")).toBe(true);
  });

  it("paginates groups with a nextCursor", async () => {
    // 4 distinct duplicate groups; page size 2 → cursor after the first page.
    const fixture: Book[] = [];
    for (let g = 0; g < 4; g++) {
      fixture.push(book({ id: g * 2 + 1, title: `T${g}`, authors: ["X"] }));
      fixture.push(book({ id: g * 2 + 2, title: `t${g}`, authors: ["x"] }));
    }
    const first = await findDuplicatesTool.handler(args({ limit: 2 }), deps(fixture));
    expect(first.structuredContent?.count).toBe(2);
    const cursor = first.structuredContent?.nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await findDuplicatesTool.handler(args({ limit: 2, cursor }), deps(fixture));
    expect(second.structuredContent?.offset).toBe(2);
  });

  it("compare requires at least 2 ids", async () => {
    const r = await findDuplicatesTool.handler(args({ mode: "compare", ids: [1] }), deps([book({ id: 1 })]));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("at least 2");
  });

  it("compare diffs an explicit id set and recommends a keep", async () => {
    const fixture = [
      book({ id: 1, title: "T", authors: ["A"], formats: ["pdf"] }),
      book({ id: 2, title: "T", authors: ["A"], formats: ["pdf", "epub"], publisher: "P" }),
    ];
    const r = await findDuplicatesTool.handler(args({ mode: "compare", ids: [1, 2] }), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: "compare", keep: 2 });
  });

  it("notes that binary mode is deferred", async () => {
    const r = await findDuplicatesTool.handler(args(), deps([book({ id: 1, title: "X" })]));
    expect((r.content[0] as { text: string }).text).toContain("binary mode");
  });

  it("describes binary mode as not implemented yet, not 'deferred in v1' (#306)", async () => {
    const r = await findDuplicatesTool.handler(args(), deps([book({ id: 1, title: "X" })]));
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("binary mode (byte-level dedupe) is not implemented yet.");
    expect(text).not.toContain("deferred in v1");
  });
});

// issue #211 — the group cursor must reach text-only clients (Desktop) too
describe("calibre_find_duplicates cursor in text (#211)", () => {
  const fixture: Book[] = [0, 1, 2].flatMap((g) => [
    book({ id: g * 2 + 1, title: `T${g}`, authors: ["X"] }),
    book({ id: g * 2 + 2, title: `t${g}`, authors: ["x"] }),
  ]);
  const last = (r: { content: { type: string }[] }): string => {
    const b = r.content.at(-1) as { type: string; text?: string };
    return b.type === "text" ? (b.text ?? "") : "";
  };

  it("ends with the continue-with-cursor line carrying nextCursor", async () => {
    const r = await findDuplicatesTool.handler(args({ limit: 2 }), deps(fixture));
    const cursor = r.structuredContent?.nextCursor as string;
    expect(cursor).toBeTypeOf("string");
    expect(last(r)).toBe(`More results — continue with cursor: ${cursor}`);
  });

  it("has no cursor line on the last page", async () => {
    const first = await findDuplicatesTool.handler(args({ limit: 2 }), deps(fixture));
    const r = await findDuplicatesTool.handler(
      args({ limit: 2, cursor: first.structuredContent?.nextCursor }),
      deps(fixture),
    );
    expect(r.structuredContent).toMatchObject({ offset: 2, count: 1 });
    expect(JSON.stringify(r.content)).not.toContain("continue with cursor");
  });

  it("has no cursor line when there are no groups", async () => {
    const r = await findDuplicatesTool.handler(args(), deps([book({ id: 1, title: "Solo" })]));
    expect(JSON.stringify(r.content)).not.toContain("continue with cursor");
  });
});

// issue #199 — Claude Code shows only structuredContent: the group boundaries (similar /
// identical) and the compare diff must be mirrored there, not only rendered as text
describe("calibre_find_duplicates groups[] / diff[] in structuredContent (#199)", () => {
  interface Group {
    bookIds: number[];
    mergeSafety: number;
    mixedLanguages: boolean;
  }
  const allText = (r: { content: { type: string }[] }): string =>
    r.content.map((b) => (b.type === "text" ? (b as unknown as { text: string }).text : "")).join("\n");

  it("mirrors each page group's book ids and mergeSafety", async () => {
    const fixture = [
      book({ id: 1, title: "Rust", authors: ["A"], languages: ["eng"] }),
      book({ id: 2, title: "rust", authors: ["a"], languages: ["eng"] }),
      book({ id: 3, title: "Go", authors: ["B"], languages: ["eng"] }),
      book({ id: 4, title: "go", authors: ["b"], languages: ["rus"] }),
      book({ id: 5, title: "Solo", authors: ["C"] }),
    ];
    const r = await findDuplicatesTool.handler(args(), deps(fixture));
    const groups = r.structuredContent?.groups as Group[];
    expect(groups.map((g) => [...g.bookIds].sort())).toEqual(
      expect.arrayContaining([
        [1, 2],
        [3, 4],
      ]),
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.bookIds.includes(3))?.mixedLanguages).toBe(true);
    expect(groups.find((g) => g.bookIds.includes(1))?.mixedLanguages).toBe(false);
    for (const g of groups) expect(allText(r)).toContain(`mergeSafety ${g.mergeSafety.toFixed(2)}`);
  });

  it("returns an empty groups[] when nothing duplicates", async () => {
    const r = await findDuplicatesTool.handler(args(), deps([book({ id: 1, title: "Solo" })]));
    expect(r.structuredContent?.groups).toEqual([]);
  });

  it("compare: mirrors the field-by-field diff and the compared ids", async () => {
    const fixture = [
      book({ id: 1, title: "Rust", authors: ["A"], languages: ["eng"], formats: ["pdf"] }),
      book({ id: 2, title: "Rust", authors: ["A"], languages: ["rus"], formats: ["epub"] }),
    ];
    const r = await findDuplicatesTool.handler(args({ mode: "compare", ids: [1, 2] }), deps(fixture));
    const diff = r.structuredContent?.diff as { field: string; agree: boolean; values: string[] }[];
    expect(r.structuredContent?.bookIds).toEqual([1, 2]);
    expect(diff.find((d) => d.field === "title")).toEqual({ field: "title", agree: true, values: ["Rust", "Rust"] });
    expect(diff.find((d) => d.field === "languages")).toEqual({
      field: "languages",
      agree: false,
      values: ["eng", "rus"],
    });
    for (const d of diff) expect(allText(r)).toContain(`${d.agree ? "=" : "≠"} ${d.field}: ${d.values.join(" | ")}`);
  });
});

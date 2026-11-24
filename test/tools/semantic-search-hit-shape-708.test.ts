// #708 / ADR-0034: the hit shape of calibre_semantic_search. Library text hits show an
// 800-character window; every text hit (both scopes) carries its section path (`section:` line +
// `sectionPath`, last 3 levels) and, for a paged (PDF) text, its 1-based page (`page:` line +
// `page`). Labels are absent, not empty, when the data is missing or disagrees with the chunk.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { BookSections } from "../../src/domain/structure/sections.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { SectionRef } from "../../src/semantic/store/types.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  embedQuery: async () => axis(0),
  embedPassages: async (texts) => texts.map(() => axis(0)),
  warmup: async () => {},
  countTokens: (s) => s.length,
};

function deps(index: ToolDeps["index"]): ToolDeps {
  const content = { resolveLibraryId: async () => LIB, search: async () => ({ ids: [1, 2, 3] }) };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index,
    log,
  };
}

// Book 1, a PDF: three pages split by `\f`. Page 1 = preface (front matter), page 2 opens
// Part II › 13 Caching, page 3 opens 13.7 Invalidation (and its sub-section Stale entries).
const rep = (s: string, n: number) => s.repeat(n);
const P1 = rep("Preface notes on why this book exists and who should read it. ", 10);
const P2 = rep("Chapter thirteen covers caching layers, read paths and write paths. ", 15);
const P3 = "13.7 Invalidation\n" + rep("Cache invalidation is famously hard because stale entries linger. ", 20);
const PDF_TEXT = `${P1}\f${P2}\f${P3}`;
const A_END = P1.length + 1; // chunk A = page 1 with its trailing \f
const S = PDF_TEXT.indexOf("13.7 Invalidation"); // where 13.7 starts, inside chunk B
const END = PDF_TEXT.length;

const PDF_SECTIONS: BookSections = {
  source: "pdf-outline",
  sections: [
    { title: "Preface", level: 1, charStart: 0, charEnd: A_END, parent: null, matterKind: "front" },
    { title: "Part II", level: 1, charStart: A_END, charEnd: END, parent: null, matterKind: "body" },
    { title: "13 Caching", level: 2, charStart: A_END, charEnd: END, parent: 1, matterKind: "body" },
    { title: "13.7 Invalidation", level: 3, charStart: S, charEnd: END, parent: 2, matterKind: "body" },
    { title: "Stale entries", level: 4, charStart: S, charEnd: END, parent: 3, matterKind: "body" },
  ],
};

// Book 2, an EPUB: no page breaks and no section spans.
const EPUB_TEXT = rep("Invalidation of stale entries in an EPUB cache chapter, told without pages. ", 14);

function store(): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(
    LIB,
    { bookId: 1, title: "Caching in Practice", authors: ["A. Author"] },
    [
      { charStart: 0, charEnd: A_END, body: PDF_TEXT.slice(0, A_END), matterKind: "front", vector: axis(1) },
      { charStart: A_END, charEnd: END, body: PDF_TEXT.slice(A_END), vector: axis(0) },
    ],
    [{ figIndex: 0, page: 3, caption: "Figure 13.7 Invalidation timeline", charOffset: S + 40, format: "pdf" }],
    { sections: PDF_SECTIONS },
  );
  s.replaceBook(LIB, { bookId: 2, title: "Caches, the EPUB", authors: ["B. Author"] }, [
    { charStart: 0, charEnd: EPUB_TEXT.length, body: EPUB_TEXT, vector: axis(2) },
  ]);
  return s;
}

const QUERY = "invalidation stale entries";

async function call(index: ToolDeps["index"], args: Record<string, unknown>) {
  const r = await semanticSearchTool.handler({ topK: 10, mode: "keyword", ...args }, deps(index));
  expect(r.isError).toBeFalsy();
  const text = r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
  return { text, sc: r.structuredContent as Record<string, unknown> };
}

type Hit = Record<string, unknown>;
const byBook = (sc: Record<string, unknown>, id: number) => (sc.results as Hit[]).find((h) => h.bookId === id)!;
const lines = (text: string, label: string) => text.split("\n").filter((l) => l.startsWith(`${label}: `));

describe("library hit shape (#708, ADR-0034)", () => {
  it("shows an 800-character window placed at the match, '…'-prefixed", async () => {
    const { text, sc } = await call(store(), { query: QUERY, scope: "library" });
    const pdf = byBook(sc, 1);
    expect(pdf.snippetStart).toBe(S);
    expect(text).toContain(`\n…${PDF_TEXT.slice(S, S + 800)}\n--- END MATCH`);
  });

  it("labels the section at the snippet start, cut to its last 3 levels, in both channels", async () => {
    const { text, sc } = await call(store(), { query: QUERY, scope: "library" });
    expect(byBook(sc, 1).sectionPath).toEqual(["13 Caching", "13.7 Invalidation", "Stale entries"]);
    expect(lines(text, "section")).toEqual(["section: 13 Caching › 13.7 Invalidation › Stale entries"]);
  });

  it("labels the PDF page of the snippet start (1-based, as figure hits count), in both channels", async () => {
    const { text, sc } = await call(store(), { query: QUERY, scope: "library" });
    expect(byBook(sc, 1).page).toBe(3);
    expect(lines(text, "page")).toEqual(["page: 3"]);
  });

  it("gives an EPUB hit with no spans and no page breaks neither label nor key", async () => {
    const { sc } = await call(store(), { query: QUERY, scope: "library" });
    const epub = byBook(sc, 2);
    expect(["sectionPath" in epub, "page" in epub]).toEqual([false, false]);
  });

  it("puts each label right before its own hit's fence", async () => {
    const { text } = await call(store(), { query: QUERY, scope: "library" });
    expect(text).toContain(
      "section: 13 Caching › 13.7 Invalidation › Stale entries\npage: 3\n--- BEGIN UNTRUSTED MATCH book 1 ",
    );
  });
});

describe("book-scope hit shape (#708, ADR-0034)", () => {
  it("labels a passage by its chunk start: section and page, both channels, body unchanged", async () => {
    const { text, sc } = await call(store(), { query: QUERY, scope: "book", bookId: 1 });
    const top = (sc.passages as Hit[])[0]!;
    expect([top.charStart, top.sectionPath, top.page]).toEqual([A_END, ["Part II", "13 Caching"], 2]);
    expect(text).toContain(`section: Part II › 13 Caching\npage: 2\n--- BEGIN UNTRUSTED PASSAGE @${A_END}-${END}`);
    expect(text).toContain(`\n${PDF_TEXT.slice(A_END)}\n--- END PASSAGE`);
  });

  it("keeps matterKind next to the section label: a preface hit is front matter in section Preface", async () => {
    const { text, sc } = await call(store(), { query: "preface notes", scope: "book", bookId: 1 });
    const top = (sc.passages as Hit[])[0]!;
    expect([top.charStart, top.matterKind, top.sectionPath, top.page]).toEqual([0, "front", ["Preface"], 1]);
    expect(text).toContain("section: Preface\npage: 1\n--- BEGIN UNTRUSTED PASSAGE @0-");
  });

  it("gives an EPUB passage no labels", async () => {
    const { text, sc } = await call(store(), { query: QUERY, scope: "book", bookId: 2 });
    const top = (sc.passages as Hit[])[0]!;
    expect(["sectionPath" in top, "page" in top, lines(text, "section"), lines(text, "page")]).toEqual([
      false,
      false,
      [],
      [],
    ]);
  });
});

describe("labels absent when the data disagrees (#708)", () => {
  /** The store, with sectionPathAt answering from stale rows that miss the hit's chunk. */
  function staleSections(s: SqliteIndexStore): ToolDeps["index"] {
    const stale: SectionRef[] = [
      {
        id: 9,
        parentId: null,
        level: 1,
        title: "Old Chapter",
        charStart: 50_000,
        charEnd: 60_000,
        matterKind: "body",
        source: "pdf-outline",
      },
    ];
    return new Proxy(s, {
      get(target, prop) {
        if (prop === "sectionPathAt") return () => stale;
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  it("shows no section label for a span that does not hold the hit's chunk", async () => {
    const { text, sc } = await call(staleSections(store()), { query: QUERY, scope: "library" });
    expect(["sectionPath" in byBook(sc, 1), lines(text, "section")]).toEqual([false, []]);
  });

  it("shows no page when the book's chunks leave a gap before the hit (the count would be wrong)", async () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
    // chunk [A_END, A_END+10) is missing: a `\f` in it would go uncounted
    s.replaceBook(LIB, { bookId: 3, title: "Gappy PDF", authors: ["C"] }, [
      { charStart: 0, charEnd: A_END, body: PDF_TEXT.slice(0, A_END), vector: axis(1) },
      { charStart: A_END + 10, charEnd: END, body: PDF_TEXT.slice(A_END + 10), vector: axis(0) },
    ]);
    const { text, sc } = await call(s, { query: QUERY, scope: "library" });
    expect(["page" in byBook(sc, 3), lines(text, "page")]).toEqual([false, []]);
  });
});

describe("widths that do not change (#708, ADR-0034 item 9)", () => {
  it("keeps the figure hit's contextSnippet at 320 characters", async () => {
    const { sc } = await call(store(), { query: "invalidation timeline", scope: "library", target: "figures" });
    const fig = (sc.figures as Hit[])[0]!;
    expect([fig.page, fig.contextSnippet]).toEqual([3, PDF_TEXT.slice(A_END, A_END + 320)]);
  });
});

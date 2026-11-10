// Dual-channel parity contract (#227). Claude Desktop shows the model ONLY the text content;
// Claude Code shows ONLY structuredContent (for tools with an outputSchema). So every
// model-actionable field must be rendered into BOTH channels. Runs scenarios over the whole
// registry with fake deps; a tool without a scenario must sit on the explicit allowlist.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ProviderHit } from "../../src/domain/enrich/types.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { allTools } from "../../src/tools/registry.js";
import { decodeCursor, pageCursor } from "../../src/tools/cursor.js";
import { renderResult } from "../../src/tools/result.js";
import {
  ERROR_LINES,
  LABELLED_LINES,
  renderLabelledLinesDoc,
  type LabelledLine,
} from "../../src/tools/labelled-lines.js";
import type { AnyToolDescriptor, ToolResult } from "../../src/tools/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { fakeFts } from "./fake-fts.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";

// real calibredb captures (#500) for the annotations / notes modes
const CAPTURE_500 = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const capture500 = (name: string): string => readFileSync(path.join(CAPTURE_500, `${name}.raw`), "utf8");

// ── the parity checker ────────────────────────────────────────────────────────────────

/** Everything a text-only client sees: text blocks plus resource_link names/uris. */
function textChannel(r: ToolResult): string {
  return r.content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "resource_link") return [b.uri, b.name, b.title ?? "", b.description ?? ""].join(" ");
      return "";
    })
    .join("\n");
}

const CURSOR_KEY = /cursor$/i;
const ID_KEY = /^(id|ids|keep|applied|notAttempted)$|Ids?$/;
// String ids are checked on plain `id`/`ids` only: `libraryId` in get_book/search is widget plumbing
// (serverUrl + libraryId for the card's URLs), not something the model acts on.
const STRING_ID_KEY = /^ids?$/;
const FAILURE_KEY = /^(error|errors|reason|failures?|warnings?|semanticReason)$/;
const DIFF_KEY = /^(changed|diffs?|changes|metadataChanges)$/;
/** Free-text values are compared on a prefix — renderers may truncate long values. */
const PREFIX = 60;

const hasNumber = (text: string, n: number): boolean => new RegExp(`(^|[^\\d.])${n}($|[^\\d])`).test(text);

const hasToken = (text: string, t: string): boolean =>
  new RegExp(`(^|[^\\w])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`).test(text);

/** Every scalar leaf of a diff entry (field names, before/after values). */
function diffLeaves(v: unknown, out: (string | number)[] = []): (string | number)[] {
  if (typeof v === "string" || typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => diffLeaves(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k !== "field" && k !== "before" && k !== "after") out.push(k);
      diffLeaves(x, out);
    }
  }
  return out;
}

/** structured → text: actionable structured values that the text channel lacks. */
function structuredOnly(structured: unknown, text: string, at = "$"): string[] {
  const gaps: string[] = [];
  if (Array.isArray(structured)) {
    structured.forEach((x, i) => gaps.push(...structuredOnly(x, text, `${at}[${i}]`)));
    return gaps;
  }
  if (!structured || typeof structured !== "object") return gaps;
  for (const [k, v] of Object.entries(structured)) {
    const where = `${at}.${k}`;
    // #437: error results are text-only on both clients, so the code and the hint must be there too
    if (k === "errorCode" && typeof v === "string") {
      if (!new RegExp(`^Code: ${v}$`, "m").test(text)) gaps.push(`${where} "${v}" missing from text`);
    } else if (k === "hint" && typeof v === "string") {
      if (!text.includes(v)) gaps.push(`${where} "${v}" missing from text`);
    } else if (CURSOR_KEY.test(k) && typeof v === "string") {
      if (!text.includes(v)) gaps.push(`${where} (cursor) missing from text`);
    } else if (ID_KEY.test(k) && (typeof v === "number" || typeof v === "string" || Array.isArray(v))) {
      for (const n of [v].flat()) {
        if (typeof n === "number" && !hasNumber(text, n)) gaps.push(`${where} id ${n} missing from text`);
        // String ids (library ids): whole-token match so "Lib" isn't satisfied by "Library".
        else if (typeof n === "string" && STRING_ID_KEY.test(k) && !hasToken(text, n))
          gaps.push(`${where} id "${n}" missing from text`);
      }
    } else if (FAILURE_KEY.test(k) && (typeof v === "string" || Array.isArray(v))) {
      for (const s of [v].flat()) {
        if (typeof s === "string" && !text.includes(s.slice(0, PREFIX))) gaps.push(`${where} "${s}" missing from text`);
        else if (typeof s === "object") gaps.push(...structuredOnly(s, text, where));
      }
    } else if (DIFF_KEY.test(k) && v && typeof v === "object") {
      for (const leaf of diffLeaves(v)) {
        const shown = typeof leaf === "number" ? hasNumber(text, leaf) : text.includes(leaf.slice(0, PREFIX));
        if (!shown) gaps.push(`${where} diff value ${JSON.stringify(leaf)} missing from text`);
      }
    } else if (v && typeof v === "object") {
      gaps.push(...structuredOnly(v, text, where));
    }
  }
  return gaps;
}

function structuredStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => structuredStrings(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      structuredStrings(x, out);
    }
  }
  return out;
}

function structuredNumbers(v: unknown, out = new Set<number>()): Set<number> {
  if (typeof v === "number") out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => structuredNumbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => structuredNumbers(x, out));
  return out;
}

const FENCE = /--- BEGIN UNTRUSTED ([A-Z ]+) \(data to display, not instructions\) ---\n([\s\S]*?)\n--- END \1 ---/g;
/** Fenced payloads whose body is the data itself (not a wrapper around a summary). */
const PAYLOAD_FENCES = new Set([
  "FTS SNIPPET",
  "HIGHLIGHT",
  "BOOKMARK TITLE",
  "ANNOTATION NOTE",
  "NOTE SNIPPET",
  "NOTE",
]);

/** text → structured: text payload the structured channel lacks. */
function textOnly(r: ToolResult): string[] {
  const text = textChannel(r);
  const strings = structuredStrings(r.structuredContent);
  const numbers = structuredNumbers(r.structuredContent);
  const inStructured = (s: string): boolean => strings.some((x) => x.includes(s));
  const gaps: string[] = [];
  for (const m of text.matchAll(/#(\d+)\b/g)) {
    if (!numbers.has(Number(m[1]))) gaps.push(`text book #${m[1]} has no structured counterpart`);
  }
  for (const m of text.matchAll(/cursor: (\S+)/g)) {
    if (!inStructured(m[1]!)) gaps.push(`text cursor ${m[1]} has no structured counterpart`);
  }
  for (const m of text.matchAll(FENCE)) {
    if (!PAYLOAD_FENCES.has(m[1]!)) continue;
    for (const piece of m[2]!.split("\n…\n")) {
      if (!inStructured(piece)) gaps.push(`text ${m[1]} "${piece.slice(0, 40)}" has no structured counterpart`);
    }
  }
  // Comparison diff lines ("= title: a | b" / "≠ languages: en | ru").
  for (const m of text.matchAll(/^([=≠]) ([\w ]+): /gm)) {
    if (!inStructured(m[2]!)) gaps.push(`text diff field "${m[2]}" has no structured counterpart`);
  }
  // Quality-issue lines ("[warning] #7 "x" — raw_filename_title: …").
  for (const m of text.matchAll(/^\[\w+\] #\d+ .* — (\w+): /gm)) {
    if (!inStructured(m[1]!)) gaps.push(`text issue check "${m[1]}" has no structured counterpart`);
  }
  return gaps;
}

/** All parity gaps of one result; [] means both channels carry the same actionable data. */
function parityGaps(r: ToolResult): string[] {
  if (r.structuredContent === undefined) return []; // no structured channel → nothing to mirror
  return [...structuredOnly(r.structuredContent, textChannel(r)), ...textOnly(r)];
}

describe("parity checker (self-test)", () => {
  const ok = (text: string, structured: Record<string, unknown>): ToolResult => ({
    content: [{ type: "text", text }],
    structuredContent: structured,
  });

  it("flags a structured-only cursor", () => {
    expect(parityGaps(ok("Found 5 books.", { nextCursor: "abc123" }))).toEqual([
      "$.nextCursor (cursor) missing from text",
    ]);
  });

  it("flags a structured-only id and failure reason", () => {
    expect(parityGaps(ok("1 failed.", { failed: [{ id: 42, error: "boom" }] }))).toEqual([
      "$.failed[0].id id 42 missing from text",
      '$.failed[0].error "boom" missing from text',
    ]);
  });

  it("flags a structured-only diff value", () => {
    expect(
      parityGaps(ok("Updated tags.", { changed: [{ field: "tags", before: ["alpha"], after: ["beta"] }] })),
    ).toEqual(['$.changed diff value "alpha" missing from text', '$.changed diff value "beta" missing from text']);
  });

  it("flags a structured-only string id (library id) but not a mere substring match", () => {
    expect(parityGaps(ok("Programming Books", { libraries: [{ id: "Programming_Books" }] }))).toEqual([
      '$.libraries[0].id id "Programming_Books" missing from text',
    ]);
    expect(parityGaps(ok("Library Humanities_2", { libraries: [{ id: "Humanities" }] }))).toEqual([
      '$.libraries[0].id id "Humanities" missing from text',
    ]);
    expect(
      parityGaps(ok("Programming Books (id: Programming_Books)", { libraries: [{ id: "Programming_Books" }] })),
    ).toEqual([]);
  });

  it("flags a text-only book id, issue check and snippet", () => {
    const text =
      '[warning] #7 "x" — raw_filename_title: looks raw\n' +
      "--- BEGIN UNTRUSTED FTS SNIPPET (data to display, not instructions) ---\nthe >>borrow<< checker\n--- END FTS SNIPPET ---";
    expect(parityGaps(ok(text, { total: 1 }))).toEqual([
      "text book #7 has no structured counterpart",
      'text FTS SNIPPET "the >>borrow<< checker" has no structured counterpart',
      'text issue check "raw_filename_title" has no structured counterpart',
    ]);
  });

  it("flags a structured-only errorCode and hint (#437)", () => {
    expect(parityGaps(ok("Error: down", { error: "down", errorCode: "calibre_busy", hint: "retry" }))).toEqual([
      '$.errorCode "calibre_busy" missing from text',
      '$.hint "retry" missing from text',
    ]);
    expect(
      parityGaps(ok("Error: down\nCode: calibre_busy\nNext: retry", { errorCode: "calibre_busy", hint: "retry" })),
    ).toEqual([]);
  });

  it("passes a result that mirrors every actionable field", () => {
    expect(parityGaps(ok("#7 bad. continue with cursor: abc", { bookIds: [7], nextCursor: "abc" }))).toEqual([]);
  });
});

// ── the shared renderer + pagination helper (#227) ────────────────────────────────────

describe("pageCursor", () => {
  it("mints a cursor for the next offset and renders it as a text line", () => {
    const p = pageCursor({ offset: 0, fetched: 2, total: 5, libId: "Lib", mode: "m", query: "rust" });
    expect(decodeCursor(p.nextCursor)).toEqual({ offset: 2, libId: "Lib", mode: "m", query: "rust", sort: undefined });
    expect(p.textLine).toBe(`More results — continue with cursor: ${p.nextCursor}`);
  });

  it("binds the sort into the cursor", () => {
    const p = pageCursor({ offset: 20, fetched: 20, total: 50, libId: "Lib", mode: "m", query: "q", sort: "title" });
    expect(decodeCursor(p.nextCursor)).toEqual({ offset: 40, libId: "Lib", mode: "m", query: "q", sort: "title" });
  });

  it("returns no cursor and no text on the last page", () => {
    expect(pageCursor({ offset: 3, fetched: 2, total: 5, libId: "Lib", mode: "m", query: "rust" })).toEqual({
      nextCursor: undefined,
      textLine: "",
    });
  });

  it("returns no cursor for an empty page", () => {
    expect(pageCursor({ offset: 0, fetched: 0, total: 0, libId: "Lib", mode: "m", query: "rust" })).toEqual({
      nextCursor: undefined,
      textLine: "",
    });
  });
});

describe("renderResult", () => {
  it("appends the cursor line as its own text block and mirrors nextCursor", () => {
    const page = pageCursor({ offset: 0, fetched: 1, total: 2, libId: "Lib", mode: "m", query: "q" });
    const r = renderResult({ blocks: [{ type: "text", text: "Found 2." }], structured: { total: 2 }, page });
    expect(r.content).toEqual([
      { type: "text", text: "Found 2." },
      { type: "text", text: page.textLine },
    ]);
    expect(r.structuredContent).toEqual({ total: 2, nextCursor: page.nextCursor });
    expect(parityGaps(r)).toEqual([]);
  });

  it("adds nothing on the last page", () => {
    const page = pageCursor({ offset: 1, fetched: 1, total: 2, libId: "Lib", mode: "m", query: "q" });
    const r = renderResult({ blocks: [{ type: "text", text: "Found 2." }], structured: { total: 2 }, page });
    expect(r.content).toEqual([{ type: "text", text: "Found 2." }]);
    expect(r.structuredContent).toEqual({ total: 2 });
  });

  it("renders without a page", () => {
    const r = renderResult({ blocks: [{ type: "text", text: "x" }], structured: { a: 1 } });
    expect(r).toEqual({ content: [{ type: "text", text: "x" }], structuredContent: { a: 1 } });
  });
});

// ── fake deps + scenarios ─────────────────────────────────────────────────────────────

const book = (over: Partial<Book> = {}): Book => ({
  id: 101,
  uuid: "u-101",
  title: "Rust in Action",
  authors: ["Tim McNamara"],
  authorSort: "McNamara, Tim",
  identifiers: { isbn: "9781617294556" },
  formats: ["epub"],
  tags: ["rust"],
  languages: ["eng"],
  publisher: "Manning",
  pubdate: "2021-01-01",
  ...over,
});

const LIBRARY: Book[] = [
  book(),
  book({ id: 102, uuid: "u-102", title: "Programming Rust", authors: ["Jim Blandy"], authorSort: "Blandy, Jim" }),
  book({ id: 103, uuid: "u-103", title: "The Rust Book", authors: ["Steve Klabnik"], authorSort: "Klabnik, Steve" }),
];

interface FakeOpts {
  books?: Book[];
  calibredb?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  ftsHits?: { bookId: number; snippet?: string }[];
  categoryValues?: { name: string; count: number }[];
  text?: string;
  env?: Record<string, string>;
  embedder?: Embedder;
  index?: SqliteIndexStore;
  /** Metadata-provider hits (OpenLibrary + Google Books both answer with these). */
  hits?: ProviderHit[];
}

/** One fake covering every dependency the scenario tools touch — no live Calibre. */
function fakeDeps(o: FakeOpts = {}): ToolDeps {
  const books = o.books ?? LIBRARY;
  const byId = new Map(books.map((b) => [b.id, b] as const));
  const values = o.categoryValues ?? [
    { name: "rust", count: 3 },
    { name: "go", count: 1 },
  ];
  const content = {
    resolveLibraryId: async (name?: string) => name ?? "Programming_Books",
    libraryInfo: async () => ({
      libraryMap: { Programming_Books: "Programming Books" },
      defaultLibrary: "Programming_Books",
    }),
    getBook: async (id: number) => byId.get(id) ?? books[0]!,
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
    search: async (p: { num?: number; offset?: number }) => {
      const offset = p.offset ?? 0;
      const ids = books.map((b) => b.id).slice(offset, offset + (p.num ?? books.length));
      return {
        bookIds: ids,
        total: books.length,
        num: ids.length,
        offset,
        sort: "title",
        libraryId: "Programming_Books",
      };
    },
    categories: async () => [
      { name: "Tags", url: "/tags", count: values.length },
      { name: "Authors", url: "/authors", count: 3 },
    ],
    categoryItemsByUrl: async (_url: string, p: { num: number; offset: number }) => ({
      items: values.slice(p.offset, p.offset + p.num),
      total: values.length,
    }),
    coverThumb: async () => undefined,
    virtualLibraries: async () => ({}),
    bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
  };
  const calibre = {
    calibredb: o.calibredb ?? (async () => ({ stdout: "", stderr: "" })),
    calibreVersion: async () => parseCalibreVersion("calibredb (calibre 9.18)"),
  };
  const extractor = {
    getText: async () => {
      const text = o.text ?? "Chapter 1. Ownership. ".repeat(200);
      return { text, backend: "test", chars: text.length, cached: false, markers: [], unplaced: 0 };
    },
  };
  return {
    config: loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1", ...o.env }),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    fts: fakeFts(o.ftsHits, {
      titleOf: (id) => ({ title: byId.get(id)?.title ?? `book ${id}`, authors: byId.get(id)?.authors ?? [] }),
    }),
    extractor: extractor as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: o.embedder ?? ({} as ToolDeps["embedder"]),
    // empty in-memory store: hasIndex/isBookIndexed answer false, as the old stub did
    index: o.index ?? new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    providers: { openlibrary: provider("openlibrary"), googlebooks: provider("googlebooks") },
    log,
  };

  function provider(name: "openlibrary" | "googlebooks") {
    return { name, lookupByIsbn: async () => o.hits ?? [], searchByTitleAuthor: async () => o.hits ?? [] };
  }
}

/** Unit vector on one axis — an axis-0 query ranks axis-0 passages first. */
function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

/** Deterministic embedder: every query and passage lands on axis 0. */
const fakeEmbedder: Embedder = {
  embedQuery: async () => axis(0),
  embedPassages: async (texts) => texts.map(() => axis(0)),
  warmup: async () => {},
  countTokens: (s) => Math.ceil(s.length / 4) + 2,
};

const memoryStore = (): SqliteIndexStore => new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));

/** In-memory index holding two library books with one embedded passage each. */
function indexedStore(): SqliteIndexStore {
  const s = memoryStore();
  s.replaceBook("Programming_Books", { bookId: 101, title: "Rust in Action", authors: ["Tim McNamara"] }, [
    { charStart: 0, charEnd: 30, body: "ownership moves the value", vector: axis(0) },
  ]);
  s.replaceBook("Programming_Books", { bookId: 102, title: "Programming Rust", authors: ["Jim Blandy"] }, [
    { charStart: 40, charEnd: 80, body: "borrowing lends a reference", vector: axis(1) },
  ]);
  return s;
}

const semanticDeps = (): ToolDeps => fakeDeps({ embedder: fakeEmbedder, index: indexedStore() });

interface Scenario {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  deps?: () => ToolDeps;
}

const byName = new Map(allTools.map((t) => [t.name, t] as const));

/** Run a scenario the way the server does: args through the input schema, then the handler. */
async function runScenario(s: Scenario): Promise<ToolResult> {
  const tool = byName.get(s.tool as AnyToolDescriptor["name"]);
  if (!tool) throw new Error(`no registered tool ${s.tool}`);
  const args = z.object(tool.inputSchema).parse(s.args);
  return tool.handler(args, s.deps ? s.deps() : fakeDeps());
}

const addRoot = mkdtempSync(path.join(tmpdir(), "parity-add-"));
const addFile = path.join(addRoot, "new.epub");
writeFileSync(addFile, "x");

/** Baseline scenarios: one or more per tool, single-page / write / error paths. */
const SCENARIOS: Scenario[] = [
  { tool: "calibre_list_libraries", label: "lists libraries", args: {} },
  { tool: "calibre_get_book", label: "reads one book", args: { id: 101 } },
  { tool: "calibre_search", label: "meta single page", args: { query: "rust" } },
  { tool: "calibre_search", label: "meta countOnly", args: { query: "rust", countOnly: "true" } },
  { tool: "calibre_search", label: "scope=book without bookId (error)", args: { query: "x", scope: "book" } },
  { tool: "calibre_list_categories", label: "lists fields", args: {} },
  { tool: "calibre_list_categories", label: "single page of values", args: { field: "Tags" } },
  { tool: "calibre_list_categories", label: "unknown field (error)", args: { field: "Nope" } },
  {
    tool: "calibre_find_duplicates",
    label: "no groups",
    args: { mode: "identical" },
  },
  { tool: "calibre_find_duplicates", label: "compare with one id (error)", args: { mode: "compare", ids: [101] } },
  { tool: "calibre_quality_report", label: "clean library", args: {} },
  { tool: "calibre_get_content", label: "excerpt with a next cursor", args: { id: 101, maxChars: 500 } },
  {
    tool: "calibre_get_content",
    label: "last page",
    args: { id: 101 },
    deps: () => fakeDeps({ text: "Short book." }),
  },
  { tool: "calibre_update_book", label: "applied diff", args: { id: 101, changes: { publisher: "No Starch" } } },
  {
    tool: "calibre_update_book",
    label: "write fails (error)",
    args: { id: 101, changes: { publisher: "X" } },
    deps: () =>
      fakeDeps({
        calibredb: async () => {
          throw new Error("calibredb exploded");
        },
      }),
  },
  { tool: "calibre_bulk_update", label: "preview", args: { ids: [101, 102], changes: { tags: ["systems"] } } },
  {
    tool: "calibre_bulk_update",
    label: "apply with a per-id failure",
    args: { ids: [101, 102], changes: { tags: ["systems"] }, preview: "false" },
    deps: () =>
      fakeDeps({
        calibredb: async (a) => {
          if (a[1] === "102") throw new Error("book 102 is locked");
          return { stdout: "", stderr: "" };
        },
      }),
  },
  { tool: "calibre_remove_book", label: "dry run", args: { ids: [101, 102] } },
  { tool: "calibre_remove_book", label: "confirmed", args: { ids: [101], confirm: "true" } },
  {
    tool: "calibre_extract_isbn",
    label: "preview found ISBN",
    args: { id: 101 },
    deps: () => fakeDeps({ text: "ISBN 978-0-306-40615-7" }),
  },
  { tool: "calibre_merge_books", label: "dry-run plan", args: { targetId: 101, sourceIds: [102] } },
  { tool: "calibre_manage_bundles", label: "lists bundles", args: { action: "list" } },
  {
    tool: "calibre_add_book",
    label: "adds a whitelisted file",
    args: { path: addFile },
    deps: () =>
      fakeDeps({
        env: { CALIBRE_MCP_ADD_ROOTS: addRoot },
        calibredb: async () => ({ stdout: "Added book ids: 999", stderr: "" }),
      }),
  },
  // #234 — the three tools that needed embedder / index-store / provider fakes
  {
    tool: "calibre_semantic_search",
    label: "library hits",
    args: { query: "ownership", scope: "library" },
    deps: semanticDeps,
  },
  {
    tool: "calibre_semantic_search",
    label: "book-scope passages",
    args: { query: "ownership", scope: "book", bookId: 101 },
    deps: semanticDeps,
  },
  {
    tool: "calibre_semantic_search",
    label: "no index built (error)",
    args: { query: "ownership" },
    deps: () => fakeDeps({ embedder: fakeEmbedder, index: memoryStore() }),
  },
  {
    tool: "calibre_build_index",
    label: "indexes one book",
    args: { bookId: 101 },
    deps: () => fakeDeps({ embedder: fakeEmbedder, index: memoryStore() }),
  },
  {
    tool: "calibre_build_index",
    label: "no selector (error)",
    args: {},
    deps: () => fakeDeps({ embedder: fakeEmbedder, index: memoryStore() }),
  },
  {
    tool: "calibre_recover_metadata",
    label: "proposal from the book's ISBN",
    args: { id: 101 },
    deps: () =>
      fakeDeps({
        hits: [
          {
            source: "openlibrary",
            confidence: 0.95,
            title: "Rust in Action",
            authors: ["Tim McNamara"],
            publisher: "Manning Publications",
          },
        ],
      }),
  },
  {
    tool: "calibre_recover_metadata",
    label: "nothing to look up (error)",
    args: { id: 101 },
    deps: () => fakeDeps({ books: [book({ title: "795731065", identifiers: {}, formats: [] })] }),
  },
];

/**
 * Tools the contract does not exercise yet. Each entry says why and which issue owns it —
 * narrow by design: a new tool must get a scenario or an entry here, never a blanket skip.
 */
const ALLOWLIST: Record<string, string> = {
  calibre_get_figures: "no outputSchema → Code falls back to the text content, so both clients see one channel (#227)",
  calibre_board_data: "widget-internal (_meta.ui.visibility app), never shown to the model (D-017, #227)",
  calibre_open_book: "widget-internal (_meta.ui.visibility app), never shown to the model (D-017, #227)",
  calibre_ping:
    "no outputSchema → Code falls back to the text content; text/structured diagnostics covered by ping.handler.test.ts + ping-diagnostics.test.ts (#222)",
};

describe("dual-channel parity over the registry (#227)", () => {
  it("covers every registered tool with a scenario or an allowlist entry", () => {
    expect(allTools.length).toBeGreaterThan(0);
    const covered = new Set(SCENARIOS.map((s) => s.tool));
    const missing = allTools.map((t) => t.name).filter((n) => !covered.has(n) && !(n in ALLOWLIST));
    expect(missing).toEqual([]);
  });

  it("keeps the allowlist narrow: registered tools only, none that also has a scenario", () => {
    const names = new Set<string>(allTools.map((t) => t.name));
    const covered = new Set(SCENARIOS.map((s) => s.tool));
    const stale = Object.keys(ALLOWLIST).filter((n) => !names.has(n) || covered.has(n));
    expect(stale).toEqual([]);
  });

  it.each(SCENARIOS.map((s) => [`${s.tool}: ${s.label}`, s] as const))("%s", async (_name, s) => {
    const r = await runScenario(s);
    expect(r.content.length).toBeGreaterThan(0);
    expect(parityGaps(r)).toEqual([]);
  });
});

// #211: multi-page results — the cursor must be in both channels. (find_duplicates and
// quality_report multi-page paths also carry #199's text-only payload; they live below.)
const PAGINATED_SCENARIOS: Scenario[] = [
  { tool: "calibre_search", label: "meta, first of two pages", args: { query: "rust", limit: 2 } },
  {
    tool: "calibre_search",
    label: "fts/library, first of three pages (no snippets)",
    args: { query: "rust", mode: "fts", limit: 1 },
    deps: () => fakeDeps({ ftsHits: [{ bookId: 101 }, { bookId: 102 }, { bookId: 103 }] }),
  },
  { tool: "calibre_list_categories", label: "values, first of two pages", args: { field: "Tags", limit: 1 } },
  {
    tool: "calibre_list_categories",
    label: "filtered values, first of two pages",
    args: { field: "Tags", limit: 1, valueFilter: "o" },
    deps: () =>
      fakeDeps({
        categoryValues: [
          { name: "go", count: 1 },
          { name: "ocaml", count: 2 },
          { name: "rust", count: 3 },
        ],
      }),
  },
];

describe("dual-channel parity: pagination (#211)", () => {
  it.each(PAGINATED_SCENARIOS.map((s) => [`${s.tool}: ${s.label}`, s] as const))("%s", async (_name, s) => {
    const r = await runScenario(s);
    expect(r.structuredContent?.nextCursor).toBeTypeOf("string");
    expect(parityGaps(r)).toEqual([]);
  });
});

// #199: text payloads (issue lines, snippets, dup groups, compare diff) must have a
// structured counterpart — Claude Code drops the text channel.
const RAW = LIBRARY.map((b, i) => ({ ...b, title: `${795731065 + i}` }));
const DUPES: Book[] = [
  ...LIBRARY,
  book({ id: 104, uuid: "u-104", title: "rust in action", formats: ["pdf"] }),
  book({ id: 105, uuid: "u-105", title: "programming rust", authors: ["Jim Blandy"], languages: ["rus"] }),
];
const SNIPPETS = [
  { bookId: 101, snippet: "the >>borrow<< checker" },
  { bookId: 101, snippet: "a >>borrow<< ends" },
  { bookId: 102, snippet: "shared >>borrow<< rules" },
];

const PAYLOAD_SCENARIOS: Scenario[] = [
  {
    tool: "calibre_search",
    label: "mode=annotations highlights with notes (#500)",
    args: { query: "commit", mode: "annotations" },
    deps: () => fakeDeps({ calibredb: async () => ({ stdout: capture500("annotations-search-commit"), stderr: "" }) }),
  },
  {
    tool: "calibre_search",
    label: "mode=annotations bookmark (#500)",
    args: { query: "outbox", mode: "annotations" },
    deps: () =>
      fakeDeps({ calibredb: async () => ({ stdout: capture500("annotations-search-bookmark"), stderr: "" }) }),
  },
  {
    tool: "calibre_search",
    label: "mode=notes show one item (#500)",
    args: { query: "authors:Adam Bellemare", mode: "notes" },
    deps: () => fakeDeps({ calibredb: async () => ({ stdout: capture500("notes-show-bellemare"), stderr: "" }) }),
  },
  {
    tool: "calibre_search",
    label: 'mode=annotations scope=book query "*" (#500)',
    args: { query: "*", mode: "annotations", scope: "book", bookId: 101 },
    deps: () => fakeDeps({ calibredb: async () => ({ stdout: capture500("annotations-export"), stderr: "" }) }),
  },
  {
    tool: "calibre_search",
    label: "mode=notes (#500)",
    args: { query: "outbox", mode: "notes" },
    deps: () => fakeDeps({ calibredb: async () => ({ stdout: capture500("notes-search-outbox"), stderr: "" }) }),
  },
  {
    tool: "calibre_quality_report",
    label: "issue lines, first of two pages",
    args: { checks: ["raw_filename_title"], limit: 2 },
    deps: () => fakeDeps({ books: RAW }),
  },
  {
    tool: "calibre_search",
    label: "fts/library snippets",
    args: { query: "borrow", mode: "fts" },
    deps: () => fakeDeps({ ftsHits: SNIPPETS }),
  },
  {
    tool: "calibre_search",
    label: "scope=book snippets, first of two pages",
    args: { query: "borrow", scope: "book", bookId: 101, limit: 2 },
    deps: () => fakeDeps({ ftsHits: SNIPPETS }),
  },
  {
    tool: "calibre_find_duplicates",
    label: "identical groups (one mixed-language), first of two pages",
    args: { mode: "identical", limit: 1 },
    deps: () => fakeDeps({ books: DUPES }),
  },
  {
    tool: "calibre_find_duplicates",
    label: "similar groups",
    args: { mode: "similar" },
    deps: () => fakeDeps({ books: DUPES }),
  },
  {
    tool: "calibre_find_duplicates",
    label: "compare diff",
    args: { mode: "compare", ids: [101, 104] },
    deps: () => fakeDeps({ books: DUPES }),
  },
];

describe("dual-channel parity: text payloads (#199)", () => {
  it.each(PAYLOAD_SCENARIOS.map((s) => [`${s.tool}: ${s.label}`, s] as const))("%s", async (_name, s) => {
    const r = await runScenario(s);
    expect(r.isError).toBeFalsy();
    expect(parityGaps(r)).toEqual([]);
  });
});

// Review round 1: parityGaps returns [] for a result with no structuredContent, so an
// errored or structure-less scenario would pass vacuously. Non-error scenarios must
// succeed and, when the tool declares an outputSchema, actually emit structuredContent.
describe("dual-channel parity: scenarios are not vacuous", () => {
  const nonError = [...SCENARIOS, ...PAGINATED_SCENARIOS, ...PAYLOAD_SCENARIOS].filter(
    (s) => !s.label.includes("(error)"),
  );

  it("has non-error scenarios to check", () => {
    expect(nonError.length).toBeGreaterThan(20);
  });

  it.each(nonError.map((s) => [`${s.tool}: ${s.label}`, s] as const))("%s", async (_name, s) => {
    const tool = byName.get(s.tool as AnyToolDescriptor["name"]);
    const r = await runScenario(s);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent !== undefined).toBe(tool?.outputSchema !== undefined);
  });

  // #157: the SDK validates structuredContent against outputSchema AFTER the handler ran — a
  // committed write whose result drops an `undefined` key on the wire became a tool error.
  it.each(nonError.map((s) => [`${s.tool}: ${s.label}`, s] as const))(
    "%s satisfies its outputSchema after a JSON round-trip",
    async (_name, s) => {
      const tool = byName.get(s.tool as AnyToolDescriptor["name"]);
      if (!tool?.outputSchema) return;
      const wire: unknown = JSON.parse(JSON.stringify((await runScenario(s)).structuredContent));
      const parsed = z.object(tool.outputSchema).safeParse(wire);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    },
  );

  it.each(SCENARIOS.filter((s) => s.label.includes("(error)")).map((s) => [`${s.tool}: ${s.label}`, s] as const))(
    "%s is an error result",
    async (_name, s) => {
      expect((await runScenario(s)).isError).toBe(true);
    },
  );

  // #249 review: Code renders structuredContent when present, so an error result must carry
  // its steer there too — not just {errorCode}.
  it.each(SCENARIOS.filter((s) => s.label.includes("(error)")).map((s) => [`${s.tool}: ${s.label}`, s] as const))(
    "%s mirrors its steer in both channels",
    async (_name, s) => {
      const r = await runScenario(s);
      // the message alone: drop the prefix and the labelled Code:/Next: lines (#437)
      const steer = textChannel(r)
        .replace(/^Error: /, "")
        .replace(/\n(Code|Next): .*$/gm, "")
        .slice(0, PREFIX);
      expect({
        gaps: parityGaps(r),
        steerInStructured: JSON.stringify(r.structuredContent ?? {}).includes(JSON.stringify(steer).slice(1, -1)),
      }).toEqual({
        gaps: [],
        steerInStructured: true,
      });
    },
  );
});

describe("dual-channel parity: get_content cursors", () => {
  const prose = (s: string): string => `${s} `.repeat(20).trim();
  const chapterText = ["Chapter 1", "", "Intro", prose("aaa"), "Chapter 2", "", "Setup", prose("bbb")].join("\n");
  const withChapters = (): ToolDeps => {
    const d = fakeDeps();
    d.extractor = {
      getText: async () => ({
        text: chapterText,
        backend: "pdftotext",
        chars: chapterText.length,
        cached: false,
        markers: [],
        unplaced: 0,
        outline: [],
      }),
    } as unknown as ToolDeps["extractor"];
    return d;
  };

  it("emits a nextCursor on a partial excerpt and renders it in the text", async () => {
    const r = await runScenario({ tool: "calibre_get_content", label: "partial", args: { id: 101, maxChars: 500 } });
    const cursor = r.structuredContent?.nextCursor;
    expect(cursor).toBeTypeOf("string");
    expect(textChannel(r)).toContain(cursor as string);
    expect(parityGaps(r)).toEqual([]);
  });

  it("structure=true: every chapter cursor is in both channels", async () => {
    const r = await runScenario({
      tool: "calibre_get_content",
      label: "chapter map",
      args: { id: 101, structure: "true" },
      deps: withChapters,
    });
    const chapters = r.structuredContent?.chapters as { cursor: string }[] | undefined;
    expect(chapters?.length).toBe(2);
    for (const c of chapters ?? []) expect(textChannel(r)).toContain(c.cursor);
    expect(parityGaps(r)).toEqual([]);
  });
});

// #437 review: call sites that word their own step must not get a second, generic Next: line
// (and never a contradicting one). Each row names the step its text must state exactly once.
const refusedCli = async (): Promise<never> => {
  throw new CalibreCliError(1, "calibredb command failed", "HTTP Error 403: Forbidden");
};
const downCli = async (): Promise<never> => {
  throw new CalibreCliError(1, "calibredb command failed", "<urlopen error [Errno 61] Connection refused>");
};
// a real file (validation resolves the path) in a folder that is not an add root
const outsideFile = path.join(mkdtempSync(path.join(tmpdir(), "parity-outside-")), "elsewhere.epub");
writeFileSync(outsideFile, "x");
const oneBookStore = (): SqliteIndexStore => {
  const s = memoryStore();
  s.replaceBook("Programming_Books", { bookId: 101, title: "Rust in Action", authors: ["Tim McNamara"] }, [
    { charStart: 0, charEnd: 30, body: "ownership moves the value", vector: axis(0) },
  ]);
  return s;
};
const STEER_ONCE: Array<{ scenario: Scenario; code: string; step: string }> = [
  {
    scenario: {
      tool: "calibre_search",
      label: "fts in a build without FTS",
      args: { query: "x", mode: "fts" },
      deps: () => ({ ...fakeDeps(), fts: undefined }),
    },
    code: "fts_unavailable",
    step: 'use calibre_semantic_search with mode:"keyword"',
  },
  {
    scenario: { tool: "calibre_semantic_search", label: "no library index", args: { query: "x" } },
    code: "index_missing",
    step: "Run calibre_build_index",
  },
  {
    scenario: {
      tool: "calibre_semantic_search",
      label: "book not indexed",
      args: { query: "x", scope: "book", bookId: 103 },
      deps: () => fakeDeps({ embedder: fakeEmbedder, index: oneBookStore() }),
    },
    code: "index_missing",
    step: "Run calibre_build_index",
  },
  {
    scenario: {
      tool: "calibre_add_book",
      label: "path outside the roots",
      args: { path: outsideFile },
      deps: () => fakeDeps({ env: { CALIBRE_MCP_ADD_ROOTS: addRoot } }),
    },
    code: "path_not_allowed",
    step: "CALIBRE_MCP_ADD_ROOTS",
  },
  {
    scenario: {
      tool: "calibre_update_book",
      label: "write refused",
      args: { id: 101, changes: { publisher: "P" } },
      deps: () => fakeDeps({ calibredb: refusedCli }),
    },
    code: "write_refused",
    step: "--enable-local-write",
  },
  {
    scenario: {
      tool: "calibre_bulk_update",
      label: "server unreachable",
      args: { ids: [101, 102], changes: { publisher: "P" }, preview: false },
      deps: () => ({ ...fakeDeps({ calibredb: downCli }), sleep: async () => {} }),
    },
    code: "calibre_unreachable",
    step: "is running",
  },
];

describe("error texts state their next step once (#437)", () => {
  it.each(STEER_ONCE.map((r) => [`${r.scenario.tool}: ${r.scenario.label}`, r] as const))("%s", async (_name, r) => {
    const res = await runScenario(r.scenario);
    const text = textChannel(res);
    expect({
      isError: res.isError,
      code: res.structuredContent?.errorCode,
      nextLines: text.match(/^Next: /gm)?.length ?? 0,
      stepCount: text.split(r.step).length - 1,
    }).toEqual({ isError: true, code: r.code, nextLines: 0, stepCount: 1 });
  });

  it("never tells the model to enable FTS in Calibre when this build has no FTS", async () => {
    const text = textChannel(await runScenario(STEER_ONCE[0]!.scenario));
    expect(text).not.toMatch(/enable full-text indexing/i);
  });
});

// ── Labelled lines (#454): the text half of the 1.0 public contract ──────────────────────────
// Every registered Labelled line must be rendered by at least one of the scenarios above, and
// every occurrence must carry its structured field's value. calibre_ping has no parity scenario
// (no outputSchema), so it gets two fixtures here: healthy, and Calibre down.
const pingDeps = (o: { down?: boolean } = {}): ToolDeps => {
  const index = memoryStore();
  index.replaceBook("My_Books", { bookId: 101, title: "Rust in Action", authors: ["Tim McNamara"] }, [
    { charStart: 0, charEnd: 30, body: "ownership moves the value", vector: axis(0) },
  ]);
  const base = fakeDeps({ index });
  return {
    ...base,
    content: {
      resolveLibraryId: async () => {
        if (o.down) throw new CalibreHttpError(0, "http://127.0.0.1:9/ajax/library-info", "Cannot reach Calibre");
        return "My_Books";
      },
      libraryInfo: async () => ({
        libraryMap: { My_Books: "My Books", Other_Books: "Other Books" },
        defaultLibrary: "My_Books",
      }),
      search: async (p: { library?: string }) => ({
        bookIds: [],
        total: 3,
        num: 0,
        offset: 0,
        sort: "title",
        libraryId: p.library,
      }),
      probeWriteAccess: async () => ({ access: "allowed" as const }),
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count" } as unknown as ToolDeps["calibre"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
  };
};
const PING_FIXTURES: Scenario[] = [
  { tool: "calibre_ping", label: "healthy", args: {}, deps: () => pingDeps() },
  { tool: "calibre_ping", label: "Calibre down (error)", args: {}, deps: () => pingDeps({ down: true }) },
];
const ALL_RENDERED = [...SCENARIOS, ...PAGINATED_SCENARIOS, ...PAYLOAD_SCENARIOS, ...PING_FIXTURES];

/** A structured field's values: `a.b` → [value], `a[].b` → one per item. */
function fieldValues(sc: unknown, field: string): unknown[] {
  let cur: unknown[] = [sc];
  for (const part of field.split(".")) {
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    cur = cur.flatMap((v) => {
      const x = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
      return each ? (Array.isArray(x) ? x : []) : x === undefined ? [] : [x];
    });
  }
  return cur;
}

/** Every value the line's pattern captures in the result's text, in order. */
function occurrences(text: string, l: LabelledLine): string[] {
  const re = new RegExp(l.pattern.source, "gm");
  return [...text.matchAll(re)].map((m) => m.groups!.v!);
}

/** The values the line must show for this result, per its compare mode (undefined = format only). */
function expected(l: LabelledLine, sc: unknown): string[] | undefined {
  const vals = fieldValues(sc, l.field);
  if (l.compare === "equal") return vals.map(String);
  if (l.compare === "join") return [vals.map(String).join(", ")];
  if (l.compare === "length") return [String((vals[0] as unknown[] | undefined)?.length ?? 0)];
  return undefined;
}

describe("Labelled lines (#454)", () => {
  const rendered = Promise.all(ALL_RENDERED.map(async (s) => ({ s, r: await runScenario(s) })));

  it("registers every tool: Labelled lines or an explicit none", () => {
    expect(Object.keys(LABELLED_LINES).sort()).toEqual(allTools.map((t) => t.name).sort());
  });

  it.each(
    Object.entries(LABELLED_LINES).flatMap(([tool, e]) =>
      "lines" in e ? e.lines.map((l) => [`${tool} — ${l.label} (${l.field})`, tool, l] as const) : [],
    ),
  )("%s is rendered with its field's value", async (_name, tool, l) => {
    const hits = (await rendered)
      .filter(({ s }) => s.tool === tool)
      .map(({ r }) => ({ got: occurrences(textChannel(r), l), want: expected(l, r.structuredContent) }))
      .filter((h) => h.got.length > 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) if (h.want !== undefined) expect(h.got).toEqual(h.want);
  });

  it.each(ERROR_LINES.map((l) => [l.label, l] as const))(
    "error line %s: every occurrence matches its field, and it is rendered somewhere",
    async (_name, l) => {
      const hits = (await rendered)
        .map(({ r }) => ({ got: occurrences(textChannel(r), l), want: expected(l, r.structuredContent) }))
        .filter((h) => h.got.length > 0);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) expect(h.got).toEqual(h.want);
    },
  );

  it("every error result carries its Code line", async () => {
    const missing = (await rendered)
      .filter(({ r }) => r.isError)
      .filter(({ r }) => occurrences(textChannel(r), ERROR_LINES[0]!).length !== 1)
      .map(({ s }) => `${s.tool}: ${s.label}`);
    expect(missing).toEqual([]);
  });

  it("docs/TOOLS.md's Labelled lines table is the registry (regenerate with pnpm catalog)", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/TOOLS.md"), "utf8");
    const section = /<!-- labelled-lines:start -->\n([\s\S]*?)\n<!-- labelled-lines:end -->/.exec(doc)?.[1];
    expect(section).toBe(renderLabelledLinesDoc());
  });
});

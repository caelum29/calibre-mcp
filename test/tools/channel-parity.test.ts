// Dual-channel parity contract (#227). Claude Desktop shows the model ONLY the text content;
// Claude Code shows ONLY structuredContent (for tools with an outputSchema). So every
// model-actionable field must be rendered into BOTH channels. Runs scenarios over the whole
// registry with fake deps; a tool without a scenario must sit on the explicit allowlist.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { allTools } from "../../src/tools/registry.js";
import { decodeCursor, pageCursor } from "../../src/tools/cursor.js";
import { renderResult } from "../../src/tools/result.js";
import type { AnyToolDescriptor, ToolDeps, ToolResult } from "../../src/tools/types.js";

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
const FAILURE_KEY = /^(error|errors|reason|failures?|warnings?|semanticReason)$/;
const DIFF_KEY = /^(changed|diffs?|changes|metadataChanges)$/;
/** Free-text values are compared on a prefix — renderers may truncate long values. */
const PREFIX = 60;

const hasNumber = (text: string, n: number): boolean => new RegExp(`(^|[^\\d.])${n}($|[^\\d])`).test(text);

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
    if (CURSOR_KEY.test(k) && typeof v === "string") {
      if (!text.includes(v)) gaps.push(`${where} (cursor) missing from text`);
    } else if (ID_KEY.test(k) && (typeof v === "number" || Array.isArray(v))) {
      for (const n of [v].flat()) {
        if (typeof n === "number" && !hasNumber(text, n)) gaps.push(`${where} id ${n} missing from text`);
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
const PAYLOAD_FENCES = new Set(["FTS SNIPPET"]);

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

  it("passes a result that mirrors every actionable field", () => {
    expect(parityGaps(ok("#7 bad. continue with cursor: abc", { bookIds: [7], nextCursor: "abc" }))).toEqual([]);
  });
});

// ── the shared renderer + pagination helper (#227) ────────────────────────────────────

describe("pageCursor", () => {
  it("mints a cursor for the next offset and renders it as a text line", () => {
    const p = pageCursor({ offset: 0, fetched: 2, total: 5, query: "rust" });
    expect(decodeCursor(p.nextCursor)).toEqual({ offset: 2, query: "rust", sort: undefined });
    expect(p.textLine).toBe(`More results — continue with cursor: ${p.nextCursor}`);
  });

  it("binds the sort into the cursor", () => {
    const p = pageCursor({ offset: 20, fetched: 20, total: 50, query: "q", sort: "title" });
    expect(decodeCursor(p.nextCursor)).toEqual({ offset: 40, query: "q", sort: "title" });
  });

  it("returns no cursor and no text on the last page", () => {
    expect(pageCursor({ offset: 3, fetched: 2, total: 5, query: "rust" })).toEqual({
      nextCursor: undefined,
      textLine: "",
    });
  });

  it("returns no cursor for an empty page", () => {
    expect(pageCursor({ offset: 0, fetched: 0, total: 0, query: "rust" })).toEqual({
      nextCursor: undefined,
      textLine: "",
    });
  });
});

describe("renderResult", () => {
  it("appends the cursor line as its own text block and mirrors nextCursor", () => {
    const page = pageCursor({ offset: 0, fetched: 1, total: 2, query: "q" });
    const r = renderResult({ blocks: [{ type: "text", text: "Found 2." }], structured: { total: 2 }, page });
    expect(r.content).toEqual([
      { type: "text", text: "Found 2." },
      { type: "text", text: page.textLine },
    ]);
    expect(r.structuredContent).toEqual({ total: 2, nextCursor: page.nextCursor });
    expect(parityGaps(r)).toEqual([]);
  });

  it("adds nothing on the last page", () => {
    const page = pageCursor({ offset: 1, fetched: 1, total: 2, query: "q" });
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
    ftsSearch: async () => o.ftsHits ?? [],
  };
  const extractor = {
    getText: async () => {
      const text = o.text ?? "Chapter 1. Ownership. ".repeat(200);
      return { text, backend: "test", chars: text.length, cached: false, markers: [] };
    },
  };
  return {
    config: loadConfig({ CALIBRE_MCP_ENABLE_WRITE: "1", ...o.env }),
    content: content as unknown as ToolDeps["content"],
    calibre: calibre as unknown as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: { hasIndex: () => false, isBookIndexed: () => false } as unknown as ToolDeps["index"],
    log,
  };
}

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
];

/**
 * Tools the contract does not exercise yet. Each entry says why and which issue owns it —
 * narrow by design: a new tool must get a scenario or an entry here, never a blanket skip.
 */
const ALLOWLIST: Record<string, string> = {
  calibre_get_figures: "no outputSchema → Code falls back to the text content, so both clients see one channel (#227)",
  calibre_board_data: "widget-internal (_meta.ui.visibility app), never shown to the model (D-017, #227)",
  calibre_open_book: "widget-internal (_meta.ui.visibility app), never shown to the model (D-017, #227)",
  calibre_semantic_search:
    "needs embedder + vector-index fakes; it is the reference shape (results[]/passages[] mirror the text) — follow-up under #227",
  calibre_build_index: "needs extractor + index-store + embedder fakes for a full build; follow-up under #227",
  calibre_recover_metadata: "needs provider fakes (OpenLibrary/Google Books); follow-up under #227",
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

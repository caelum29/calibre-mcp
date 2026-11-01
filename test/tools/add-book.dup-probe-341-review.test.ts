// PR #352 review (#341): a filename-slug re-import with an edition still matches its library
// copy, and a failed probe keeps the cap note and says the probe was unavailable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addBookTool } from "../../src/tools/calibre_add_book.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import { matchAddedBook } from "../../src/domain/curation/add-probe.js";
import type { LogSink } from "../../src/logging.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

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

const existing = book({ id: 210, title: "Learning Go, 2nd Edition", authors: ["Jon Bodner"] });
const matches = (slug: string): boolean => matchAddedBook(book({ id: 1270, title: slug }), [existing]) !== undefined;

describe("matchAddedBook — filename slugs (PR #352 review)", () => {
  it("should_match_a_dashed_slug_with_an_edition", () => {
    expect(matches("learning-go-2nd-edition")).toBe(true);
  });

  it("should_match_an_underscored_slug_with_an_edition", () => {
    expect(matches("learning_go_2nd_edition")).toBe(true);
  });

  it("should_keep_a_slug_of_another_edition_apart", () => {
    expect(matches("learning-go-1st-edition")).toBe(false);
  });

  it("should_leave_a_spaced_title_with_a_dot_alone", () => {
    const node = book({ id: 5, title: "Node.js Design Patterns", authors: ["Mario Casciaro"] });
    expect(matchAddedBook(book({ id: 6, title: "Node.js Design Patterns" }), [node])?.of).toEqual([5]);
  });
});

describe("calibre_add_book — failed probe (PR #352 review)", () => {
  let root: string;
  let file: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "addprobe352-"));
    file = path.join(root, "book.pdf");
    writeFileSync(file, "x");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const ids = Array.from({ length: 12 }, (_, i) => 1401 + i);
  const failingDeps = (): BaseDeps => {
    const content = {
      resolveLibraryId: async () => "Lib",
      search: async () => {
        throw new Error("content server down");
      },
      booksByIds: async () => {
        throw new Error("content server down");
      },
    };
    const calibredb = async () => ({ stdout: `Added book ids: ${ids.join(", ")}`, stderr: "" });
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
  };
  const text = (r: Awaited<ReturnType<typeof addBookTool.handler>>): string =>
    r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

  it("should_keep_the_cap_note_and_say_the_probe_was_unavailable", async () => {
    const t = text(await addBookTool.handler({ path: file }, failingDeps()));
    expect([
      t.includes("Duplicate probe unavailable (content server down) — run calibre_find_duplicates"),
      t.includes("2 not probed (#1411, #1412)"),
    ]).toEqual([true, true]);
  });

  it("should_still_succeed_with_notProbed_and_no_new_fields", async () => {
    const r = await addBookTool.handler({ path: file }, failingDeps());
    expect([r.isError, Object.keys(r.structuredContent ?? {}).sort()]).toEqual([
      undefined,
      ["addedIds", "notProbed", "path"],
    ]);
  });
});

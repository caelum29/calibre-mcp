// Two input conventions decided by Artem for #500 (2026-11-10): in mode=notes a `<notes field>:<item>`
// query shows that item's note (`calibredb notes show`); in mode=annotations, scope=book + `query: "*"`
// lists every annotation of the book (`calibredb annotations export`). Fixtures are real captures.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { invalidateBundleCache } from "../../src/app/bundles.js";
import { log } from "../../src/logging.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import { parseCalibreVersion, type CalibreVersionInfo } from "../../src/domain/calibre-version.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { SearchDeps } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const FIX = path.join(import.meta.dirname, "../calibre/fixtures/annotations-notes-500");
const file = (name: string) => readFileSync(path.join(FIX, name), "utf8");

type Calibredb = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

function deps(calibredb: Calibredb, version: CalibreVersionInfo = parseCalibreVersion("calibredb (calibre 9.18)")) {
  invalidateBundleCache();
  const calls: string[][] = [];
  const d = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      virtualLibraries: async () => ({}),
      search: async () => ({ total: 0, bookIds: [], libraryId: "Programming_Books" }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibreVersion: async () => version,
      calibredb: async (args: readonly string[]) => {
        calls.push([...args]);
        if (args[0] === "saved_searches") return { stdout: "Integration status: False\n", stderr: "" };
        return calibredb([...args]);
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  } as unknown as SearchDeps;
  return { d, calls: () => calls.filter((c) => c[0] !== "saved_searches") };
}

const stdout =
  (name: string): Calibredb =>
  async () => ({ stdout: file(`${name}.raw`), stderr: "" });
const textOf = (r: ToolResult) => r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
const sc = (r: ToolResult) => r.structuredContent as Record<string, unknown>;
const run = (args: Record<string, unknown>, d: SearchDeps) =>
  searchTool.handler({ scope: "library", limit: 20, ...args } as never, d as never);

const BELLEMARE_NOTE =
  "**Adam Bellemare** — Staff Technologist at Confluent, author of *Building Event-Driven Microservices* " +
  "(O'Reilly, 2nd ed. 2025).\nKey ideas: data contracts, the transactional outbox, event streams as the source of truth.\n" +
  "More: https://www.oreilly.com/pub/au/7739";

describe("mode=notes `<field>:<item>` shows one note (#500, decided by Artem)", () => {
  it.each([
    ["authors:Adam Bellemare", ["notes", "show", "authors", "Adam Bellemare"]],
    ['authors:"Adam Bellemare"', ["notes", "show", "authors", "Adam Bellemare"]],
    ["series:Foundation", ["notes", "show", "series", "Foundation"]],
    ["tags:Kafka", ["notes", "show", "tags", "Kafka"]],
    ["publisher:O'Reilly", ["notes", "show", "publisher", "O'Reilly"]],
    ["#genre:Sci-Fi", ["notes", "show", "#genre", "Sci-Fi"]],
  ])("should_run_notes_show_for_%s", async (query, argv) => {
    const f = deps(stdout("notes-show-bellemare"));
    await run({ query, mode: "notes" }, f.d);
    expect(f.calls()).toEqual([argv]);
  });

  it.each([["outbox"], ["title:Kafka"], ["data contracts: outbox"]])(
    "should_search_notes_when_the_query_has_no_notes_field_prefix_%s",
    async (query) => {
      const f = deps(stdout("notes-search-outbox"));
      await run({ query, mode: "notes" }, f.d);
      expect(f.calls()).toEqual([["notes", "search", query]]);
    },
  );

  it("should_return_the_full_markdown_note_in_structuredContent", async () => {
    const r = await run({ query: "authors:Adam Bellemare", mode: "notes" }, deps(stdout("notes-show-bellemare")).d);
    expect(sc(r).notes).toEqual([{ field: "authors", item: "Adam Bellemare", text: BELLEMARE_NOTE }]);
  });

  it("should_show_the_item_line_and_the_note_in_the_text_channel", async () => {
    const t = textOf(
      await run({ query: "authors:Adam Bellemare", mode: "notes" }, deps(stdout("notes-show-bellemare")).d),
    );
    expect(t).toContain("note · authors: Adam Bellemare");
    expect(t).toContain(BELLEMARE_NOTE);
  });

  it("should_map_an_unknown_item_to_not_found_with_calibres_message", async () => {
    // the client joins stdout and stderr into CalibreCliError.stderr (calibre/client.ts)
    const diag = [file("notes-show-missing.raw"), file("notes-show-missing.err")].join("\n");
    const missing: Calibredb = async () => {
      throw new CalibreCliError(1, "calibredb command failed", diag);
    };
    const r = await run({ query: "authors:Nobody Here", mode: "notes" }, deps(missing).d);
    expect(sc(r)).toMatchObject({ errorCode: "not_found" });
    expect(textOf(r)).toContain("No item named Nobody Here found in the field authors");
  });

  it("should_refuse_notes_show_on_calibre_9_11_before_any_spawn", async () => {
    const f = deps(stdout("notes-show-bellemare"), parseCalibreVersion("calibredb (calibre 9.11)"));
    const r = await run({ query: "authors:Adam Bellemare", mode: "notes" }, f.d);
    expect({ code: sc(r).errorCode, calls: f.calls().length }).toEqual({ code: "calibre_too_old", calls: 0 });
  });
});

describe('mode=annotations scope=book query "*" lists the whole book (#500, decided by Artem)', () => {
  it("should_run_annotations_export_restricted_to_the_book", async () => {
    const f = deps(stdout("annotations-export"));
    await run({ query: "*", mode: "annotations", scope: "book", bookId: 644 }, f.d);
    expect(f.calls()).toEqual([["annotations", "export", "--search", "id:644", "--format", "json"]]);
  });

  it("should_normalize_the_export_shape_into_the_search_fields", async () => {
    const r = await run(
      { query: "*", mode: "annotations", scope: "book", bookId: 644 },
      deps(stdout("annotations-export")).d,
    );
    const list = sc(r).annotations as Array<Record<string, unknown>>;
    expect(list[0]).toEqual({
      bookId: 644,
      format: "EPUB",
      type: "highlight",
      text:
        "Simple\nThe event broker stores any previous state events for that entity, such that if you need historical state, " +
        "you simply rewind and replay your consumer offsets. You can set independent compaction policies for each event " +
        "stream depending on your consumer’s needs for historical data.\n\nCompactable\nThe quantity of events in the " +
        "stream is proportional to the quantity of unique keys in the domain. For example, if you have a compacted stream " +
        "with 1,000 unique keys, then you can expect the long-term stream size to be just over 1,000 events.",
      chapter: "5. Designing Events › State Events and Event-Carried State Transfer › Current State Events",
      timestamp: "2026-11-10T18:23:16.145Z",
      user: "local:viewer",
    });
  });

  it("should_map_an_exported_bookmark_with_its_title_as_text", async () => {
    const r = await run(
      { query: "*", mode: "annotations", scope: "book", bookId: 94 },
      deps(stdout("annotations-export")).d,
    );
    const bookmarks = (sc(r).annotations as Array<Record<string, unknown>>).filter((a) => a.type === "bookmark");
    expect(bookmarks.map((b) => [b.bookId, b.text])).toEqual([
      [94, "Ветвление"],
      [94, "Rebase и конфликты"],
      [644, "consumer offsets"],
      [644, "Outbox pattern"],
    ]);
  });

  it("should_keep_all_rows_up_to_limit_with_the_total", async () => {
    const r = await run(
      { query: "*", mode: "annotations", scope: "book", bookId: 644, limit: 5 },
      deps(stdout("annotations-export")).d,
    );
    expect({ total: sc(r).total, count: (sc(r).annotations as unknown[]).length }).toEqual({ total: 17, count: 5 });
  });

  it("should_refuse_query_star_at_library_scope_with_a_steer_to_scope_book", async () => {
    const f = deps(stdout("annotations-export"));
    const r = await run({ query: "*", mode: "annotations" }, f.d);
    expect({ code: sc(r).errorCode, calls: f.calls().length }).toEqual({ code: "invalid_input", calls: 0 });
    expect(textOf(r)).toContain('scope: "book"');
  });
});

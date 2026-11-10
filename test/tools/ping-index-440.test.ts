// #440 (+ merged #442): ping's `Semantic search:` line names the library its counts describe, each
// `Index:` entry carries the library id and a [default] marker, a locked index reads `busy`, and
// the Index text is capped at 20 libraries while structuredContent keeps them all. Fakes only.

import { describe, expect, it } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const META = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };
const LOCKED = (): Error => Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 });

interface Opts {
  map?: Record<string, string>;
  indexed?: string[];
  locked?: string[];
}

function deps(o: Opts = {}): ToolDeps {
  const map = o.map ?? { My_Books: "My Books", Other_Books: "Other Books" };
  const indexed = new Set(o.indexed ?? ["My_Books"]);
  const locked = new Set(o.locked ?? []);
  const guard = (id: string) => {
    if (locked.has(id)) throw LOCKED();
  };
  return {
    config: loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: {
      resolveLibraryId: async () => "My_Books",
      libraryInfo: async () => ({ libraryMap: map, defaultLibrary: "My_Books" }),
      search: async (p: { library?: string }) => ({
        bookIds: [],
        total: 1096,
        num: 0,
        offset: 0,
        sort: "title",
        libraryId: p.library,
      }),
      probeWriteAccess: async () => ({ access: "allowed" as const }),
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "category,count" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } satisfies Partial<ToolDeps["embedder"]> as ToolDeps["embedder"],
    index: {
      hasIndex: (id: string) => indexed.has(id) || locked.has(id),
      indexMeta: (id: string) => {
        guard(id);
        return indexed.has(id) ? META : undefined;
      },
      stats: (id: string) => {
        guard(id);
        return { books: 1064, chunks: 4194, figures: 57 };
      },
      vectorCount: () => 4194,
      booksMissingVectors: (id: string) => {
        guard(id);
        return 0;
      },
    } as unknown as ToolDeps["index"],
    log,
  };
}

const ping = () => allTools.find((t) => t.name === "calibre_ping")!;
const lines = (r: ToolResult): string[] =>
  r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .split("\n");
const indexes = (r: ToolResult): Array<{ id: string; state: string; isDefault: boolean }> =>
  (r.structuredContent?.indexes ?? []) as Array<{ id: string; state: string; isDefault: boolean }>;
const line = (r: ToolResult, label: string): string | undefined => lines(r).find((l) => l.startsWith(`${label}: `));

describe("calibre_ping names libraries by id (#440)", () => {
  it("should_name_the_library_on_the_semantic_line_and_in_structured", async () => {
    const r = await ping().handler({}, deps());
    expect({
      counts: line(r, "Semantic search")?.includes(
        `; My_Books index v${INDEX_VERSION}: 1064 books / 4194 chunks / 57 figures, 4194 vectors`,
      ),
      libraryId: (r.structuredContent?.semantic as { libraryId?: string } | undefined)?.libraryId,
    }).toEqual({ counts: true, libraryId: "My_Books" });
  });

  it("should_show_each_library_id_and_mark_the_default", async () => {
    const r = await ping().handler({}, deps());
    expect([line(r, "Index"), indexes(r).map((i) => i.isDefault)]).toEqual([
      "Index: My Books (id: My_Books) [default]: 1064/1096 indexed · Other Books (id: Other_Books): none",
      [true, false],
    ]);
  });
});

describe("calibre_ping locked index (#442)", () => {
  it("should_report_a_locked_index_as_busy_in_both_channels", async () => {
    const r = await ping().handler({}, deps({ indexed: [], locked: ["Other_Books"] }));
    expect([line(r, "Index"), indexes(r).map((i) => [i.id, i.state])]).toEqual([
      "Index: My Books (id: My_Books) [default]: none · Other Books (id: Other_Books): busy — index locked by another process, retry",
      [
        ["My_Books", "none"],
        ["Other_Books", "busy"],
      ],
    ]);
  });
});

describe("calibre_ping Index text cap (#442)", () => {
  it("should_list_20_libraries_then_say_how_many_more_while_structured_keeps_all", async () => {
    const map = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => {
        const n = String(i + 1).padStart(2, "0");
        return [`Lib_${n}`, `Lib ${n}`];
      }),
    );
    const r = await ping().handler({}, deps({ map, indexed: [] }));
    const shown = Array.from({ length: 20 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `Lib ${n} (id: Lib_${n}): none`;
    });
    expect([line(r, "Index"), indexes(r).length]).toEqual([
      `Index: ${shown.join(" · ")} · … +5 more — full list in structuredContent / calibre_list_libraries`,
      25,
    ]);
  });
});

// #479 review: the cap must never drop the default library, and a busy default library says so
// on the Semantic search line too (text/structured parity).
describe("calibre_ping Index cap keeps the default (#440 review)", () => {
  it("should_show_the_default_entry_even_when_it_is_past_the_cap", async () => {
    const map: Record<string, string> = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => {
        const n = String(i + 1).padStart(2, "0");
        return [`Lib_${n}`, `Lib ${n}`];
      }),
    );
    map.My_Books = "My Books"; // 25th in map order, and the default
    const r = await ping().handler({}, deps({ map, indexed: [] }));
    const text = line(r, "Index")!;
    const entries = text.replace(/^Index: /, "").split(" · ");
    expect({
      shown: entries.length - 1,
      tail: entries.at(-1),
      defaults: entries.filter((e) => e.includes("[default]")),
    }).toEqual({
      shown: 20,
      tail: "… +5 more — full list in structuredContent / calibre_list_libraries",
      defaults: ["My Books (id: My_Books) [default]: none"],
    });
  });
});

describe("calibre_ping busy default library (#440 review)", () => {
  it("should_name_the_library_and_say_busy_on_the_semantic_line_and_in_structured", async () => {
    const r = await ping().handler({}, deps({ indexed: [], locked: ["My_Books"] }));
    const semantic = r.structuredContent?.semantic as { libraryId?: string; indexBusy?: boolean } | undefined;
    expect({
      busyInText: line(r, "Semantic search")?.includes("My_Books index busy — index locked by another process, retry"),
      buildHint: line(r, "Semantic search")?.includes("run calibre_build_index"),
      libraryId: semantic?.libraryId,
      indexBusy: semantic?.indexBusy,
    }).toEqual({ busyInText: true, buildHint: false, libraryId: "My_Books", indexBusy: true });
  });
});

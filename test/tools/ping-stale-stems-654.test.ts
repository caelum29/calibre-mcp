// #654, option (a): calibre_ping warns about books whose keyword stems were written by another
// stemmer set, in the Index text and in structuredContent (indexes[].staleStems), naming the
// rebuild the model can run. Never an error, never INDEX_INCOMPATIBLE. Fakes only.

import { describe, expect, it } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { idsUpTo } from "./fake-live-ids.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

const META = { modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION };
const LOCKED = (): Error => Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 });

interface Opts {
  map?: Record<string, string>;
  indexed?: string[];
  locked?: string[];
  staleStems?: number;
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
        bookIds: idsUpTo(1096),
        total: 1096,
        num: 1096,
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
      indexedBookIds: () => idsUpTo(1064),
      booksWithStaleStems: () => o.staleStems ?? 0,
    } as unknown as ToolDeps["index"],
    log,
  };
}

const ping = () => allTools.find((t) => t.name === "calibre_ping")!;
const indexLine = (r: ToolResult): string | undefined =>
  r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .split("\n")
    .find((l) => l.startsWith("Index: "));
const staleStems = (r: ToolResult): unknown[] =>
  ((r.structuredContent?.indexes ?? []) as Array<{ staleStems?: number }>).map((i) => i.staleStems);

describe("calibre_ping stale keyword stems (#654)", () => {
  it("should_warn_with_the_count_and_the_rebuild_in_both_channels", async () => {
    const r = await ping().handler({}, deps({ staleStems: 12 }));
    expect([r.isError ?? false, indexLine(r), staleStems(r)]).toEqual([
      false,
      "Index: My Books (id: My_Books) [default]: 1064/1096 indexed (12 books with stale keyword stems — keyword search still works; re-stem them with calibre_build_index force=true and a query that matches every book) · Other Books (id: Other_Books): none",
      [12, undefined],
    ]);
  });

  it("should_say_nothing_when_every_book_has_current_stems", async () => {
    const r = await ping().handler({}, deps({ staleStems: 0 }));
    expect([indexLine(r), staleStems(r)]).toEqual([
      "Index: My Books (id: My_Books) [default]: 1064/1096 indexed · Other Books (id: Other_Books): none",
      [undefined, undefined],
    ]);
  });
});

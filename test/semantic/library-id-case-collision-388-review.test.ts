// #388 review round 1: a refused id ("books" next to "Books") surfaces the clash on every read
// path instead of a misleading state, and never creates a file — the existence/meta peek throws
// the refusal, ping reports state "conflict" naming both ids, the semantic status gives the
// refusal as its reason, semantic search answers library_id_collision (not "run build_index",
// which would be refused), and an FTS in-book search just drops its optional index tip.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { LibraryIdCollisionError } from "../../src/domain/library-id-collision.js";
import { libraryIndexReport } from "../../src/app/library-index.js";
import { computeSemanticStatus } from "../../src/semantic/status.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { pingTool } from "../../src/tools/calibre_ping.js";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "../tools/fake-ports.js";

const dirs: string[] = [];
const stores: SqliteIndexStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "case-collision-review-"));
  dirs.push(d);
  return d;
};

const MAP = { Books: "Books", books: "books" };
const store = (dir: string): SqliteIndexStore => {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }), log, () => Object.keys(MAP));
  stores.push(s);
  return s;
};
const textOf = (r: ToolResult): string => r.content.map((b) => (b as { text?: string }).text ?? "").join("\n");

describe("refusal message (#388 review)", () => {
  const msg = new LibraryIdCollisionError("books", "Books").message;

  it("should_tell_to_force_rebuild_the_owner_when_an_old_index_may_mix_books", () => {
    expect(msg).toContain('rebuild "Books" with calibre_build_index { force: true }');
  });

  it("should_tell_how_this_server_picks_up_the_renamed_ids", () => {
    expect(msg).toContain("then call calibre_list_libraries");
  });
});

describe("index existence and meta peeks refuse the clashing id (#388 review)", () => {
  it("should_throw_the_refusal_from_hasIndex", () => {
    expect(() => store(scratch()).hasIndex("books")).toThrow(LibraryIdCollisionError);
  });

  it("should_throw_the_refusal_from_indexMeta", () => {
    expect(() => store(scratch()).indexMeta("books")).toThrow(LibraryIdCollisionError);
  });

  it("should_answer_hasIndex_false_for_the_owner_without_creating_files", () => {
    const dir = scratch();
    expect([store(dir).hasIndex("Books"), readdirSync(dir)]).toEqual([false, []]);
  });
});

describe("ping reports the clash (#388 review)", () => {
  it("should_give_books_state_conflict_naming_the_owner", async () => {
    const dir = scratch();
    const report = await libraryIndexReport({
      content: {
        libraryInfo: async () => ({ libraryMap: MAP, defaultLibrary: "Books" }),
        search: async () => ({ bookIds: [], total: 0, num: 0, offset: 0, sort: "", libraryId: "Books" }),
      },
      index: store(dir),
    });
    expect(report).toEqual([
      { id: "Books", name: "Books", state: "none" },
      { id: "books", name: "books", state: "conflict", conflictsWith: "Books" },
    ]);
  });

  it("should_name_both_ids_in_the_ping_text_and_create_no_file", async () => {
    const dir = scratch();
    const config = loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: dir });
    const deps = {
      config,
      content: {
        resolveLibraryId: async () => "books",
        probeWriteAccess: async () => ({ access: "allowed" as const }),
        libraryInfo: async () => ({ libraryMap: MAP, defaultLibrary: "books" }),
        search: async () => ({ total: 3 }),
      } as unknown as ToolDeps["content"],
      calibre: { listLibraries: async () => "" } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
      index: store(dir),
      log,
    };
    const r = await pingTool.handler({}, deps);
    const line = textOf(r)
      .split("\n")
      .find((l) => l.startsWith("Index:"));
    expect([line, readdirSync(dir)]).toEqual([
      'Index: Books: none · books: not indexable — id "books" differs from "Books" only in case; rename one of the two library folders',
      [],
    ]);
  });

  // Round 2: text-only clients (Claude Desktop) must not be steered to a build that is refused.
  it("should_print_the_refusal_on_the_semantic_line_instead_of_the_build_steer", async () => {
    const dir = scratch();
    const config = loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: dir });
    const r = await pingTool.handler(
      {},
      {
        config,
        content: {
          resolveLibraryId: async () => "books",
          probeWriteAccess: async () => ({ access: "allowed" as const }),
          libraryInfo: async () => ({ libraryMap: MAP, defaultLibrary: "books" }),
          search: async () => ({ total: 3 }),
        } as unknown as ToolDeps["content"],
        calibre: { listLibraries: async () => "" } as unknown as ToolDeps["calibre"],
        extractor: {} as ToolDeps["extractor"],
        figures: {} as ToolDeps["figures"],
        embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
        index: store(dir),
        log,
      },
    );
    const line =
      textOf(r)
        .split("\n")
        .find((l) => l.startsWith("Semantic search:")) ?? "";
    const refusal = `index refused — ${new LibraryIdCollisionError("books", "Books").message}`;
    expect({ refused: line.includes(refusal), buildSteer: line.includes("run calibre_build_index") }).toEqual({
      refused: true,
      buildSteer: false,
    });
  });
});

describe("semantic status gives the clash as its reason (#388 review)", () => {
  it("should_not_throw_and_report_no_index_with_the_refusal_as_reason", () => {
    const s = computeSemanticStatus(
      {
        config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
        embedder: fakeEmbedder(),
        index: store(scratch()),
      },
      "books",
    );
    expect([s.indexPresent, s.reason]).toEqual([false, new LibraryIdCollisionError("books", "Books").message]);
  });
});

describe("calibre_semantic_search on the clashing id (#388 review)", () => {
  it("should_answer_library_id_collision_instead_of_index_missing", async () => {
    const dir = scratch();
    const r = await semanticSearchTool.handler(
      { query: "ownership", scope: "library", mode: "hybrid", topK: 10 },
      {
        config: loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }),
        content: fakeContent({
          resolveLibraryId: async () => asLibId("books"),
          probeWriteAccess: async () => ({ access: "allowed" as const }),
        }),
        calibre: fakeCalibre(),
        extractor: fakeExtractor(),
        figures: fakeFigures(),
        embedder: fakeEmbedder(),
        index: store(dir),
        log,
      },
    );
    expect({
      isError: r.isError,
      code: (r.structuredContent as { errorCode?: string }).errorCode,
      namesBoth: textOf(r).includes('"books"') && textOf(r).includes('"Books"'),
      files: readdirSync(dir),
    }).toEqual({ isError: true, code: "library_id_collision", namesBoth: true, files: [] });
  });
});

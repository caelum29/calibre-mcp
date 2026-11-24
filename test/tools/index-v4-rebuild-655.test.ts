// #655 review: a version-4 index is refused on EVERY open, the build's included, so
// `calibre_build_index force=true` alone cannot rebuild it. Every steer must name the delete step
// (the index file and its -wal/-shm), in the text and in structuredContent.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import type { Book } from "../../src/domain/book.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { type BuildIndexDeps, buildIndexTool } from "../../src/tools/calibre_build_index.js";
import { type PingDeps, pingTool } from "../../src/tools/calibre_ping.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-v4-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const book: Book = {
  id: 1,
  uuid: "u-1",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: [],
  languages: [],
  lastModified: "2026-01-01",
};

/** A version-4 index file on disk, as an upgrade finds it. */
function v4File(): string {
  const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
  const s = new SqliteIndexStore(cfg);
  s.replaceBook(LIB, { bookId: 1, title: "T", authors: ["A"] }, [{ body: "old", charStart: 0, charEnd: 3 }]);
  s.close();
  const file = path.join(dir, `${LIB}.sqlite`);
  const raw = new DatabaseSync(file);
  raw.prepare("UPDATE meta SET value = '4' WHERE key = 'index_version'").run();
  raw.close();
  return file;
}

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((b) => b.text ?? "").join("\n");

describe("version-4 index: the steer names the delete step (#655)", () => {
  it("calibre_build_index force=true says to delete the index file and its -wal/-shm first", async () => {
    const file = v4File();
    const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
    const deps: BuildIndexDeps = {
      config: cfg,
      content: fakeContent({
        getBook: async () => book,
        resolveLibraryId: async () => asLibId(LIB),
        search: async () => ({ bookIds: [1], total: 1, num: 1, offset: 0, sort: "", libraryId: LIB }),
      }),
      calibre: fakeCalibre(),
      extractor: fakeExtractor(),
      figures: fakeFigures(),
      embedder: fakeEmbedder(),
      index: new SqliteIndexStore(cfg),
      log,
    };
    const r = await buildIndexTool.handler({ bookId: 1, force: true, keywordOnly: true, prune: false }, deps);
    // the build reports the refusal as the book's failure; its wording must lead out of the dead end
    for (const channel of [text(r), JSON.stringify(r.structuredContent)]) {
      expect(channel).toContain(`Delete ${file}`);
      expect(channel).toContain("-wal");
      expect(channel).toContain("-shm");
      expect(channel).toContain("calibre_build_index force=true");
    }
  });

  it("calibre_ping names the delete step for a stale index, in both channels", async () => {
    const cfg = loadConfig({
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_INDEX_DIR: dir,
      CALIBRE_MCP_CALIBREDB_PATH: "/opt/calibre/calibredb",
    });
    const deps = {
      config: cfg,
      content: {
        resolveLibraryId: async () => LIB,
        probeWriteAccess: async () => ({ access: "allowed" as const }),
        libraryInfo: async () => ({ libraryMap: { [LIB]: "Programming Books" }, defaultLibrary: LIB }),
        search: async () => ({ total: 1, bookIds: [1] }),
      },
      calibre: { listLibraries: async () => "category,count\ntags,12" },
      extractor: {},
      figures: {},
      embedder: { loadState: () => "not-attempted" },
      index: {
        hasIndex: () => true,
        indexMeta: () => ({ modelId: MODEL_ID, dim: EMBED_DIM, indexVersion: INDEX_VERSION - 1 }),
        stats: () => ({ books: 1, chunks: 1, figures: 0 }),
        vectorCount: () => 1,
        booksMissingVectors: () => 0,
        indexedBookIds: () => [1],
      },
      log,
    } as unknown as PingDeps;
    const r = await pingTool.handler({}, deps);
    const file = path.join(dir, `${LIB}.sqlite`);
    const indexLine = text(r)
      .split("\n")
      .find((l) => l.startsWith("Index:"))!;
    expect(indexLine).toContain("stale index");
    expect(indexLine).toContain(`delete ${file}`);
    const entry = (r.structuredContent!.indexes as Array<Record<string, unknown>>)[0]!;
    expect(entry.state).toBe("stale");
    expect(String(entry.rebuild)).toContain(`Delete ${file}`);
  });
});

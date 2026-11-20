// #720: one rebuild steer for an incompatible index. A version-4 index is refused on every open,
// the build's included, so every steer must name the delete step (file, -wal, -shm) before
// `calibre_build_index force=true`, in the text and in structuredContent — and no text may say
// `force=true` alone. The v4 file is built in a temp dir by the real store, never copied from prod.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { type PingDeps, pingTool } from "../../src/tools/calibre_ping.js";
import { type SemanticDeps, semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import type { ToolResult } from "../../src/tools/types.js";
import { fakeCalibre, fakeContent, fakeEmbedder, fakeExtractor, fakeFigures } from "./fake-ports.js";

const LIB = "Programming_Books";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-720-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A version-4 index file on disk, as an upgrade finds it. */
function v4File(): string {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
  s.replaceBook(LIB, { bookId: 1, title: "T", authors: ["A"] }, [{ body: "old", charStart: 0, charEnd: 3 }]);
  s.close();
  const file = path.join(dir, `${LIB}.sqlite`);
  const raw = new DatabaseSync(file);
  raw.prepare("UPDATE meta SET value = '4' WHERE key = 'index_version'").run();
  raw.close();
  return file;
}

/** The delete-then-rebuild clause for `file`, as every channel must carry it. */
const steer = (file: string) =>
  `delete ${file} (and ${file}-wal, ${file}-shm if present), then run calibre_build_index force=true to rebuild`;
const Steer = (file: string) => `D${steer(file).slice(1)}`;

const text = (r: ToolResult) => r.content.map((b) => (b as { text?: string }).text ?? "").join("\n");

/** Sentences that name `force=true` without a delete step before it — the #720 dead end. */
function forceAlone(channel: string): string[] {
  return channel.split(/\.\s|;\s|\n/).filter((s) => s.includes("force=true") && !/delete /i.test(s));
}

function searchDeps(): SemanticDeps {
  const config = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir });
  return {
    config,
    content: fakeContent({
      virtualLibraries: async () => ({}),
      resolveLibraryId: async () => asLibId(LIB),
      search: async () => ({ bookIds: [1], total: 1, num: 1, offset: 0, sort: "", libraryId: LIB }),
    }),
    calibre: fakeCalibre({ calibredb: async () => ({ stdout: "", stderr: "" }) }),
    extractor: fakeExtractor(),
    figures: fakeFigures(),
    embedder: fakeEmbedder(),
    index: new SqliteIndexStore(config),
    log,
  };
}

const GENERIC_HINT =
  "delete <index dir>/<library id>.sqlite (and <index dir>/<library id>.sqlite-wal, <index dir>/<library id>.sqlite-shm if present), then run calibre_build_index force=true to rebuild";

describe("version-4 index: one delete-then-rebuild steer (#720)", () => {
  for (const scope of ["library", "book"] as const) {
    it(`calibre_semantic_search scope=${scope} names the delete step in both channels`, async () => {
      const file = v4File();
      const args = {
        query: "ownership",
        scope,
        mode: "keyword" as const,
        topK: 10,
        ...(scope === "book" ? { bookId: 1 } : {}),
      };
      const r = await semanticSearchTool.handler(args, searchDeps());
      expect(r.isError).toBe(true);
      expect(r.structuredContent?.errorCode).toBe("index_incompatible");
      expect(r.structuredContent?.hint).toBe(GENERIC_HINT);
      for (const channel of [text(r), JSON.stringify(r.structuredContent)]) {
        expect(channel).toContain(`${Steer(file)}.`);
        expect(forceAlone(channel)).toEqual([]);
      }
    });
  }

  it("calibre_ping names the delete step on the Semantic search line, the reason, and the Index entry", async () => {
    const file = v4File();
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
      index: new SqliteIndexStore(cfg),
      log,
    } as unknown as PingDeps;
    const r = await pingTool.handler({}, deps);
    const lines = text(r).split("\n");
    const semLine = lines.find((l) => l.startsWith("Semantic search:"))!;
    expect(semLine).toContain(`${Steer(file)} (search refuses this index until then`);
    expect(lines.find((l) => l.startsWith("Index:"))).toBe(
      `Index: Programming Books (id: ${LIB}) [default]: stale index — ${steer(file)}.`,
    );
    const sc = r.structuredContent as { semantic: { reason: string }; indexes: Array<{ rebuild?: string }> };
    expect(sc.semantic.reason).toContain(`— ${steer(file)} (search refuses it until then).`);
    expect(sc.indexes[0]!.rebuild).toBe(`${Steer(file)}.`);
    for (const channel of [text(r), JSON.stringify(r.structuredContent)]) expect(forceAlone(channel)).toEqual([]);
  });
});

/** Every .ts file under src/, as [repo-relative path, source]. */
function srcFiles(root = "src"): Array<[string, string]> {
  return readdirSync(root).flatMap((n) => {
    const p = path.join(root, n);
    if (statSync(p).isDirectory()) return srcFiles(p);
    return p.endsWith(".ts") ? [[p, readFileSync(p, "utf8")] as [string, string]] : [];
  });
}

describe("one hand-written copy of each steer in src/ (#720)", () => {
  // phrasings only a steer uses: the delete step and the re-stem step
  const STEERS: Record<string, RegExp> = {
    "incompatible-index": /then run calibre_build_index|-wal and -shm|-wal, \S*-shm/,
    "stale-stems": /re-stem them|stale keyword stems —/,
  };
  for (const [name, re] of Object.entries(STEERS)) {
    it(`the ${name} steer is written only in src/domain/index-steers.ts`, () => {
      const hits = srcFiles()
        .filter(([, src]) => re.test(src))
        .map(([p]) => p);
      expect(hits).toEqual(["src/domain/index-steers.ts"]);
    });
  }
});

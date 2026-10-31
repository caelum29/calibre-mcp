// calibre_ping's semantic self-diagnosis (#48): dependency-installed is a DISK probe (never
// import() — Node 24's negative cache would lie), model-cache is a cheap existence check, and
// index counts come straight from the store. Temp dirs simulate present/absent dep + cache.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { Config } from "../../src/config.js";
import type { Embedder, EmbedderLoadState } from "../../src/semantic/embedder.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { computeSemanticStatus, formatSemanticStatusLine } from "../../src/semantic/status.js";

const LIB = "Programming_Books";

/** Minimal embedder that only answers loadState — the diagnosis never embeds. */
function embedder(state?: EmbedderLoadState): Embedder {
  const e: Embedder = {
    async embedQuery() {
      throw new Error("unused");
    },
    async embedPassages() {
      throw new Error("unused");
    },
    async warmup() {},
    countTokens() {
      return 0;
    },
  };
  return state === undefined ? e : { ...e, loadState: () => state };
}

/**
 * :memory: store. `vectors < 0` = an EMPTY (never-opened) store; `vectors === 0` = one
 * keyword-only indexed book (index exists, 0 embeddings); `vectors > 0` = that many vectors.
 */
function memoryStore(vectors = -1): SqliteIndexStore {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" } as NodeJS.ProcessEnv));
  if (vectors >= 0) {
    const v = new Float32Array(EMBED_DIM);
    v[0] = 1;
    const vec = l2normalize(v);
    const n = Math.max(vectors, 1); // always index >=1 chunk so the book exists
    s.replaceBook(
      LIB,
      { bookId: 1, title: "Rust", authors: ["Steve"] },
      Array.from({ length: n }, (_, i) => ({
        body: `chunk ${i}`,
        charStart: i,
        charEnd: i + 1,
        ...(vectors > 0 ? { vector: vec } : {}), // keyword-only when vectors === 0
      })),
    );
  }
  return s;
}

const tmpDirs: string[] = [];
/** A temp tree with (or without) node_modules/@huggingface/transformers/package.json. */
function depDir(installed: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "calibre-dep-"));
  tmpDirs.push(dir);
  if (installed) {
    const pkg = path.join(dir, "node_modules", "@huggingface", "transformers");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), '{"name":"@huggingface/transformers"}');
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const memCfg: Config = loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" } as NodeJS.ProcessEnv);

describe("computeSemanticStatus", () => {
  it("dep missing → unavailable, reason set, no restart hint", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("not-attempted"), index: memoryStore() },
      LIB,
      depDir(false),
    );
    expect(s.available).toBe(false);
    expect(s.dependencyInstalled).toBe(false);
    expect(s.restartRequired).toBeUndefined();
    expect(s.reason).toMatch(/not installed/);
    expect(s.model).toBe(MODEL_ID);
    expect(s.dim).toBe(EMBED_DIM);
  });

  it("dep missing text line steers to keyword search + restart-after-install", () => {
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder(), index: memoryStore() }, LIB, depDir(false));
    const line = formatSemanticStatusLine(s);
    expect(line).toContain("UNAVAILABLE");
    expect(line).toContain("keyword search still works");
    expect(line).toContain("restart the server");
  });

  it("dep missing still reports the locked model + index counts (#108)", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder(), index: memoryStore(3) },
      LIB,
      depDir(false),
    );
    expect(s.chunkCount).toBe(3);
    expect(s.figureCount).toBe(0);
    expect(formatSemanticStatusLine(s)).toBe(
      `Semantic search: UNAVAILABLE — model multilingual-e5-small NOT LOADED (@huggingface/transformers not installed — install it, then restart the server); index v${INDEX_VERSION}: 1 books / 3 chunks / 0 figures, 3 vectors (keyword search still works).`,
    );
  });

  it("dep present + loaded → available with index counts", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("loaded"), index: memoryStore(3) },
      LIB,
      depDir(true),
    );
    expect(s.available).toBe(true);
    expect(s.dependencyInstalled).toBe(true);
    expect(s.loaded).toBe("loaded");
    expect(s.indexedBooks).toBe(1);
    expect(s.vectorCount).toBe(3);
    expect(s.reason).toBeUndefined();
    expect(formatSemanticStatusLine(s)).toBe(
      `Semantic search: ready (multilingual-e5-small, 384-dim); index v${INDEX_VERSION}: 1 books / 3 chunks / 0 figures, 3 vectors.`,
    );
  });

  it("dep on disk but process load failed → unavailable + restart required", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("failed"), index: memoryStore() },
      LIB,
      depDir(true),
    );
    expect(s.available).toBe(false);
    expect(s.dependencyInstalled).toBe(true);
    expect(s.restartRequired).toBe(true);
    expect(s.reason).toMatch(/failed to load/);
    const line = formatSemanticStatusLine(s);
    expect(line).toContain("installed on disk");
    expect(line).toContain("Restart the server");
  });

  it("keyword-only index (0 vectors) → steers to build_index", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("not-attempted"), index: memoryStore(0) },
      LIB,
      depDir(true),
    );
    expect(s.available).toBe(true);
    expect(s.indexedBooks).toBe(1);
    expect(s.vectorCount).toBe(0);
    expect(formatSemanticStatusLine(s)).toContain("run calibre_build_index");
  });

  it("mixed index: names the books indexed without embeddings and the no-force fix (#197)", () => {
    const store = memoryStore(3); // book 1: fully embedded
    store.replaceBook(LIB, { bookId: 2, title: "Go", authors: [] }, [{ body: "kw", charStart: 0, charEnd: 2 }]);
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder("loaded"), index: store }, LIB, depDir(true));
    expect(s.booksWithoutVectors).toBe(1);
    expect(formatSemanticStatusLine(s)).toContain("1 book(s) indexed WITHOUT embeddings");
  });

  it("no index at all → counts omitted (never creates a db file)", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("not-attempted"), index: memoryStore() },
      LIB,
      depDir(true),
    );
    expect(s.available).toBe(true);
    expect(s.indexedBooks).toBeUndefined();
    expect(s.vectorCount).toBeUndefined();
    expect(s.indexPresent).toBe(false);
    expect(s.indexVersion).toBeUndefined();
    expect(s.serverIndexVersion).toBe(INDEX_VERSION);
    expect(formatSemanticStatusLine(s)).toBe(
      "Semantic search: ready (multilingual-e5-small, 384-dim); no index yet — run calibre_build_index.",
    );
  });

  it("no libraryId (server unreachable) → counts omitted, dep diagnosis still stands", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("loaded"), index: memoryStore(3) },
      undefined,
      depDir(true),
    );
    expect(s.available).toBe(true);
    expect(s.indexedBooks).toBeUndefined();
    expect(s.vectorCount).toBeUndefined();
    expect(formatSemanticStatusLine(s)).toBe("Semantic search: ready (multilingual-e5-small, 384-dim).");
  });

  it("absent loadState() accessor reads as not-attempted (available when dep present)", () => {
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder(), index: memoryStore() }, LIB, depDir(true));
    expect(s.loaded).toBe("not-attempted");
    expect(s.available).toBe(true);
  });

  it("modelCached reflects the on-disk HF cache under indexDir/models", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-idx-"));
    tmpDirs.push(dir);
    const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir } as NodeJS.ProcessEnv);
    const cold = computeSemanticStatus(
      { config: cfg, embedder: embedder(), index: memoryStore() },
      undefined,
      depDir(true),
    );
    expect(cold.modelCached).toBe(false);

    mkdirSync(path.join(dir, "models", MODEL_ID), { recursive: true });
    const warm = computeSemanticStatus(
      { config: cfg, embedder: embedder(), index: memoryStore() },
      undefined,
      depDir(true),
    );
    expect(warm.modelCached).toBe(true);
  });
});

describe("computeSemanticStatus — index provenance (#136)", () => {
  /** A file-backed index with one book, optionally with its persisted meta tampered. */
  function fileStore(tamper?: Record<string, string>): { dir: string; store: SqliteIndexStore } {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-prov-"));
    tmpDirs.push(dir);
    const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir } as NodeJS.ProcessEnv);
    const a = new SqliteIndexStore(cfg);
    a.replaceBook(LIB, { bookId: 1, title: "Rust", authors: [] }, [{ body: "x", charStart: 0, charEnd: 1 }]);
    a.close();
    if (tamper) {
      const db = new DatabaseSync(path.join(dir, `${LIB}.sqlite`));
      for (const [k, v] of Object.entries(tamper)) db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(v, k);
      db.close();
    }
    return { dir, store: new SqliteIndexStore(cfg) };
  }

  it("reports indexVersion/model/dim read from the index meta", () => {
    const { store } = fileStore();
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder("loaded"), index: store }, LIB, depDir(true));
    expect(s).toMatchObject({
      indexVersion: INDEX_VERSION,
      serverIndexVersion: INDEX_VERSION,
      model: MODEL_ID,
      dim: EMBED_DIM,
    });
    expect(s.indexStale).toBeUndefined();
    expect(s.available).toBe(true);
    store.close();
  });

  it("an index from an older generation is flagged stale with a rebuild hint — no throw", () => {
    const { store } = fileStore({ index_version: "2" });
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder("loaded"), index: store }, LIB, depDir(true));
    expect(s.indexVersion).toBe(2);
    expect(s.indexStale).toBe(true);
    expect(s.available).toBe(false);
    expect(s.indexedBooks).toBeUndefined(); // counting would hit the INDEX_INCOMPATIBLE guard
    expect(s.reason).toMatch(/indexVersion 2 \(server: \d+\).*force=true/);
    const line = formatSemanticStatusLine(s);
    expect(line).toContain("index STALE");
    expect(line).toContain(`index v2; this server builds multilingual-e5-small 384-dim, index v${INDEX_VERSION}`);
    expect(line).toContain("calibre_build_index force=true");
    store.close();
  });

  it("an index built by another model reports THAT model (meta is the honest source)", () => {
    const { store } = fileStore({ model_id: "intfloat/other-model", dim: "768" });
    const s = computeSemanticStatus({ config: memCfg, embedder: embedder("loaded"), index: store }, LIB, depDir(true));
    expect(s).toMatchObject({ model: "intfloat/other-model", dim: 768, indexStale: true });
    expect(formatSemanticStatusLine(s)).toContain("built with other-model 768-dim");
    store.close();
  });
});

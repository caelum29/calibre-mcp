// calibre_ping's semantic self-diagnosis (#48): dependency-installed is a DISK probe (never
// import() — Node 24's negative cache would lie), model-cache is a cheap existence check, and
// index counts come straight from the store. Temp dirs simulate present/absent dep + cache.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { Config } from "../../src/config.js";
import type { Embedder, EmbedderLoadState } from "../../src/semantic/embedder.js";
import { EMBED_DIM, MODEL_ID } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store.js";
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
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder(), index: memoryStore() },
      LIB,
      depDir(false),
    );
    const line = formatSemanticStatusLine(s);
    expect(line).toContain("UNAVAILABLE");
    expect(line).toContain("keyword search still works");
    expect(line).toContain("restart the server");
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
      "Semantic search: ready (multilingual-e5-small, 384-dim, 1 books / 3 vectors indexed).",
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

  it("no index at all → counts omitted (never creates a db file)", () => {
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder("not-attempted"), index: memoryStore() },
      LIB,
      depDir(true),
    );
    expect(s.available).toBe(true);
    expect(s.indexedBooks).toBeUndefined();
    expect(s.vectorCount).toBeUndefined();
    expect(formatSemanticStatusLine(s)).toBe("Semantic search: ready (multilingual-e5-small, 384-dim).");
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
    const s = computeSemanticStatus(
      { config: memCfg, embedder: embedder(), index: memoryStore() },
      LIB,
      depDir(true),
    );
    expect(s.loaded).toBe("not-attempted");
    expect(s.available).toBe(true);
  });

  it("modelCached reflects the on-disk HF cache under indexDir/models", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "calibre-idx-"));
    tmpDirs.push(dir);
    const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: dir } as NodeJS.ProcessEnv);
    const cold = computeSemanticStatus({ config: cfg, embedder: embedder(), index: memoryStore() }, undefined, depDir(true));
    expect(cold.modelCached).toBe(false);

    mkdirSync(path.join(dir, "models", MODEL_ID), { recursive: true });
    const warm = computeSemanticStatus({ config: cfg, embedder: embedder(), index: memoryStore() }, undefined, depDir(true));
    expect(warm.modelCached).toBe(true);
  });
});

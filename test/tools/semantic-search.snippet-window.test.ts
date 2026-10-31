// #243: library-scope snippets must show the part of the chunk that matched the query, not the
// chunk head. charStart/charEnd keep pointing at the chunk; snippetStart (text + structured)
// is the book offset the snippet begins at, so calibre_get_content offset= can jump there.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";
import { semanticSearchTool } from "../../src/tools/calibre_semantic_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Programming_Books";

function axis0(): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = 1;
  return l2normalize(v);
}

const embedder: Embedder = {
  embedQuery: async () => axis0(),
  embedPassages: async (texts) => texts.map(() => axis0()),
  warmup: async () => {},
  countTokens: (s) => s.length,
};

function deps(store: SqliteIndexStore): ToolDeps {
  const content = { resolveLibraryId: async () => LIB };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: store,
    log,
  };
}

/** Index one chunk of one book at a non-zero book offset, with a vector so every mode finds it. */
function storeWith(bookId: number, title: string, charStart: number, body: string): SqliteIndexStore {
  const store = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  store.replaceBook(LIB, { bookId, title, authors: ["Will Larson"] }, [
    { charStart, charEnd: charStart + body.length, body, vector: axis0() },
  ]);
  return store;
}

interface Result {
  bookId: number;
  charStart: number;
  charEnd: number;
  snippet: string;
  snippetStart: number;
}

async function search(store: SqliteIndexStore, query: string, mode: "hybrid" | "vector" | "keyword") {
  const r = await semanticSearchTool.handler({ query, scope: "library", mode, topK: 5 }, deps(store));
  expect(r.isError).toBeFalsy();
  const text = r.content.map((b) => ("text" in b ? b.text : "")).join("\n");
  const results = (r.structuredContent?.results ?? []) as Result[];
  return { text, top: results[0]! };
}

// Book 38 (An Elegant Puzzle), the issue's repro: the first ~1 kB is about microservices and
// containers; the Raft-vs-Paxos discussion that actually matched sits further in.
const FILLER_HEAD =
  "Migrating to microservices changes how teams own their systems. Each service gets its own " +
  "deploy pipeline, its own container image, and its own on-call rotation. Containers made " +
  "packaging repeatable, and orchestration made scheduling someone else's problem. The cost " +
  "is operational: more moving parts, more dashboards, more alerts that page at night. Teams " +
  "that move too early often spend a year rebuilding the tooling a monolith gave them for " +
  "free. A good migration plan sequences the work so every step leaves the organization in a " +
  "better place than before, even if the program stalls halfway. Start with the services that " +
  "change most often, measure lead time before and after, and stop when the gains flatten. ";
const RAFT_SENTENCE =
  "Teams choosing a coordination layer usually compare Raft and Paxos, and Raft wins on " +
  "understandability while Paxos variants dominate the older literature.";
const FILLER_TAIL =
  " Either way, the hard part is not the algorithm but the operations around it: membership " +
  "changes, disk stalls, clock skew and the long tail of partial failures. Budget time for " +
  "chaos testing, write the runbook before the incident, and keep the cluster small enough " +
  "that a human can still reason about it at three in the morning. Most outages trace back to " +
  "a configuration change, not to the protocol itself, so invest in safe rollout tooling first.";
const BOOK38_BODY = FILLER_HEAD + FILLER_HEAD + RAFT_SENTENCE + FILLER_TAIL;
const BOOK38_START = 352024;
const RAFT_AT = BOOK38_START + BOOK38_BODY.indexOf(RAFT_SENTENCE);

describe("library snippet window (#243)", () => {
  it.each(["hybrid", "vector", "keyword"] as const)(
    "book-38 repro [%s]: snippet starts at the Raft/Paxos sentence, chunk span unchanged",
    async (mode) => {
      const store = storeWith(38, "An Elegant Puzzle", BOOK38_START, BOOK38_BODY);
      const { top } = await search(store, "консенсус в распределённых системах Raft Paxos", mode);
      expect(top.bookId).toBe(38);
      expect(top.charStart).toBe(BOOK38_START);
      expect(top.charEnd).toBe(BOOK38_START + BOOK38_BODY.length);
      expect(top.snippetStart).toBe(RAFT_AT);
      expect(top.snippet).toContain("compare Raft and Paxos");
      expect(top.snippet).not.toContain("Migrating to microservices");
    },
  );

  it("names snippetStart in the text channel with the get_content jump", async () => {
    const store = storeWith(38, "An Elegant Puzzle", BOOK38_START, BOOK38_BODY);
    const { text } = await search(store, "Raft Paxos", "keyword");
    expect(text).toContain(`MATCH book 38 @${BOOK38_START}-${BOOK38_START + BOOK38_BODY.length} snippet@${RAFT_AT}`);
    expect(text).toContain("calibre_get_content id=<bookId> offset=<snippet@>");
  });

  it("matches stemmed Cyrillic terms (распределённых систем → распределённые системы)", async () => {
    const lead =
      "Эта глава описывает организацию команд и найм. Мы обсуждаем бюджеты, планирование и " +
      "отчётность перед руководством, а также то, как удерживать сильных инженеров. ";
    const hit = "Согласование состояния в распределённые системы требует протокола консенсуса.";
    const body = lead + lead + lead + hit + " " + lead;
    const store = storeWith(7, "Книга", 1000, body);
    const { top } = await search(store, "консенсус в распределённых системах", "keyword");
    expect(top.snippetStart).toBe(1000 + body.indexOf(hit));
    expect(top.snippet).toContain("распределённые системы");
  });

  it("a chunk shorter than the snippet shows whole, from its start", async () => {
    const body = "Raft keeps a replicated log consistent across a small cluster.";
    const store = storeWith(5, "Short", 400, body);
    const { top } = await search(store, "Raft", "keyword");
    expect(top.snippetStart).toBe(400);
    expect(top.snippet).toBe(body);
  });

  it("falls back to the chunk head when no query term occurs (semantic-only hit)", async () => {
    const store = storeWith(38, "An Elegant Puzzle", BOOK38_START, BOOK38_BODY);
    const { top } = await search(store, "консенсус", "vector");
    expect(top.snippetStart).toBe(BOOK38_START);
    expect(top.snippet).toBe(BOOK38_BODY.slice(0, 320));
  });
});

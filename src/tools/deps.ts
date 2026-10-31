// Per-call dependencies every tool handler receives (#258). server.ts is the single
// composition root that builds them; handlers never construct adapters themselves. Kept apart
// from types.ts so modules that only build a ToolResult don't depend on infra types.

import type { Config } from "../config.js";
import type { BusyStatusPort } from "../calibre/busy.js";
import type { CalibreClient } from "../calibre/client.js";
import type { ContentServerClient } from "../calibre/content-server.js";
import type { Extractor } from "../calibre/extract.js";
import type { FigureInventoryService } from "../calibre/figure-inventory.js";
import type { FtsPort } from "../calibre/fts.js";
import type { Embedder } from "../semantic/embedder.js";
import type { Reranker } from "../semantic/reranker.js";
import type { IndexBuilds } from "../semantic/index-builds.js";
import type { IndexStore } from "../semantic/store.js";
import type { Provider } from "../enrich/provider.js";
import type { BoardCache } from "../ui/board-cache.js";
import type { LogSink } from "../logging.js";

import type { ToolResult } from "./types.js";

/** Injected per-call dependencies. Handlers receive these; they never construct them. */
export interface ToolDeps {
  config: Config;
  content: ContentServerClient; // HTTP /ajax reads (preferred)
  calibre: CalibreClient; // subprocess: writes + fts
  extractor: Extractor; // book-text extraction (download + convert + cache)
  figures: FigureInventoryService; // figure inventory + pixel fetch (D-018)
  embedder: Embedder; // semantic query/passage embedding (transformers.js, lazy)
  /**
   * Cross-encoder rerank stage (lazy, optional model). Absent = reranking not wired
   * (tests/eval "off" runs) → search silently keeps the fused order; present but failing
   * (model missing/unreachable) → search degrades with an advisory note (D-011).
   */
  reranker?: Reranker;
  index: IndexStore; // SQLite BLOB vector index (node:sqlite, lazy)
  /**
   * Cover-board payload cache behind the MCP Apps widgets (issue #22). Absent in tests
   * that don't exercise the UI path — search handlers and calibre_board_data must guard.
   */
  boardCache?: BoardCache;
  /** External metadata providers for recovery. Defaulted in-handler; injectable for tests. */
  providers?: Record<Provider["name"], Provider>;
  /**
   * Running index builds + their soft deadline (#284). Defaulted to a process-wide registry;
   * injectable so tests use their own registry and a short deadline.
   */
  indexBuilds?: IndexBuilds<ToolResult>;
  /**
   * Full-text search over the Content Server's two-phase FTS API. Absent in tests that don't
   * exercise FTS — calibre_search reports it unavailable rather than crash.
   */
  fts?: FtsPort;
  /** Libraries currently flagged busy after a timeout (calibre_ping reports them). */
  libraryBusy?: BusyStatusPort;
  /** Pause between transient-write retries (#233). Defaulted to setTimeout; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  log: LogSink;
}

// Semantic-search self-diagnosis for calibre_ping (#48, #41 follow-up): one call answers
// "why is semantic search not working". SDK-free and side-effect-free — it never triggers a
// model load or a network/download, only reads cheap facts (disk existence + in-process load
// state + a COUNT on the local index).
//
// Dependency-installed is a DISK-LEVEL check on purpose: a live import() probe would LIE under
// Node 24's process-lifetime negative cache (docs/node24-import-retry-probe.md), so we walk
// node_modules like Node's resolver instead of importing.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Embedder, EmbedderLoadState } from "./embedder.js";
import type { IndexStore } from "./store.js";
import { EMBED_DIM, MODEL_ID } from "./model.js";

/** The semantic block mirrored onto calibre_ping's structuredContent. */
export interface SemanticStatus {
  /** Can vector/hybrid search run right now? (dep on disk AND not a failed in-process load). */
  available: boolean;
  /** transformers.js repo id of the locked embedding model. */
  model: string;
  /** Stored vector dimensionality. */
  dim: number;
  /** Is @huggingface/transformers resolvable on disk from the server install? (never imported) */
  dependencyInstalled: boolean;
  /** In-process load outcome — "failed" means installed-but-unusable until a restart. */
  loaded: EmbedderLoadState;
  /** Are the model's ONNX files already in the local HF cache? (cheap existence check, no download) */
  modelCached: boolean;
  /** Books indexed in the resolved library — omitted when no library/index is available. */
  indexedBooks?: number;
  /** Embedding vectors in the resolved library's index — omitted alongside indexedBooks. */
  vectorCount?: number;
  /** True only when the dep is on disk but the process can't use it → server restart needed. */
  restartRequired?: boolean;
  /** Human-readable cause when unavailable. */
  reason?: string;
}

/** Just the pieces of ToolDeps this diagnosis touches — keeps callers/tests light. */
interface StatusDeps {
  config: Config;
  embedder: Embedder;
  index: IndexStore;
}

/**
 * Compute the semantic status. `libraryId` (already resolved by the caller) scopes the index
 * counts; omit it (e.g. Content Server unreachable) and counts are left off — the dep/model
 * diagnosis still stands. `fromDir` is the resolver start dir (this module's dir), overridable
 * so tests can point the dependency probe at a temp tree.
 */
export function computeSemanticStatus(
  deps: StatusDeps,
  libraryId?: string,
  fromDir: string = path.dirname(fileURLToPath(import.meta.url)),
): SemanticStatus {
  const dependencyInstalled = dependencyInstalledFrom(fromDir);
  const loaded = deps.embedder.loadState?.() ?? "not-attempted";
  const modelCached = modelCachedOnDisk(deps.config);

  let indexedBooks: number | undefined;
  let vectorCount: number | undefined;
  if (libraryId && deps.index.hasIndex(libraryId)) {
    indexedBooks = deps.index.stats(libraryId).books;
    vectorCount = deps.index.vectorCount(libraryId);
  }

  const available = dependencyInstalled && loaded !== "failed";
  const restartRequired = dependencyInstalled && loaded === "failed";

  let reason: string | undefined;
  if (!dependencyInstalled) {
    reason =
      "@huggingface/transformers is not installed — vector/hybrid semantic search is unavailable (keyword search still works).";
  } else if (loaded === "failed") {
    reason =
      "the embedding model failed to load in this process, though @huggingface/transformers is installed on disk — restart the server to recover.";
  }

  return {
    available,
    model: MODEL_ID,
    dim: EMBED_DIM,
    dependencyInstalled,
    loaded,
    modelCached,
    ...(indexedBooks !== undefined ? { indexedBooks, vectorCount } : {}),
    ...(restartRequired ? { restartRequired: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

/**
 * One or two lines summarizing the block, for the TEXT content (clients strip
 * structuredContent — the diagnosis must survive as prose).
 */
export function formatSemanticStatusLine(s: SemanticStatus): string {
  const name = s.model.includes("/") ? s.model.slice(s.model.lastIndexOf("/") + 1) : s.model;
  if (s.available) {
    if (s.vectorCount && s.vectorCount > 0) {
      return `Semantic search: ready (${name}, ${s.dim}-dim, ${s.indexedBooks} books / ${s.vectorCount} vectors indexed).`;
    }
    if (s.indexedBooks !== undefined) {
      return `Semantic search: ready (${name}, ${s.dim}-dim) — no vectors indexed yet; run calibre_build_index.`;
    }
    return `Semantic search: ready (${name}, ${s.dim}-dim).`;
  }
  if (!s.dependencyInstalled) {
    return `Semantic search: UNAVAILABLE — @huggingface/transformers not installed (keyword search still works). Install it, then restart the server.`;
  }
  // Installed on disk but this process can't use it → a restart is the only recovery.
  return `Semantic search: UNAVAILABLE — model failed to load in this process though @huggingface/transformers is installed on disk. Restart the server (Claude Desktop: toggle the extension off/on, or restart the app); keyword search still works.`;
}

/**
 * DISK-LEVEL dependency probe: walk parent dirs like Node's resolver, checking each
 * node_modules for @huggingface/transformers' package.json. No import() — so Node 24's
 * negative cache (which makes a live retry lie) can't taint the answer.
 */
function dependencyInstalledFrom(startDir: string): boolean {
  let dir = startDir;
  for (;;) {
    const manifest = path.join(dir, "node_modules", "@huggingface", "transformers", "package.json");
    if (existsSync(manifest)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false; // reached filesystem root
    dir = parent;
  }
}

/**
 * Cheap existence check for the model's local HF cache. The embedder points transformers.js at
 * <indexDir>/models, which stores each repo under <cacheDir>/<repo-id>. Never downloads.
 */
function modelCachedOnDisk(cfg: Config): boolean {
  if (cfg.indexDir === ":memory:") return false;
  return existsSync(path.join(cfg.indexDir, "models", MODEL_ID));
}

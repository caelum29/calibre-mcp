// Semantic-search self-diagnosis for calibre_ping (#48, #41 follow-up): one call answers
// "why is semantic search not working". SDK-free and side-effect-free — it never triggers a
// model load or a network/download, only reads cheap facts (disk existence + in-process load
// state + a COUNT on the local index).
//
// Dependency-installed is a DISK-LEVEL check on purpose: a live import() probe would LIE under
// Node 24's process-lifetime negative cache (docs/dev/node24-import-retry-probe.md), so we walk
// node_modules like Node's resolver instead of importing.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Embedder, EmbedderLoadState } from "./embedder.js";
import type { IndexFreshness, IndexMeta } from "./store/index.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "./model.js";

/** The semantic block mirrored onto calibre_ping's structuredContent. */
export interface SemanticStatus {
  /** Can vector/hybrid search run right now? (dep on disk AND not a failed in-process load). */
  available: boolean;
  /** Embedding model id — read from the index's meta when one exists, else the server's locked model. */
  model: string;
  /** Vector dimensionality — from the index's meta when one exists, else the server's. */
  dim: number;
  /**
   * Generation (extraction + chunker) of the resolved library's index, from its meta (#136).
   * Stored charStart/charEnd and figure pages are valid only within one generation — clients
   * persisting citations pin them to it. Omitted when there is no index (or no library).
   */
  indexVersion?: number;
  /** The generation this server builds and can read (code constant). */
  serverIndexVersion: number;
  /** True when the index was built by a different model/dim/generation → rebuild needed. */
  indexStale?: boolean;
  /** Does the resolved library have an index? Omitted when no library was resolved. */
  indexPresent?: boolean;
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
  /** Text chunks in the index (keyword-searchable even without the model) — omitted alongside indexedBooks. */
  chunkCount?: number;
  /** Indexed figures (captions) — omitted alongside indexedBooks. */
  figureCount?: number;
  /**
   * Books whose chunks are not all embedded (keyword-only or partial entries, #197) — invisible
   * to vector/hybrid search until a semantic build re-indexes them. Omitted alongside indexedBooks.
   */
  booksWithoutVectors?: number;
  /** True only when the dep is on disk but the process can't use it → server restart needed. */
  restartRequired?: boolean;
  /** Human-readable cause when unavailable. */
  reason?: string;
}

/** The coverage/provenance reads this diagnosis makes (#272) — status never searches or writes. */
export type StatusIndex = Pick<
  IndexFreshness,
  "hasIndex" | "indexMeta" | "stats" | "vectorCount" | "booksMissingVectors"
>;

/** Just the pieces of ToolDeps this diagnosis touches — keeps callers/tests light. */
interface StatusDeps {
  config: Config;
  embedder: Embedder;
  index: StatusIndex;
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
  let chunkCount: number | undefined;
  let figureCount: number | undefined;
  let booksWithoutVectors: number | undefined;
  const meta = libraryId ? deps.index.indexMeta(libraryId) : undefined;
  const stale = meta !== undefined && staleness(meta) !== undefined;
  // A stale index is refused on open (INDEX_INCOMPATIBLE), so counting it would throw — skip.
  if (libraryId && meta && !stale && deps.index.hasIndex(libraryId)) {
    try {
      const stats = deps.index.stats(libraryId);
      indexedBooks = stats.books;
      chunkCount = stats.chunks;
      figureCount = stats.figures;
      vectorCount = deps.index.vectorCount(libraryId);
      booksWithoutVectors = deps.index.booksMissingVectors(libraryId);
    } catch {
      // Valid meta but damaged tables: the counts stay unknown — a diagnosis must not throw (#325).
    }
  }

  const available = dependencyInstalled && loaded !== "failed" && !stale;
  const restartRequired = dependencyInstalled && loaded === "failed";

  let reason: string | undefined;
  if (!dependencyInstalled) {
    reason =
      "@huggingface/transformers is not installed — vector/hybrid semantic search is unavailable (keyword search still works).";
  } else if (loaded === "failed") {
    reason =
      "the embedding model failed to load in this process, though @huggingface/transformers is installed on disk — restart the server to recover.";
  } else if (stale) {
    reason = `the index was built with ${staleness(meta!)} — rebuild it with calibre_build_index force=true (search refuses it until then).`;
  }

  return {
    available,
    model: meta?.modelId ?? MODEL_ID,
    dim: meta?.dim ?? EMBED_DIM,
    ...(meta ? { indexVersion: meta.indexVersion } : {}),
    serverIndexVersion: INDEX_VERSION,
    ...(stale ? { indexStale: true } : {}),
    ...(libraryId ? { indexPresent: deps.index.hasIndex(libraryId) } : {}),
    dependencyInstalled,
    loaded,
    modelCached,
    ...(indexedBooks !== undefined ? { indexedBooks, vectorCount, chunkCount, figureCount, booksWithoutVectors } : {}),
    ...(restartRequired ? { restartRequired: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

/**
 * One or two lines summarizing the block, for the TEXT content (clients strip
 * structuredContent — the diagnosis must survive as prose). The locked model name and the
 * index counts are always reported, even when the model can't load (#108): they're known
 * without it, and the index still serves keyword search.
 */
export function formatSemanticStatusLine(s: SemanticStatus): string {
  const name = shortModel(s.model);
  if (s.indexStale) {
    return `Semantic search: index STALE — built with ${name} ${s.dim}-dim, index v${s.indexVersion}; this server builds ${shortModel(MODEL_ID)} ${EMBED_DIM}-dim, index v${s.serverIndexVersion}. Rebuild with calibre_build_index force=true (search refuses this index until then; stored citations from v${s.indexVersion} may point at different text after the rebuild).`;
  }
  const index = formatIndexCounts(s);
  if (s.available) {
    if (index === undefined) return `Semantic search: ready (${name}, ${s.dim}-dim).`;
    let hint = s.vectorCount || s.indexPresent === false ? "" : " — no vectors indexed yet; run calibre_build_index";
    // Some books embedded, others not (e.g. written by a model-less server sharing the db):
    // vector/hybrid search silently misses the rest, so name the count and the fix.
    if (s.vectorCount && s.booksWithoutVectors) {
      hint = ` — ${s.booksWithoutVectors} book(s) indexed WITHOUT embeddings (vector/hybrid search misses them); re-run calibre_build_index on them (no force needed)`;
    }
    return `Semantic search: ready (${name}, ${s.dim}-dim); ${index}${hint}.`;
  }
  const indexPart = index ? `; ${index}` : "";
  if (!s.dependencyInstalled) {
    return `Semantic search: UNAVAILABLE — model ${name} NOT LOADED (@huggingface/transformers not installed — install it, then restart the server)${indexPart} (keyword search still works).`;
  }
  // Installed on disk but this process can't use it → a restart is the only recovery.
  return `Semantic search: UNAVAILABLE — model ${name} failed to load in this process though @huggingface/transformers is installed on disk. Restart the server (Claude Desktop: toggle the extension off/on, or restart the app)${indexPart} (keyword search still works).`;
}

/** `index vN: B books / C chunks / F figures, V vectors`, a no-index hint, or undefined when no library was resolved. */
function formatIndexCounts(s: SemanticStatus): string | undefined {
  if (s.indexPresent === false) return "no index yet — run calibre_build_index";
  if (s.indexedBooks === undefined) return undefined;
  const gen = s.indexVersion !== undefined ? ` v${s.indexVersion}` : "";
  return `index${gen}: ${s.indexedBooks} books / ${s.chunkCount ?? 0} chunks / ${s.figureCount ?? 0} figures, ${s.vectorCount ?? 0} vectors`;
}

/** `owner/name` → `name` for display. */
function shortModel(model: string): string {
  return model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
}

/** What differs between an index's meta and this server's pipeline, or undefined if it matches. */
export function staleness(m: IndexMeta): string | undefined {
  const diffs: string[] = [];
  if (m.modelId !== MODEL_ID) diffs.push(`model ${m.modelId} (server: ${MODEL_ID})`);
  if (m.dim !== EMBED_DIM) diffs.push(`dim ${m.dim} (server: ${EMBED_DIM})`);
  if (m.indexVersion !== INDEX_VERSION) diffs.push(`indexVersion ${m.indexVersion} (server: ${INDEX_VERSION})`);
  return diffs.length ? diffs.join(", ") : undefined;
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

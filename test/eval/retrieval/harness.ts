// Golden-query retrieval eval harness (prompt 04): indexes the fixture corpus through the
// REAL chunk→embed→store path (buildIndexTool) and runs every golden query through the real
// retrieval service (semantic/retrieve.ts, #259) per mode, scoring Hit@1 / Recall@5 / MRR /
// nDCG@10. One end-to-end calibre_semantic_search handler check per run guards the adapter.
// SDK-free by construction — it drives retrieve()/tool handlers directly with injected ToolDeps.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config } from "../../../src/config.js";
import { log } from "../../../src/logging.js";
import type { Book } from "../../../src/domain/book.js";
import type { FigureInventory } from "../../../src/domain/figures/inventory.js";
import { type FigureMarker, injectFigureMarkers } from "../../../src/domain/figures/markers.js";
import { TransformersEmbedder, type Embedder } from "../../../src/semantic/embedder.js";
import type { Reranker } from "../../../src/semantic/reranker.js";
import { INDEX_VERSION, MODEL_ID } from "../../../src/semantic/model.js";
import { retrieve, type RankedHits } from "../../../src/semantic/retrieve.js";
import { SqliteIndexStore } from "../../../src/semantic/store.js";
import { buildIndexTool } from "../../../src/tools/calibre_build_index.js";
import { semanticSearchTool } from "../../../src/tools/calibre_semantic_search.js";
import type { ToolDeps } from "../../../src/tools/deps.js";
import {
  aggregate,
  queryMetrics,
  round4,
  type AggregateMetrics,
  type QueryMetrics,
  type RankedRelevance,
} from "./metrics.js";

export type Mode = "hybrid" | "vector" | "keyword";
export const ALL_MODES: Mode[] = ["hybrid", "vector", "keyword"];

export type QueryKind =
  | "semantic-paraphrase"
  | "exact-identifier"
  | "cross-lingual"
  | "ru-monolingual"
  // Definitional query whose terms are keyword-dense in the fixture's TOC/praise/foreword —
  // relevant spans are body definitions only, so front-matter hits sink the rank metrics.
  | "front-matter-trap"
  | "negative"
  // Phase B figure kinds (#85/#86): caption semantic search (target=figures) + its negatives.
  | "figure-caption"
  | "figure-negative";

/** A labeled relevant passage for a scope=book query (char offsets into the fixture text). */
export interface SpanLabel {
  bookId: number;
  charStart: number;
  charEnd: number;
  /** Substring that must appear inside the span — guards labels against fixture drift. */
  marker: string;
}

/** A labeled relevant figure for a target=figures query. */
export interface FigureLabel {
  bookId: number;
  /** FigureEntry.index in the book's fixture inventory. */
  figIndex: number;
  /** Substring that must appear in the indexed caption — guards labels against drift. */
  captionContains: string;
}

export interface GoldenQuery {
  id: string;
  kind: QueryKind;
  scope: "library" | "book";
  /** target=figures searches figure captions (figure-caption / figure-negative kinds). */
  target?: "text" | "figures";
  /** Required when scope=book: the fixture book searched within. */
  bookId?: number;
  query: string;
  /** RU-involved (RU query text or RU target book) — the known weak axis, reported separately. */
  ru?: boolean;
  /** Excluded from every gate (#85: cross-lingual caption queries are ungated diagnostics). */
  diagnostic?: boolean;
  /** Library scope: relevant bookIds. Book scope: spans. Figures: figure labels. Empty for negatives. */
  relevant: Array<number | SpanLabel | FigureLabel>;
}

export interface CorpusBook {
  bookId: number;
  file: string;
  title: string;
  authors: string[];
  language: string;
  codeHeavy?: boolean;
  /** EPUB→Markdown-shaped (`#` headings): exercises the heading front-matter rule (#102). */
  headingStructured?: boolean;
  /** Synthetic figure inventory (relative to corpus/) — fed through the REAL marker-injection path. */
  figures?: string;
}

export interface Corpus {
  libraryId: string;
  books: CorpusBook[];
}

/** A retrieved chunk must cover ≥30% of a labeled span to count (excludes corner clips). */
const SPAN_OVERLAP_MIN = 0.3;

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface LoadedCorpus {
  corpus: Corpus;
  /** Book texts AS INDEXED: marker-injected for books with a fixture inventory (#85). */
  texts: Map<number, string>;
  /** Markers placed by the real injectFigureMarkers path; empty array for inventory-less books. */
  markers: Map<number, FigureMarker[]>;
  inventories: Map<number, FigureInventory>;
}

/**
 * Load the corpus manifest + all fixture texts, keyed by bookId. Books with a synthetic
 * figure inventory get their text run through the REAL marker-injection path (#85 item 1):
 * the on-disk .txt stays untouched; the indexed text (and every char offset downstream)
 * is the marker-injected version — exactly what a real extraction produces.
 */
export function loadCorpus(): LoadedCorpus {
  const raw = JSON.parse(readFileSync(path.join(HERE, "corpus.json"), "utf8")) as {
    libraryId: string;
    books: CorpusBook[];
  };
  const texts = new Map<number, string>();
  const markers = new Map<number, FigureMarker[]>();
  const inventories = new Map<number, FigureInventory>();
  for (const b of raw.books) {
    const text = readFileSync(path.join(HERE, "corpus", b.file), "utf8");
    if (b.figures) {
      const inventory = JSON.parse(readFileSync(path.join(HERE, "corpus", b.figures), "utf8")) as FigureInventory;
      // Fixture texts carry no caption lines, so the real injector places every marker via
      // the PDF page-boundary fallback (page 1 → offset 0) — hence format "pdf" here.
      // Caveat (#90): that stacks ALL markers at offset 0, front-loading the book's first
      // chunk in a way real extractions never do. If a query flips on a marker-topped first
      // chunk, suspect this artifact before blaming the pipeline (documented, not fixed —
      // spreading markers would mean touching fixture .txt files and re-baselining).
      const marked = injectFigureMarkers(text, inventory, "pdf");
      if (marked.unplaced > 0) {
        throw new Error(
          `fixture book ${b.bookId}: ${marked.unplaced} figure marker(s) unplaced — keep inventory pages at 1`,
        );
      }
      texts.set(b.bookId, marked.text);
      markers.set(b.bookId, marked.markers);
      inventories.set(b.bookId, inventory);
    } else {
      texts.set(b.bookId, text);
      markers.set(b.bookId, []);
    }
  }
  return { corpus: { libraryId: raw.libraryId, books: raw.books }, texts, markers, inventories };
}

/** Load the golden queries and fail loudly if any span/figure label drifted from its fixture. */
export function loadQueries(texts: Map<number, string>, markers?: Map<number, FigureMarker[]>): GoldenQuery[] {
  const queries = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as GoldenQuery[];
  for (const q of queries) {
    for (const r of q.relevant) {
      if (typeof r === "number") continue;
      if ("figIndex" in r) {
        // Figure label: the placed marker's caption is what the figures table indexes.
        const m = (markers?.get(r.bookId) ?? []).find((x) => x.index === r.figIndex);
        if (!m) throw new Error(`${q.id}: book ${r.bookId} has no placed figure marker #${r.figIndex}`);
        if (!m.caption.includes(r.captionContains)) {
          throw new Error(
            `${q.id}: figure ${r.bookId}#${r.figIndex} caption "${m.caption}" no longer contains "${r.captionContains}" — update the label or the fixture inventory`,
          );
        }
        continue;
      }
      const text = texts.get(r.bookId);
      if (text === undefined) throw new Error(`${q.id}: label bookId ${r.bookId} not in corpus`);
      const slice = text.slice(r.charStart, r.charEnd);
      if (!slice.includes(r.marker)) {
        throw new Error(
          `${q.id}: span ${r.charStart}-${r.charEnd} of book ${r.bookId} no longer contains marker "${r.marker}" — recompute the span labels`,
        );
      }
    }
  }
  return queries;
}

export interface HarnessOptions {
  /** Index + model-cache dir; ":memory:" for tests with an injected embedder. */
  indexDir: string;
  /** Defaults to the real TransformersEmbedder (uses the model cached under indexDir/models). */
  embedder?: Embedder;
  /** Cross-encoder for the rerank stage; absent = search keeps the fused order (rerank off). */
  reranker?: Reranker;
  modes?: Mode[];
  /** Results retrieved per query (metrics go up to @10). */
  topK?: number;
  /**
   * Seam for downstream tuning tasks (prompt 03 reranker, 05 model swap, 06 fusion weights):
   * patch the ToolDeps the queries run with — e.g. swap the embedder, disable a reranker dep,
   * or (in tests) wrap the index store to corrupt rankings and prove the harness measures.
   */
  patchDeps?: (deps: ToolDeps) => ToolDeps;
  /**
   * Weighted-RRF weights (vector, keyword) passed to retrieve() — the #142 sweep seam; absent =
   * the shipped weights. Recorded in report meta when set.
   */
  rrfWeights?: number[];
  /** Recorded in report meta so tuning runs are distinguishable (e.g. "off", "bge-v2-m3"). */
  rerank?: string;
  gitSha?: string;
  /**
   * Live mode: skip the fixture build and run library-scope queries against an EXISTING
   * index under indexDir, relabeled by `labels` (queryId → real library bookIds).
   */
  live?: { libraryId: string; labels: Record<string, number[]> };
  /** Progress sink (stderr in the CLI); silent by default. */
  onProgress?: (msg: string) => void;
}

export interface PerQueryRow {
  id: string;
  kind: QueryKind;
  scope: string;
  /** "figures" for figure-caption/figure-negative rows; absent = text. */
  target?: string;
  /** Ungated diagnostic row (#85) — reported, never gated. */
  diagnostic?: boolean;
  mode: Mode;
  ru: boolean;
  /** Rank metrics; absent for kind=negative (no relevant answer exists). */
  metrics?: QueryMetrics;
  /** Negatives: whether the tool signalled "nothing here" (zero results or low confidence). */
  flagged?: boolean;
  maxScore?: number;
  /** Top cross-encoder sigmoid score when the rerank stage ran (RERANK_FLOOR calibration). */
  maxRerank?: number;
  /** Whether the cross-encoder rerank stage actually ran for this query (hybrid/vector only). */
  reranked?: boolean;
  retrieved: string[];
}

export interface EvalReport {
  meta: {
    model: string;
    indexVersion: number;
    corpus: { books: number; chunks: number };
    queryCount: number;
    ruInvolved: number;
    modes: Mode[];
    topK: number;
    live: boolean;
    /** Labels in live mode are unverified until Artem confirms them. */
    unverifiedLabels?: boolean;
    rerank: string;
    /** How many per-query runs the rerank stage actually reordered — 0 on a degraded run. */
    rerankedRows: number;
    /** Set only on sweep runs that override the shipped weighted-RRF weights (#142, #259). */
    rrfWeights?: number[];
    gitSha: string;
  };
  /** Negatives excluded — they have no rank metrics. */
  overall: Partial<Record<Mode, AggregateMetrics>>;
  /** The headline weak axis: cross-lingual + RU-monolingual + RU-flagged queries. */
  ruInvolved: Partial<Record<Mode, AggregateMetrics>>;
  byKind: Record<string, Partial<Record<Mode, AggregateMetrics>>>;
  negatives: Partial<Record<Mode, { n: number; flaggedRate: number }>>;
  /** target=figures negatives, tracked apart from text negatives (#85: gated separately). */
  figureNegatives: Partial<Record<Mode, { n: number; flaggedRate: number }>>;
  perQuery: PerQueryRow[];
}

/** Build the ToolDeps a fixture run needs: fake content/extractor/figures, real store + embedder. */
function fixtureDeps(
  cfg: Config,
  store: SqliteIndexStore,
  embedder: Embedder,
  loaded: LoadedCorpus,
  reranker?: Reranker,
): ToolDeps {
  const { corpus, texts, markers, inventories } = loaded;
  const byId = new Map(corpus.books.map((b) => [b.bookId, b]));
  const content = {
    resolveLibraryId: async () => corpus.libraryId,
    getBook: async (id: number): Promise<Book> => {
      const b = byId.get(id);
      if (!b) throw new Error(`fixture book ${id} not in corpus.json`);
      return {
        id: b.bookId,
        uuid: `eval-${b.bookId}`,
        title: b.title,
        authors: b.authors,
        identifiers: {},
        formats: ["txt"],
        tags: [],
        languages: [b.language],
        lastModified: "fixture-v1",
      };
    },
    search: async () => {
      throw new Error("fixture content.search not implemented — the eval selects books by ids");
    },
  };
  const extractor = {
    getText: async (a: { bookId: number }) => {
      const text = texts.get(a.bookId);
      if (text === undefined) throw new Error(`fixture text for book ${a.bookId} missing`);
      return { text, backend: "fixture", chars: text.length, cached: true, markers: markers.get(a.bookId) ?? [] };
    },
  };
  // Figure-inventory fake: serves the synthetic inventory the markers were injected from,
  // so the build's marker↔inventory join (source/dims) runs the same code path as live.
  const figures = {
    getInventory: async (a: { bookId: number }) => {
      const inventory = inventories.get(a.bookId);
      if (!inventory) throw new Error(`fixture inventory for book ${a.bookId} missing`);
      return { inventory, cached: true };
    },
  };
  return {
    config: cfg,
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    figures: figures as unknown as ToolDeps["figures"],
    embedder,
    ...(reranker ? { reranker } : {}),
    index: store,
    log,
  };
}

/** Index the whole fixture corpus through the real build tool; throws on any failure. */
async function buildFixtureIndex(deps: ToolDeps, corpus: Corpus): Promise<void> {
  const r = await buildIndexTool.handler(
    { ids: corpus.books.map((b) => b.bookId), force: true, enableFts: false, keywordOnly: false },
    deps,
  );
  const sc = r.structuredContent ?? {};
  const failures = (sc.failures as string[] | undefined) ?? [];
  if (r.isError || failures.length > 0) {
    throw new Error(`fixture index build failed: ${failures.join("; ") || firstText(r.content)}`);
  }
  if (sc.keywordOnly === true) {
    throw new Error(
      "fixture index built keyword-only — the embedding model is unavailable. " +
        "Ensure @huggingface/transformers is installed and the e5 model is cached under <indexDir>/models.",
    );
  }
  if (Number(sc.booksIndexed) !== corpus.books.length) {
    throw new Error(`indexed ${String(sc.booksIndexed)}/${corpus.books.length} fixture books`);
  }
}

function firstText(content: Array<{ type: string }>): string {
  const t = content.find((b): b is { type: "text"; text: string } => b.type === "text");
  return t?.text ?? "";
}

/** What one query run yields for scoring: positional relevance + confidence/rerank display info. */
interface QueryOutcome {
  rel: RankedRelevance;
  retrieved: string[];
  count: number;
  lowConfidence?: boolean;
  maxScore?: number;
  maxRerank?: number;
  reranked?: boolean;
}

/** Per-run query context shared by runQuery and the handler check. */
interface QueryCtx {
  deps: ToolDeps;
  libraryId: string;
  topK: number;
  rrfWeights?: number[];
}

/** One query in one mode → retrieve() (the ranking service the tool renders) → scored outcome. */
async function runQuery(q: GoldenQuery, mode: Mode, ctx: QueryCtx): Promise<QueryOutcome> {
  const { deps, libraryId, topK, rrfWeights } = ctx;
  const base = { libraryId, query: q.query, mode, topK };
  const opts = rrfWeights ? { rrfWeights } : {};
  // Mirror the handler's envelope: confidence fields only on non-empty results; rerank fields
  // only where reranking applies (hybrid/vector).
  const display = (r: RankedHits<unknown>) => ({
    count: r.hits.length,
    ...(r.hits.length > 0 ? { lowConfidence: r.lowConfidence } : {}),
    ...(r.maxScore !== undefined ? { maxScore: r.maxScore } : {}),
    ...(mode !== "keyword" && r.maxRerank !== undefined ? { maxRerank: r.maxRerank } : {}),
    ...(mode !== "keyword" ? { reranked: r.reranked } : {}),
  });

  if (q.target === "figures") {
    const bookId = q.scope === "book" ? requireBookId(q) : undefined;
    const r = await retrieve(deps, { ...base, scope: "figures", ...(bookId !== undefined ? { bookId } : {}) }, opts);
    // Figure hits are identified by (bookId, figIndex) — the calibre_get_figures handle.
    const labels = q.relevant.filter((x): x is FigureLabel => typeof x !== "number" && "figIndex" in x);
    const keyOf = (bookId: number, figIndex: number) => `fig-${bookId}#${figIndex}`;
    const relevantKeys = new Set(labels.map((l) => keyOf(l.bookId, l.figIndex)));
    const keys = r.hits.map((h) => keyOf(h.hit.bookId, h.hit.figIndex));
    return {
      rel: { matches: keys.map((k) => (relevantKeys.has(k) ? [k] : [])), relevantCount: relevantKeys.size },
      retrieved: keys,
      ...display(r),
    };
  }

  if (q.scope === "library") {
    const r = await retrieve(deps, { ...base, scope: "library" }, opts);
    const bookIds = r.hits.map((h) => h.hit.bookId);
    const relevantIds = new Set(q.relevant.filter((x): x is number => typeof x === "number"));
    return {
      rel: {
        matches: bookIds.map((id) => (relevantIds.has(id) ? [`book-${id}`] : [])),
        relevantCount: relevantIds.size,
      },
      retrieved: bookIds.map(String),
      ...display(r),
    };
  }

  // Book scope: match passage spans against the labels by overlap.
  const r = await retrieve(deps, { ...base, scope: "book", bookId: requireBookId(q) }, opts);
  const spans = r.hits.map((h) => ({ start: h.hit.charStart, end: h.hit.charEnd }));
  const labels = q.relevant.filter((x): x is SpanLabel => typeof x !== "number");
  return {
    rel: {
      matches: spans.map((s) =>
        labels
          .filter((l) => overlap(s, l) >= SPAN_OVERLAP_MIN * (l.charEnd - l.charStart))
          .map((l) => `span-${l.bookId}@${l.charStart}-${l.charEnd}`),
      ),
      relevantCount: labels.length,
    },
    retrieved: spans.map((s) => `@${s.start}-${s.end}`),
    ...display(r),
  };
}

function requireBookId(q: GoldenQuery): number {
  if (q.bookId === undefined) throw new Error(`${q.id}: scope=book query has no bookId`);
  return q.bookId;
}

/**
 * End-to-end handler check (#259): for a handful of queries the tool must emit exactly the
 * ranking retrieve() produced — same ids, same order — so a broken adapter (wrong mode, scope or
 * request field passed through) can't hide behind a green retrieval eval. Library scope keys on
 * bookIds, book scope on the passage spans in structuredContent.
 */
async function assertHandlerMatches(q: GoldenQuery, mode: Mode, ctx: QueryCtx, out: QueryOutcome) {
  const { deps, topK } = ctx;
  const r = await semanticSearchTool.handler(
    { query: q.query, scope: q.scope, target: q.target ?? "text", mode, bookId: q.bookId, topK },
    deps,
  );
  if (r.isError) throw new Error(`${q.id} [${mode}]: tool errored: ${firstText(r.content)}`);
  const sc = r.structuredContent ?? {};
  const got =
    q.scope === "library"
      ? ((sc.bookIds as number[] | undefined) ?? []).map(String)
      : ((sc.passages as Array<{ charStart: number; charEnd: number }> | undefined) ?? []).map(
          (p) => `@${p.charStart}-${p.charEnd}`,
        );
  if (JSON.stringify(got) !== JSON.stringify(out.retrieved)) {
    throw new Error(`${q.id} [${mode}]: handler ranking ${got.join(",")} ≠ retrieve() ${out.retrieved.join(",")}`);
  }
}

/** Fail the eval when an owed handler round-trip never ran (a silently skipped check is no check). */
function assertHandlerChecksRan(done: ReadonlySet<string>, modes: Mode[], live: boolean): void {
  // Live runs carry library-scope queries only — no book-scope round-trip is possible there.
  const owed = [...modes.map((m) => `library:${m}`), ...(live ? [] : ["book"])];
  const missing = owed.filter((k) => !done.has(k));
  if (missing.length > 0) throw new Error(`handler end-to-end check did not run for: ${missing.join(", ")}`);
}

/** Which handler round-trips a run owes: library scope in every mode, plus book scope once (fixture only). */
function handlerCheckKey(q: GoldenQuery, mode: Mode, out: QueryOutcome, bookChecked: boolean): string | undefined {
  // a non-empty ranking only — two empty lists would match without proving anything
  if (q.target || q.kind === "negative" || out.count === 0) return undefined;
  if (q.scope === "library") return `library:${mode}`;
  return bookChecked ? undefined : "book";
}

function overlap(a: { start: number; end: number }, l: SpanLabel): number {
  return Math.max(0, Math.min(a.end, l.charEnd) - Math.max(a.start, l.charStart));
}

/** One scored per-query report row from a query outcome. */
function toRow(q: GoldenQuery, mode: Mode, out: QueryOutcome): PerQueryRow {
  const row: PerQueryRow = {
    id: q.id,
    kind: q.kind,
    scope: q.scope,
    ...(q.target ? { target: q.target } : {}),
    ...(q.diagnostic ? { diagnostic: true } : {}),
    mode,
    ru: q.ru === true,
    retrieved: out.retrieved,
  };
  if (out.maxScore !== undefined) row.maxScore = round4(out.maxScore);
  // Rerank confidence per query — RERANK_FLOOR calibration input (#140). 4 significant
  // digits, not 4 decimals: candidate floors go down to 1e-3 and positives sit near 1e-4.
  if (out.maxRerank !== undefined) row.maxRerank = Number(out.maxRerank.toPrecision(4));
  if (out.reranked !== undefined) row.reranked = out.reranked;
  if (q.kind === "negative" || q.kind === "figure-negative") {
    row.flagged = out.count === 0 || out.lowConfidence === true;
  } else {
    const m = queryMetrics(out.rel);
    row.metrics = { hit1: m.hit1, recall5: round4(m.recall5), rr: round4(m.rr), ndcg10: round4(m.ndcg10) };
  }
  return row;
}

/** Run the full eval: (build +) query + score. The single entry point for CLI and tests. */
export async function runRetrievalEval(opts: HarnessOptions): Promise<EvalReport> {
  const progress = opts.onProgress ?? (() => {});
  const modes = opts.modes ?? ALL_MODES;
  const topK = opts.topK ?? 10;

  const loaded = loadCorpus();
  const { corpus, texts, markers } = loaded;
  let queries = loadQueries(texts, markers);

  const cfg = loadConfig({ CALIBRE_MCP_INDEX_DIR: opts.indexDir } as NodeJS.ProcessEnv);
  const store = new SqliteIndexStore(cfg);
  const embedder = opts.embedder ?? new TransformersEmbedder(cfg);

  let libraryId = corpus.libraryId;
  let deps = fixtureDeps(cfg, store, embedder, loaded, opts.reranker);

  if (opts.live) {
    // Live mode: an existing index under indexDir, real-library labels, no build.
    libraryId = opts.live.libraryId;
    const labels = opts.live.labels;
    deps = {
      ...deps,
      content: {
        ...(deps.content as object),
        resolveLibraryId: async () => libraryId,
      } as unknown as ToolDeps["content"],
    };
    queries = queries
      .filter((q) => q.scope === "library") // span labels don't transfer to real books
      .filter((q) => !q.target || q.target === "text") // live figure labels are #87's work
      .filter((q) => q.kind === "negative" || (labels[q.id]?.length ?? 0) > 0)
      .map((q) => ({ ...q, relevant: labels[q.id] ?? [] }));
    progress(`live mode: ${queries.length} labeled queries against library ${libraryId}`);
  } else {
    progress(`indexing ${corpus.books.length} fixture books (real chunk→embed→store path)…`);
    // Embed throughput for model bake-offs (prompt 05): warm up first so chunks/s times the
    // chunk→embed→store pipeline, not the one-off model load. Reported via progress (stderr)
    // ONLY — the committed report JSON stays deterministic across runs at the same commit.
    const warmStart = performance.now();
    await embedder.warmup().catch(() => {}); // a failed warmup surfaces via the build below
    const buildStart = performance.now();
    await buildFixtureIndex(deps, corpus);
    const buildS = (performance.now() - buildStart) / 1000;
    const built = deps.index.stats(libraryId);
    progress(
      `model warm in ${((buildStart - warmStart) / 1000).toFixed(1)}s; ` +
        `indexed ${built.chunks} chunks in ${buildS.toFixed(1)}s (${(built.chunks / buildS).toFixed(2)} chunks/s)`,
    );
  }

  if (opts.patchDeps) deps = opts.patchDeps(deps);
  const stats = deps.index.stats(libraryId);

  const perQuery: PerQueryRow[] = [];
  // Shipped weights only: a sweep runs retrieve() with weights the handler can't take.
  const handlerChecks = new Set<string>();
  const ctx: QueryCtx = { deps, libraryId, topK, ...(opts.rrfWeights ? { rrfWeights: opts.rrfWeights } : {}) };
  for (const mode of modes) {
    progress(`running ${queries.length} queries in mode=${mode}…`);
    for (const q of queries) {
      const out = await runQuery(q, mode, ctx);
      const key = opts.rrfWeights ? undefined : handlerCheckKey(q, mode, out, handlerChecks.has("book"));
      if (key !== undefined && !handlerChecks.has(key)) {
        await assertHandlerMatches(q, mode, ctx, out);
        handlerChecks.add(key);
      }
      perQuery.push(toRow(q, mode, out));
    }
  }

  if (!opts.rrfWeights) assertHandlerChecksRan(handlerChecks, modes, opts.live !== undefined);

  return assemble(perQuery, {
    model: MODEL_ID,
    indexVersion: INDEX_VERSION,
    corpus: stats,
    queryCount: queries.length,
    ruInvolved: queries.filter((q) => q.ru === true).length,
    modes,
    topK,
    live: opts.live !== undefined,
    ...(opts.live ? { unverifiedLabels: true } : {}),
    rerank: opts.rerank ?? (opts.reranker ? "on (unlabeled)" : "off (no reranker wired)"),
    rerankedRows: perQuery.filter((r) => r.reranked === true).length,
    gitSha: opts.gitSha ?? "unknown",
    ...(opts.rrfWeights ? { rrfWeights: opts.rrfWeights } : {}),
  });
}

/** Fold per-query rows into overall / RU / by-kind / negative aggregates. */
function assemble(perQuery: PerQueryRow[], meta: EvalReport["meta"]): EvalReport {
  const overall: EvalReport["overall"] = {};
  const ruInvolved: EvalReport["ruInvolved"] = {};
  const byKind: EvalReport["byKind"] = {};
  const negatives: EvalReport["negatives"] = {};
  const figureNegatives: EvalReport["figureNegatives"] = {};

  const negAgg = (rows: PerQueryRow[]) => ({
    n: rows.length,
    flaggedRate: rows.length === 0 ? 0 : round4(rows.filter((r) => r.flagged).length / rows.length),
  });
  for (const mode of meta.modes) {
    const rows = perQuery.filter((r) => r.mode === mode);
    const scored = rows.filter((r) => r.metrics !== undefined);
    overall[mode] = aggregate(scored.map((r) => r.metrics!));
    ruInvolved[mode] = aggregate(scored.filter((r) => r.ru).map((r) => r.metrics!));
    negatives[mode] = negAgg(rows.filter((r) => r.kind === "negative"));
    figureNegatives[mode] = negAgg(rows.filter((r) => r.kind === "figure-negative"));
    for (const kind of new Set(scored.map((r) => r.kind))) {
      byKind[kind] ??= {};
      byKind[kind]![mode] = aggregate(scored.filter((r) => r.kind === kind).map((r) => r.metrics!));
    }
  }
  return { meta, overall, ruInvolved, byKind, negatives, figureNegatives, perQuery };
}

/** Render the committed markdown decision record. Deterministic (no wall clock). */
export function renderMarkdown(report: EvalReport, title: string): string {
  const { meta } = report;
  const lines: string[] = [];
  lines.push(`# Retrieval eval — ${title}`);
  lines.push("");
  lines.push(
    `Model \`${meta.model}\` · index v${meta.indexVersion} · corpus ${meta.corpus.books} books / ${meta.corpus.chunks} chunks · ` +
      `${meta.queryCount} queries (${meta.ruInvolved} RU-involved) · topK=${meta.topK} · ` +
      `rerank: ${meta.rerank} (${meta.rerankedRows} reranked rows) · git ${meta.gitSha}`,
  );
  if (meta.live) {
    lines.push("");
    lines.push("> **LIVE MODE — labels are UNVERIFIED** until Artem confirms them. Not a CI artifact.");
  }
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  for (const mode of meta.modes) {
    const o = report.overall[mode];
    const r = report.ruInvolved[mode];
    const n = report.negatives[mode];
    if (!o || !r || !n) continue;
    lines.push(
      `- **${mode}**: overall nDCG@10 **${o.ndcg10}** / Hit@1 ${o.hit1} — RU-involved nDCG@10 **${r.ndcg10}** / ` +
        `Hit@1 ${r.hit1} (RU gap ${round4(o.ndcg10 - r.ndcg10)}) — negatives flagged ${n.flaggedRate}`,
    );
  }
  const kinds = Object.entries(report.byKind);
  for (const mode of meta.modes) {
    const worst = kinds
      .map(([kind, perMode]) => ({ kind, a: perMode[mode] }))
      .filter((x): x is { kind: string; a: AggregateMetrics } => x.a !== undefined)
      .sort((x, y) => x.a.ndcg10 - y.a.ndcg10)[0];
    if (worst) lines.push(`- weakest kind in ${mode}: **${worst.kind}** (nDCG@10 ${worst.a.ndcg10})`);
  }
  lines.push("");
  lines.push("## Overall (negatives excluded)");
  lines.push("");
  lines.push(aggTable(report.overall, meta.modes));
  lines.push("## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis");
  lines.push("");
  lines.push(aggTable(report.ruInvolved, meta.modes));
  lines.push("## By kind");
  lines.push("");
  for (const [kind, perMode] of Object.entries(report.byKind)) {
    lines.push(`### ${kind}`);
    lines.push("");
    lines.push(aggTable(perMode, meta.modes));
  }
  lines.push("## Negatives (no relevant answer exists — low-confidence signal)");
  lines.push("");
  lines.push("| mode | n | flagged rate |");
  lines.push("|------|---|--------------|");
  for (const mode of meta.modes) {
    const n = report.negatives[mode];
    if (n) lines.push(`| ${mode} | ${n.n} | ${n.flaggedRate} |`);
  }
  lines.push("");
  if (meta.modes.some((m) => (report.figureNegatives[m]?.n ?? 0) > 0)) {
    lines.push("### Figure negatives (target=figures; gate inactive until the figures floor is calibrated)");
    lines.push("");
    lines.push("| mode | n | flagged rate |");
    lines.push("|------|---|--------------|");
    for (const mode of meta.modes) {
      const n = report.figureNegatives[mode];
      if (n) lines.push(`| ${mode} | ${n.n} | ${n.flaggedRate} |`);
    }
    lines.push("");
  }
  lines.push("`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.");
  lines.push("");
  lines.push("## Per-query");
  lines.push("");
  for (const mode of meta.modes) {
    lines.push(`### mode=${mode}`);
    lines.push("");
    lines.push("| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |");
    lines.push("|----|------|-------|----|-------|-----|----|---------|----------|-----------------|");
    for (const r of report.perQuery.filter((x) => x.mode === mode)) {
      const m = r.metrics;
      const cells = m
        ? `${m.hit1} | ${m.recall5} | ${m.rr} | ${m.ndcg10}`
        : `— | — | — | ${r.flagged ? "flagged ✓" : "NOT flagged"}`;
      lines.push(
        `| ${r.id} | ${r.kind} | ${r.scope} | ${r.ru ? "✓" : ""} | ${cells} | ${r.maxScore ?? ""} | ${r.retrieved
          .slice(0, 3)
          .join(", ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function aggTable(agg: Partial<Record<Mode, AggregateMetrics>>, modes: Mode[]): string {
  const lines = ["| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |", "|------|---|-------|----------|-----|---------|"];
  for (const mode of modes) {
    const a = agg[mode];
    if (a) lines.push(`| ${mode} | ${a.n} | ${a.hit1} | ${a.recall5} | ${a.mrr} | ${a.ndcg10} |`);
  }
  lines.push("");
  return lines.join("\n");
}

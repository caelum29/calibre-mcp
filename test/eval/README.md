# Eval suite

Two eval axes live (or will live) here — they measure different things:

1. **Retrieval quality** (`retrieval/`, BUILT) — does `calibre_semantic_search` rank the
   right books/passages for a labeled query? See below.
2. **Tool selection** (reserved) — golden-prompt evals (DESIGN §9.4) asserting the *model*
   picks the right tool with the right args (e.g. "find me books about Rust ownership"
   → `calibre_semantic_search`; "ISBN 978… details" → `calibre_search`). Deferred until
   more tools land; this folder reserves the home so the CI quality gate has a place to grow.

## Retrieval eval (`retrieval/`) — the measurement gate for tuning

Every tuning decision downstream (reranker on/off, fusion weights, embedding-model swap,
chunk sizes) is guesswork without labels. This harness runs 68 labeled golden queries over
a committed fixture corpus through the REAL pipeline — `calibre_build_index`'s
chunk→embed→store path, then the real `calibre_semantic_search` handler per mode
(hybrid / vector / keyword) — and scores Hit@1, Recall@5, MRR, nDCG@10 per kind and overall.

```
pnpm eval                      # offline, deterministic; writes reports/<date>-<sha>.{md,json}
pnpm eval --tag baseline       # label the report filename
pnpm eval --modes hybrid       # subset of modes
pnpm eval --live               # UNVERIFIED spot check against the real library index (skip in CI)
pnpm eval --rerank off         # disable the shipped D-011 rerank stage (on by default)
pnpm eval --rrf-weights 1.5,1.0  # weighted-RRF (vector,keyword) override for this run only (#142 sweep seam)
pnpm eval --gate              # two passes (rerank ON, then OFF) vs their frozen baselines; exit 1 if either fails (~8 min standalone)
```

`--gate` checks, per `thresholds.json`: per-query Hit@1 non-regression per mode, negatives
flagged (6/6 hybrid+vector), figure-caption query count + hybrid floors, figure-negative query
count (its flagged rate stays informational until the figures floor is calibrated), the
heading front-matter block, and score drift (aggregates ±0.005, per-query maxScore ±0.01).

It then runs a second, **fusion-only pass** with the reranker off (`thresholds.fusionOnly`,
#356). With rerank ON, `RERANK_POOL` (30) covers the whole fixture, so the cross-encoder
re-sorts every candidate and a fusion regression can't show (ON hybrid = vector on every
positive). The OFF pass compares per-query Hit@1 to its own frozen baseline
(`reports/2026-11-04-b1c8ce2-rerankoff.json`): no query solved there may break, in any mode.
Cross-lingual drops are listed as report-only (OFF hybrid solves 0/8 today). Both passes
print, then `OVERALL GATE`. The OFF pass skips the reranker, so it adds only seconds.
`--gate` rejects `--rerank` (it sets rerank per pass) but honours `--rrf-weights`, which is
how the tier was proven to see fusion: `--rrf-weights 0.1,1` turns OFF red while ON stays green
(PR #383). `0,1` turns both red — weight 0 drops vector-only hits from the candidate set before
rerank, so it breaks more than the fused order. Any run (gate or not) refuses to write over a
report `thresholds.json` names as a baseline (same date + sha + tag); use `--out-dir` or `--tag`.

Every run also prints, after the per-mode headline:

- **headroom** — how many positive queries every mode in the run solves at Hit@1
  (`saturation.ts`). Those queries can't tell configs apart, so a high share means the suite
  has little room to show a tuning win (baseline f8bb617: 45/59 = 76.3% across
  hybrid/vector/keyword).
- **saturation warning** — when rerank-ON hybrid Hit@1 ≥ 0.95. Anthropic's eval guidance: a
  baseline near 95% means optimise cost/latency, or add harder queries, rather than chase
  quality. Fusion-only runs never warn: `--rerank off`, or an ON run where the reranker
  failed to load (0 reranked rows). A query missing from a mode counts as not solved.
- Both lines are skipped on `--live` runs (unverified labels).

### Layout

- `queries.json` — 68 golden queries `{ id, kind, scope, query, ru?, relevant }`. Kinds
  (count): `semantic-paraphrase` (16), `exact-identifier` (12), `figure-caption` (9),
  `cross-lingual` RU↔EN (8), `ru-monolingual` (8), `front-matter-trap` (6), `negative` (6)
  and `figure-negative` (3) — the two negative kinds have no right answer and measure the
  low-confidence signal, leaving 59 positives. 24/68 are RU-involved (`ru: true`): RU is the known weak axis (memory: "RU=0 chapters=RU-gap")
  and is first-class here, not an afterthought. `scope: "book"` queries label relevant
  passages as char spans + a `marker` substring (the harness fails loudly if a fixture
  edit invalidates a span).
- `corpus/` + `corpus.json` — 17 self-authored fixture "books" (12 EN incl. 2 code-heavy,
  5 RU), committed as text. Two are front-matter traps: 116 (plain-text praise/TOC,
  D-016's chapter detector) and 117 (`headingStructured`, EPUB→Markdown-shaped — only the
  #102 `leadingFrontMatter` rule finds its boundary; a smoke test pins that). `corpus/figures/`
  holds caption inventories for 6 books (the figure-caption kinds); **embeddings are built at eval time** (decision: committing a
  prebuilt index would rot on every INDEX_VERSION bump; the model is cached after the
  first run so CI/offline cost is seconds). Don't casually edit fixtures — span labels
  point into them.
- `metrics.ts` — self-written Hit@1 / Recall@k / MRR / binary nDCG@k (no framework dep).
- `harness.ts` — builds the fixture index through the real tools with fake
  content/extractor deps, runs every query per mode, aggregates. `patchDeps` is the
  injection seam for tuning tasks (swap embedder, disable the reranker, corrupt the
  store in tests).
- `run.ts` — the `pnpm eval` CLI. Work dir defaults to `retrieval/.work/` (gitignored);
  it copies the already-downloaded e5 model from the platform index dir
  (`~/Library/Application Support/calibre-mcp/index/models` on macOS) so nothing
  re-downloads, and rebuilds the fixture index fresh each run. It never writes to the
  production index dir.
- `reports/` — committed md+json reports, the decision record for tuning prompts 05/06.
  The JSON is deterministic: two runs at the same commit are byte-identical.
- `live-relevance.json` — live-mode labels keyed to real library bookIds, **unverified**
  until Artem confirms them.
- `thresholds.json` — every eval gate rule, each declared and committed BEFORE the run that
  measures it (D-012 protocol; Phase B record = issue #85 verdict comment). `baselineReport`
  names the frozen report the gates compare against; `fusionOnly.baselineReport` names the
  OFF pass's own.
- `gate.ts` — the mechanical PASS/FAIL behind `pnpm eval --gate`: per-query Hit@1
  non-regression, figure-caption floors, front-matter block, score drift; plus
  `evaluateFusionOnlyGate` for the OFF pass.
- `saturation.ts` — headroom share + saturation warning printed by every run (#365).
- `rrf-sweep.sh` + `rrf-sweep.ts`, `rerank-floor.ts` — one-off tuning scorers (#142 RRF
  weights, RERANK_FLOOR) over committed reports, gated by their `thresholds.json` blocks.
- `hash-embedder.ts` + `harness.test.ts` — model-free smoke tests that run in the normal
  `pnpm test` suite (seconds): plumbing, query-set contract, determinism, and the
  "deliberately broken ranking degrades the metrics" proof that the harness measures.
- `hash-gate.ts` + `hash-gate.test.ts` + `hash-baseline.json` — the **tier-0 gate** inside
  `pnpm test` (#357, `thresholds.hashGate`). The full golden set runs through the real
  pipeline with the hash embedder (reranker off, all three modes), and every query that had
  Hit@1 = 1 in the frozen `hash-baseline.json` must still have it — same rule as
  `nonRegression`, via `evaluateGate`. The baseline stores per-query **ranks**, never float
  scores, so a macOS-frozen baseline holds on Linux CI (Node 22.16 / 22 / 24). It runs in ~3 s
  and catches drift in chunking, FTS, stemming, fusion and front-matter demotion. It does not
  measure quality: the hash embedder is lexical-only. A reversed-ranking store
  (`broken-store.ts`) fails it in every mode. After a deliberate pipeline change, commit any
  rule change first, then re-freeze with `pnpm eval:hash-freeze` (D-012). A rank that differs
  between platforms is a nondeterminism bug to fix, never a reason to loosen the rule.

### Rules

- `pnpm eval` is NOT part of `pnpm test` (it needs the embedding model and real minutes);
  the smoke tests and the tier-0 hash gate are.
- Offline determinism: fixed model (`Xenova/multilingual-e5-small` q8), no network after
  the first model download, identical JSON on re-run.
- Reports are committed. Baseline first, then one report per tuning change, so every
  fusion/reranker/model decision cites numbers, not vibes.
- No held-out set yet: every query has been used for tuning (model bake-off, RRF sweep,
  floor calibration), so fixture numbers are optimistic. Tagging a held-out subset that
  tuning scripts skip is an open call for Artem (#365).

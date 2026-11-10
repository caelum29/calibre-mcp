# Eval suite

Two eval axes live (or will live) here — they measure different things:

1. **Retrieval quality** (`retrieval/`, BUILT) — does `calibre_semantic_search` rank the
   right books/passages for a labeled query? See below.
2. **Tool selection** (#362) — does the *model* pick the right tool with the right args (e.g.
   "find me books about Rust ownership" → `calibre_semantic_search`; "ISBN 978… details" →
   `calibre_search`)? Two layers:
   - **Layer A, BUILT** (`catalog-lint.ts`, runs in `pnpm test`, milliseconds): a deterministic
     lint of `docs/tool-catalog.json`. It checks pairwise description overlap and lead-sentence
     overlap (word Jaccard, thresholds as named constants with their basis), that every required arg is
     named in the description or has a schema description, that destructive writes say
     preview/dry-run and name their apply param (`confirm`/`preview`/`apply`), and that the
     skill manual has EN + RU triggers. A new or reworded tool that trips it gets its description
     fixed, then `pnpm catalog`.
   - **Layer B, not built** (`claude plugin eval` golden prompts against a mocked server, API
     spend, nightly): measures the model's actual choice. Layer A only guards the catalog text
     the model chooses from.

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
pnpm eval --compare a.json b.json  # paired stats of two existing reports (no eval run, seconds)
```

`--gate` checks, per `thresholds.json`: per-query Hit@1 non-regression per mode, negatives
flagged (6/6 hybrid+vector), figure-caption query count + hybrid floors, figure-negative query
count (its flagged rate stays informational until the figures floor is calibrated), the
heading front-matter block, per-query maxScore drift (±0.01 — an unmeasured cross-platform
allowance, tracked in #364), and the **top-10 list diff** (#358, `thresholds.listDiff`).

The list diff requires every baseline row (every kind and mode, negatives included) to
reproduce its top-10 `retrieved` list exactly; a missing row counts as changed. It replaced the
#325 aggregate ε (±0.005), which a rank 2→3 move (Δ nDCG@10 0.0022 over 59 positives) passed
unseen. Gains change lists too, so improvements ratchet: an intended change either re-freezes
the baseline (rule first, D-012) or goes into `list-diff-allow.json` as
`{tier, mode, id, retrieved, reason}`. An entry allows exactly that new list, and needs a
reason. It runs on the ON pass (`on`), the OFF pass (`fusionOnly`) and the tier-0 hash gate in
`pnpm test` (`hash`, `list-diff.test.ts`). A hash-tier failure names the one-command re-freeze,
`pnpm eval:hash-freeze`, which also drops the hash-tier allow entries the new baseline makes
stale (#392 decision 1).

Every baseline also records `goldenSetHash`, the sha256 of the canonical `queries.json` it was
measured on (#392 decision 2, `thresholds.goldenSet`). A run on a different golden set fails
that tier, so a relevance-label edit that leaves every top-10 list identical can't pass
unseen; a reformat keeps the hash. `--gate` checks it before the ON pass, so a mismatch fails
in seconds. The fix is a re-freeze (rule first): `pnpm eval:hash-freeze` for the hash tier, a
new `pnpm eval` run for ON/OFF.

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

`--compare a.json b.json` (`stats.ts`) pairs the two reports by query id, per mode, overall and
per kind. It prints Δ nDCG@10 (b − a), a percentile bootstrap 95% CI, a sign-flip permutation
p (exact for small n, fixed-seed Monte Carlo otherwise), Hit@1 flips with an exact sign test,
the MDE at 80% power, headroom, and `UNDERPOWERED` when p ≥ 0.05 and |Δ| < MDE. The same
two files always print the same numbers. At n = 59 the MDE is ~0.09–0.12 nDCG, so most
single-kind tuning deltas come out underpowered; cite this table, not a bare Δ.

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

Every fixture run also prints the **report-only axes** (#363, `thresholds.reportOnlyAxes`, each
`gate: false` with a stated trend; also appended to the md report): book-scope snippet-marker
rate and span-hit@1/3/5, confidence calibration (false-flag rate on Hit@1 positives, AUC of
`maxRerank` and of the top1−top2 rerank margin), and p50/p95 per-query latency. `--gate` adds
the ablation matrix (overall Hit@1 / nDCG@10 per mode × rerank on/off). The highlight invariant
is declared but not measured here: highlights belong to `calibre_search`'s FTS path. Latency
comes from `durationMs` (the whole per-query step: retrieve() plus scoring; the first query
of a pass also pays the model warm-up, so p95 carries it), which only the `pnpm eval` CLI
records (`HarnessOptions.timing`), so
`pnpm test` reports stay byte-identical. No gate, hash tier or list diff reads the new fields.

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
  The JSON is deterministic apart from the per-row `durationMs` timings: two runs at the same
  commit match on every other field.
- `live-relevance.json` — live-mode labels keyed to real library bookIds, **unverified**
  until Artem confirms them.
- `thresholds.json` — every eval gate rule, each declared and committed BEFORE the run that
  measures it (D-012 protocol; Phase B record = issue #85 verdict comment). `baselineReport`
  names the frozen report the gates compare against; `fusionOnly.baselineReport` names the
  OFF pass's own.
- `gate.ts` — the mechanical PASS/FAIL behind `pnpm eval --gate`: per-query Hit@1
  non-regression, figure-caption floors, front-matter block, maxScore drift; plus
  `evaluateFusionOnlyGate` for the OFF pass and `evaluateListDiff` for every tier.
- `stats.ts` — paired permutation test, bootstrap CI, sign test, MDE; `--compare`.
- `list-diff-allow.json` — intended top-10 list changes (empty while the baselines hold).
- `golden-set.ts` + `golden-set.test.ts` — the golden-set hash and its per-tier check (#392).
- `saturation.ts` — headroom share + saturation warning printed by every run (#365).
- `axes.ts` — the #363 report-only axes and the rerank on/off ablation matrix.
- `rrf-sweep.sh` + `rrf-sweep.ts`, `rerank-floor.ts` — one-off tuning scorers (#142 RRF
  weights, RERANK_FLOOR) over committed reports, gated by their `thresholds.json` blocks. Both
  print paired stats from `stats.ts` next to each gate check (#358): `rrf-sweep.ts` the same
  per-group Δ / CI / p / MDE / `UNDERPOWERED` line `--compare` computes, `rerank-floor.ts` an
  exact sign test of each floor vs the current one over the same rows. Information only: the
  declared gates and selection rules decide.
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

### Nightly CI (`.github/workflows/eval-nightly.yml`, #364)

`pnpm eval --gate` (rerank ON + fusion-only) runs nightly on `ubuntu-24.04` and on manual
`workflow_dispatch`, with the models cached in `test/eval/retrieval/.work/models`. The cache key
names both model ids (`Xenova/multilingual-e5-small`, `onnx-community/bge-reranker-v2-m3-ONNX`)
and the `@huggingface/transformers` version read from `pnpm-lock.yaml`; a step fails fast if the
ids in `src/semantic/` no longer match the key text. The job logs and summarizes
`model cache hit: true|false` (the first run, and any run after a key change, is a miss and
downloads ~0.7 GB). The report JSON/md go to the `eval-reports` artifact (30 days).

Failure semantics:

- **Now: report-only.** The frozen baselines (`thresholds.json`) were measured on macOS, and no
  Linux baseline or cross-platform ε exists yet, so a failing gate on Linux may be platform
  drift (ORT, transformers.js), not a regression. The gate step runs with `continue-on-error`:
  the run stays green, and the outcome is in an annotation and the job summary. The workflow is
  not a required check, uses no secrets and a read-only token.
- **Later: blocking.** Once a Linux report is frozen as a baseline and the cross-platform
  tolerance is measured, drop `continue-on-error` so a failing gate turns the nightly red (and
  consider making it required for the release workflow). The tier-0 hash gate in `pnpm test`
  already blocks every PR (it stores ranks, not float scores, so it is platform-safe).
- Nothing here re-freezes a baseline; a Linux baseline follows the usual rule-first re-freeze.

### Rules

- `pnpm eval` is NOT part of `pnpm test` (it needs the embedding model and real minutes);
  the smoke tests and the tier-0 hash gate are.
- Offline determinism: fixed model (`Xenova/multilingual-e5-small` q8), no network after
  the first model download, identical JSON on re-run apart from `durationMs`.
- Reports are committed. Baseline first, then one report per tuning change, so every
  fusion/reranker/model decision cites numbers, not vibes.
- No held-out set yet: every query has been used for tuning (model bake-off, RRF sweep,
  floor calibration), so fixture numbers are optimistic. Tagging a held-out subset that
  tuning scripts skip is an open call for Artem (#365).

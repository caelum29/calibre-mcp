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
chunk sizes) is guesswork without labels. This harness runs 98 labeled golden queries over
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
pnpm eval --rerank-pool 20 --rerank-max-tokens 256 --adaptive-pool  # #644 rerank knobs for this run only; --gate honours them
pnpm eval --gate              # two passes (rerank ON, then OFF) vs their frozen baselines; exit 1 if either fails (~8 min standalone)
pnpm eval --compare a.json b.json  # paired stats of two existing reports (no eval run, seconds)
```

`--gate` checks, per `thresholds.json`: per-query Hit@1 non-regression per mode, negatives
flagged (6/6 hybrid+vector), figure-caption query count + hybrid floors, figure-negative query
count (its flagged rate stays informational until the figures floor is calibrated), the
heading front-matter block, per-query maxScore drift (±0.01, a cross-platform allowance; the
Linux nightly measured max |Δ| 0.0067 over 10 runs, #364), and the **top-10 list diff** (#358,
`thresholds.listDiff`).

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
(`reports/2026-11-16-5abdc650-hardkinds-rerankoff.json`): no query solved there may break, in any mode.
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
two files always print the same numbers. The MDE depends on n and on the paired differences: at n = 83 (every positive of the 27-book fixture; the `--compare` of the 2026-11-16 rerank-off vs rerank-on baselines) it is 0.066–0.099 nDCG (measured 2026-11-16; the earlier 0.09–0.12 was at n = 59 in 2026-11), so most
single-kind tuning deltas still come out underpowered; cite this table, not a bare Δ.

Every run also prints, after the per-mode headline:

- **headroom** — how many positive queries every mode in the run solves at Hit@1
  (`saturation.ts`). Those queries can't tell configs apart, so a high share means the suite
  has little room to show a tuning win (27-book fixture, baseline `5abdc650`, 2026-11-16: 55/83 = 66.3% across
  hybrid/vector/keyword with rerank ON, 53/83 = 63.9% rerank OFF; at f8bb617 on the then 59 positives it was 45/59 = 76.3%).
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

- `queries.json` — 98 golden queries `{ id, kind, scope, query, ru?, heldOut?, confusers?,
  relevant, why? }`. Kinds (count): `semantic-paraphrase` (16), `exact-identifier` (14),
  `figure-caption` (9), `cross-lingual` RU↔EN (8), `ru-monolingual` (8), `front-matter-trap`
  (6), `negative` (6), `figure-negative` (3), and the #359 hard kinds `confuser-pair` (8),
  `no-overlap-paraphrase` (8), `adjacent-negative` (6), `raw-title` (6). The three negative
  kinds have no right answer and measure the low-confidence signal, leaving 83 positives.
  33/98 are RU-involved (`ru: true`): RU is the known weak axis and is first-class here, not
  an afterthought. `scope: "book"` queries label relevant passages as char spans + a
  `marker` substring (the harness fails loudly if a fixture edit invalidates a span). The
  hard kinds are capability kinds (`thresholds.capabilityKinds`): their drops are listed,
  never failed, until a rule commit promotes a kind. Each `confuser-pair` names the
  near-topic book that must not win rank 1 (`confusers`, report-only axis `confuserAt1`).
  Each `no-overlap-paraphrase` query shares no token at all with its target book
  (`leak-guard.test.ts`, `leak-guard-fts.test.ts`), so keyword Hit@1 = 0 by construction.
  `adjacent-negative` is scored like `negative` but stays out of `negativesFlagged` and
  `rerankFloor` (axis `adjacentNegative`). Every #359 query carries a one-line `why`.
- `corpus/` + `corpus.json` — 27 self-authored fixture "books" (20 EN incl. 2 code-heavy,
  7 RU), committed as text. Two are front-matter traps: 116 (plain-text praise/TOC,
  D-016's chapter detector) and 117 (`headingStructured`, EPUB→Markdown-shaped — only the
  #102 `leadingFrontMatter` rule finds its boundary; a smoke test pins that). 118–127 back
  the #359 kinds. 125–127 have a raw filename as `title` and authors `Unknown`; their
  `realTitle` is for the #363 title-prefix ablation and is never read by the harness.
  `corpus/figures/` holds caption inventories for 6 books (the figure-caption kinds);
  **embeddings are built at eval time** (decision: committing a prebuilt index would rot on
  every INDEX_VERSION bump; the model is cached after the first run so CI/offline cost is
  seconds). Don't casually edit fixtures — span labels point into them.
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
  OFF pass's own; `linux` is the Linux nightly rule (#364).
- `gate.ts` — the mechanical PASS/FAIL behind `pnpm eval --gate`: per-query Hit@1
  non-regression, figure-caption floors, front-matter block, maxScore drift; plus
  `evaluateFusionOnlyGate` for the OFF pass and `evaluateListDiff` for every tier. Each takes
  the platform-drift entries / list-diff mode of the rule `gateRuleFor` (`gate-guards.ts`) picks.
- `platform-replay.test.ts` — replays the committed Linux nightly reports through both gate
  rules (#364).
- `stats.ts` — paired permutation test, bootstrap CI, sign test, MDE; `--compare`.
- `folds.ts` — seeded stratified k-fold / leave-one-out splits, `crossValidate`, and the
  `stratifiedSample` the held-out set was drawn with (#632).
- `held-out.ts` + `held-out.test.ts` + `held-out-report.test.ts` — the held-out section of
  every fixture run, the frozen id list, and the guard that tuning scorers skip it (#632).
- `list-diff-allow.json` — intended top-10 list changes (empty while the baselines hold).
- `golden-set.ts` + `golden-set.test.ts` — the golden-set hash and its per-tier check (#392).
- `saturation.ts` — headroom share + saturation warning printed by every run (#365).
- `axes.ts` — the #363 report-only axes and the rerank on/off ablation matrix.
- `rrf-sweep.sh` + `rrf-sweep.ts`, `rerank-floor.ts` — one-off tuning scorers (#142 RRF
  weights, RERANK_FLOOR) over committed reports, gated by their `thresholds.json` blocks. Both
  print paired stats from `stats.ts` next to each gate check (#358): `rrf-sweep.ts` the same
  per-group Δ / CI / p / MDE / `UNDERPOWERED` line `--compare` computes, `rerank-floor.ts` an
  exact sign test of each floor vs the current one over the same rows. Information only: the
  declared gates and selection rules decide. Both skip the held-out queries (#632, Rules).
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

The job logs the runner's CPU model and CPU count (`lscpu`) to the log and the job summary
before the gate, so the two Linux outcomes below can be checked against the CPU they ran on.

**Linux gate rule (#364, `thresholds.linux`).** `--gate` picks its rule from the platform it
runs on: `linux` gets the declared `linux` block, every other platform the exact rule. The
macOS-frozen baselines don't reproduce on the Linux runners: the embedding and rerank runtime
(ONNX Runtime) drifts numerically between runner CPUs, so 93–108 of the 204 top-10 lists change
per run [17-book fixture, nightlies 2026-11-06 → 11-15], with ties already broken by id. Linux
also alternates between two outcomes (A: rerank-ON id-09 + xl-05 lose Hit@1, 7 of 10 runs; B:
id-09 ON + fusion-only hybrid id-05, 3 of 10), so no single Linux report could serve as a
baseline. Under the Linux rule:

- the top-10 list diff runs and prints its count, but never fails (a reasonless allow entry
  still does);
- per-query Hit@1 non-regression skips the declared `platformDrift` entries
  `{tier, mode, id, reason, seen}`; a skipped break prints as info. An entry whose query the
  baseline does not solve at Hit@1 is stale and fails, like a stale allow entry;
- everything else is gated as on macOS: negatives flagged, figure floors, heading front
  matter, maxScore ±0.01 and the golden-set hash.

`platform-replay.test.ts` replays one nightly report of each outcome
(`reports/*-linux-nightly*.json`) through both rules inside `pnpm test`: the Linux rule passes,
the exact rule fails. It also fails when a `platformDrift` entry goes stale against the current
baselines.

Failure semantics:

- **Now: report-only.** The gate step runs with `continue-on-error`: the run stays green, and
  the outcome is in an annotation and the job summary. The workflow is not a required check,
  uses no secrets and a read-only token.
- **Later: blocking.** After 7 consecutive nightly runs pass under the Linux rule, a follow-up
  PR drops `continue-on-error` so a failing gate turns the nightly red. The tier-0 hash gate in
  `pnpm test` already blocks every PR (it stores ranks, not float scores, so it is
  platform-safe and has no Linux rule).
- After re-freezing the rerank-on or fusion-only baseline, re-check the `linux` platform-drift
  entries against the next nightly logs: drop entries the new baseline no longer solves, add a
  query that now breaks on Linux only with its reason and how often it was seen.

### Baseline re-freeze log

Append-only: one entry per re-freeze, newest last. Every number names its corpus.

- **2026-11-16, #634 (identifier tokens reach the raw `body` column).** Rule commit first: two
  `exact-identifier` guards, `id-11` `C++` → 109 and `id-12` `Node.js` → 102 (the only fixture
  books holding these tokens; the fixture has no `c#`). Then `pnpm eval:hash-freeze` (210 rows),
  `pnpm eval --tag 634` → `reports/2026-11-16-5c8ed2df-634.json` (on) and
  `pnpm eval --rerank off --tag 634-rerankoff` → `reports/2026-11-16-44dcf56e-634-rerankoff.json`
  (fusionOnly). The on report was measured before the branch was rebased onto #667/#669 (harness
  rule and snippet start, no ranking change); the final `--gate` on the pushed head reproduces it.
  Changed top-10 lists on the 68 earlier queries [17-book fixture]: only `sp-13` ("three-way
  merge"), whose raw token `three-way` now also matches book 109 ("three-way" partitioning):
  keyword (on and fusionOnly) rank 4–5 swap 105 ↔ 109, fusionOnly hybrid rank 5 105 → 103, 109
  enters at rank 6. Its relevant book 106 stays at rank 1 everywhere; no Hit@1 changes; cosine
  maxScore |Δ| 0.0000. New rows: keyword Hit@1 = 1 for both guards in both passes; rerank-on
  hybrid/vector rank `Node.js` second behind 103 (the cross-encoder's order). The `linux`
  platform-drift entries (on id-09/xl-05, fusionOnly hybrid id-05) are all still solved at Hit@1
  by the new baselines.
- **2026-11-16, #604 (library rerank also scores the keyword half's chunk, Fix A).** No rule
  change (no guard queries). Step 1 (`pnpm eval --gate` on the code, old baselines) [17-book
  fixture]: the fusion-only pass and the hash tier showed 0 list changes (neither runs the
  reranker); the on pass changed 19 hybrid top-10 lists, with no Hit@1 change and vector/keyword
  untouched. Every move is a book whose keyword chunk outscored its vector chunk (a kept score is
  the max over the book's candidates, so only those books can move up). One maxScore move,
  hybrid `neg-06` 0.7609 → 0.7733, is book 116's own vector cosine entering the top 10. Re-froze
  the on baseline only: `pnpm eval --tag 604` → `reports/2026-11-16-08ca3695-604.json`
  (identical to step 1's on pass). fusionOnly and hash baselines unchanged; the `linux`
  platform-drift entries are all still solved at Hit@1.
- **2026-11-16, #632 (held-out flag).** Rule commit first: `"heldOut": true` on the 20 frozen
  queries (no query, kind or label changed), which moves the canonical golden-set hash. Then
  `pnpm eval:hash-freeze` (210 rows, every rank identical), `pnpm eval --tag heldout` →
  `reports/2026-11-16-db98db10-heldout.json` (on) and `pnpm eval --rerank off --tag
  heldout-rerankoff` → `reports/2026-11-16-db98db10-heldout-rerankoff.json` (fusionOnly). No
  separate step-1 `--gate` run: with the flag in place it fails fast on the hash, so the new
  reports were diffed against the previous baselines instead [17-book fixture]: 0 of 210 top-10
  lists changed on either tier, no Hit@1 change, cosine maxScore |Δ| 0.0000. The `linux`
  platform-drift entries (on id-09/xl-05, fusionOnly hybrid id-05) are all still solved at
  Hit@1, and none of them is held out.
- **2026-11-16, #359 (hard fixture kinds).** Rule commit first: `capabilityKinds` (the four
  kinds are report-only in all three tiers, the promotion rule, the headroom criterion) and the
  `confuserAt1` / `adjacentNegative` axes. Then 10 self-authored books (118–127) and 28
  queries: `confuser-pair` 8, `no-overlap-paraphrase` 8, `adjacent-negative` 6,
  `raw-title` 6, 8 of them held out (2 per kind) [27-book fixture, 98 queries, 33
  RU-involved]. Measuring runs before the freeze found new books taking existing queries.
  The books were reworded or replaced, never the labels:
  - `id-11` "C++": a C++ book became a Rust-traits book.
  - `id-06`: book 120 lost "reflog".
  - `sp-01`: 122 lost its GC wording.
  - `id-05`: 124 lost `'none'`.
  - `neg-04`/`neg-05`: books 126 and 127 lifted them over the cosine floor, so 126 became an
    espresso book and 127 was made factual.
  - Hash-tier `sp-03`, `id-06` and `ru-03`: FNV token and slot collisions, reworded.

  The no-overlap guard became strict: `ftsMatch` ORs every query token, stop words included,
  so each query shares no token at all with its target book. Re-froze all three tiers at
  5abdc650: `pnpm eval:hash-freeze` (294 rows), `pnpm eval --tag hardkinds` (on) and
  `--rerank off --tag hardkinds-rerankoff` (fusionOnly). 131 of 210 existing top-10 lists
  changed per tier. Two existing Hit@1 breaks are accepted, with their reasons in
  `reports/2026-11-16-hardkinds-rebaseline.md`:
  - on/vector `id-09`: cross-encoder noise, 0.00067 vs 0.00033.
  - fusionOnly/vector `sp-01`: e5 margin 0.0004.

  Headroom held for every kind (≥ 15% failing in at least one of the six configurations).
  Keyword Hit@1 on no-overlap is 0/8 in both reports. The `linux` platform-drift entry
  on/vector `id-09` was dropped, because the new baseline no longer solves it; the other four
  entries are still solved.

### Rules

- `pnpm eval` is NOT part of `pnpm test` (it needs the embedding model and real minutes);
  the smoke tests and the tier-0 hash gate are.
- Offline determinism: fixed model (`Xenova/multilingual-e5-small` q8), no network after
  the first model download, identical JSON on re-run apart from `durationMs`.
- Reports are committed. Baseline first, then one report per tuning change, so every
  fusion/reranker/model decision cites numbers, not vibes.
- **Held-out set (#632).** 28 fixture queries carry `"heldOut": true` in `queries.json`: 20 from
  #632 and 8 from #359 (2 per hard kind).
  #632's 20 were drawn once, from the 68 queries of the set at the time, with `folds.ts`
  `stratifiedSample` (seed `0x358`, stratified by kind, largest-remainder allocation over the
  66 non-diagnostic queries; the two `fig-xl` diagnostics stay out): semantic-paraphrase 5,
  exact-identifier 4, figure-caption 2, cross-lingual 2, ru-monolingual 2, front-matter-trap 2,
  negative 2, figure-negative 1. The ids are frozen (`held-out.test.ts` pins them): never
  re-drawn, never edited to move a number. Queries added later (#634's `id-11`/`id-12`, #359's
  kinds) are held out only where their own issue says so. Every earlier tuning decision (model
  bake-off, ADR-0021 RRF weights, ADR-0022 `RERANK_FLOOR`) was made on all queries, so those
  numbers stay optimistic; the held-out set guards the fits from here on.
- **Tuning scorers skip it.** `rrf-sweep.ts` (`scoreWeight`) and `rerank-floor.ts`
  (`scoreFloors`) drop held-out ids from every report they score (fixture and live: live
  reports reuse the fixture ids) and recompute the aggregates from the remaining rows,
  so a value is never selected on the queries it is reported on. One exception: their
  `zeroBroken` check is the merge gate (`nonRegression` via `evaluateGate`) and stays on the
  full set, because every change must pass it anyway; it is not a selection objective. A new
  tuning scorer must add its case to `held-out.test.ts`: a held-out row that would decide its
  outcome must give exactly the result of the same reports with that row deleted.
- **Held-out numbers are reported apart.** Every fixture `pnpm eval` run prints, and its md
  report adds under "Held-out (#632)", per mode: n, Hit@1 and nDCG@10, each with a 95%
  percentile bootstrap interval (`stats.ts`, seed `0x358`), plus the held-out negatives
  flagged. A set of 20 is noisy, so the interval is part of the number. Report-only: no gate,
  baseline or list diff reads it, and the report JSON shape is unchanged.
- **Fitted values are reported as fold estimates.** Any value chosen by maximising a metric
  (a threshold, weight or floor) reports its k-fold estimate through `folds.ts`
  (`kFold`, default k = 5, or `leaveOneOut` for small judged categories, plus
  `crossValidate`): fit on k − 1 folds, score on the k-th, mean ± SD. Folds are stratified
  (kind on the fixture, category on the judged set) and seeded; the unit is the query, so all
  modes of one query share a fold. `rerank-floor.ts` prints its 5-fold estimate this way.
- **Number of looks.** A sweep that compares several candidates against a baseline either
  declares one primary comparison in its `thresholds.json` block before measuring, or
  reports Holm-adjusted p values (step-down Bonferroni over the m comparisons).

## Blind judged pass: judgment store and run comparison (#361)

The blind two-judge pass over the live library (`scripts/judged-*`, #602) keeps its grades in a
**judgment store**: one append-only JSONL per query set, named `<first 12 hex of the query set's
sha256>.jsonl` (the hash is over the canonical JSON of `queries.json`, so re-indenting the file
keeps the store, while any query edit, case or whitespace included, starts a new one; the canonical
JSON keeps key order, so reordering the keys of a query also starts a new store). It lives
under the gitignored `docs/dev/evals/judgments/` with the run dirs, because both describe a private
library; it is never committed and never runs in CI. Each record holds query id, book id,
`charStart`/`charEnd` (figures: the figure offset as both), `indexVersion`, the rubric version, the
sha256 of the text the judges read, the final grade and coverage, each judge's raw grade, whether it
was adjudicated, the run and when it was judged.

**Matching.** A hit reuses a stored grade when query id, book id, `indexVersion` and rubric version
are equal and the two ranges overlap by at least half of the shorter range (a figure matches only the
equal offset; touching passages never match). Several matches: the larger overlap, then the newer
record, then the closer span. One record grades at most one hit of a query: the (hit, record)
matches are assigned greedily in that order (the better-ranked hit first on a full tie), and a hit
whose matches are all taken stays unjudged, so the next dump sends it to the judges. `--strict-text` also requires the judged-text hash to be equal (for
snippet-window A/Bs, where the location stays and the shown text changes). A hit no record covers
is **unjudged** (`null`): never relevant, and counted in Hole@5.

```bash
pnpm eval:judged:score --import <judgedRunDir> --store <store>   # seed from an already judged run
pnpm eval:judged:dump <runDir> --store <store>                    # blind batches = only uncovered hits
pnpm eval:judged:score <runDir> --store <store>                   # append new grades, score from the store
pnpm eval:judged:compare <runA> <runB> --store <store>            # paired NDCG@5 / hit@5, B − A
pnpm eval:judged:dump <runDir> --store <store> --arm pool20       # one #644 rerank latency arm (fresh runDir per arm)
```

`--arm <name>` (#644) runs one arm pre-registered in `thresholds.rerankLatency.arms`: its rerank
options reach `retrieve()` through `BuildServerOptions.retrievalOptions` (never an env var or tool
param), `arm.json` in the run dir records them with the git sha and Node version, and three warm-up
queries outside the judged set run first and are discarded. A run dir keeps its arm: resuming it with
another `--arm` (or none) is refused. The arms, the acceptance rule and the protocol live in that
block, committed before any arm was dumped.

- `score` appends only grades the store does not already cover (an existing record is never
  rewritten) and adds NDCG@5 (gain 2^grade − 1, discount log2(rank + 1), ideal = the best five stored
  grades of the query at that `indexVersion`) and Hole@5 to the report, plus a book-length quartile
  table per library when the run has `book-lengths.json` (written by `dump`, chunks per book read
  from the index).
- `compare` refuses runs of different query sets, a store named for another query set, and any
  unjudged hit in a compared top 5 (the message names the dump command that fills it). Per mode both
  runs have, overall and per category, it prints each run's mean NDCG@5 and hit@5 with a bootstrap
  95% interval and the paired B − A difference with bootstrap CI, permutation p, hit@5 flips with a
  sign test, MDE and `UNDERPOWERED` (the `stats.ts` primitives, fixed seed: the same store snapshot
  prints the same numbers). The header records both run names, the query-set sha256 and the store
  file's sha256.
- The 2026-11 blind baseline's book-scope items were graded with the score label visible (stripped
  from later blind batches by #664). `--import` stores them as they were; under `--strict-text` those
  items differ from a newer run's text and go back to the judges.

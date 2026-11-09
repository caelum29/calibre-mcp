# Embedder bake-off #140 — e5-small vs EmbeddingGemma 2 (768 / 256-MRL), with RRF weight sweep

> **Provenance (added 2026-11-09).** This report was written on the branch of PR #168, which was
> closed without merge because the verdict is "no swap". It was restored here from that PR's head
> commit `79dc814` so the decision keeps its evidence on `main`. Only this summary and
> `bakeoff-140/scores.md` were restored. The raw per-run reports, the `embedderBakeoff140` block
> of `thresholds.json` and the scorer script (`bakeoff-140.ts`, `bakeoff-140.sh`) are not on
> `main`; they stay in that commit (`refs/pull/168/head`).

Issue #140, D-012 protocol. Branch stacked on #163 (transformers.js **4.3.1** /
onnxruntime-node **1.30**) — every candidate, including the e5 baseline, was measured on
that stack. Gates were declared and committed BEFORE any run (`thresholds.json`
`embedderBakeoff140`, commit `25ae4c3`). Raw reports: `bakeoff-140/*.{md,json}`; mechanical
scorer output: `bakeoff-140/scores.md` (`node --import tsx test/eval/retrieval/bakeoff-140.ts`).

**Verdict: no swap. Keep `multilingual-e5-small`, keep `VECTOR_RRF_WEIGHT = 1.0`.**
gemma2-768 clears every quality gate (G1–G4) but fails CPU throughput by a wide margin
(**0.08–0.09× e5** vs the ⅓ gate); gemma2-256 additionally fails EN non-regression on one
near-tie query.

## Setup

- Harness: `pnpm eval` (65 golden queries, 24 RU-involved, 16 fixture books / 35–36 chunks),
  driven by `bakeoff-140.sh`: per model × `VECTOR_RRF_WEIGHT` ∈ {1.0, 1.5, 2.0}, two
  measurements — **fixtureOn** (reranker ON = shipped default) and **fixtureOff**
  (`--rerank off`, isolates embedder + fusion). w=1.0 runs all modes, other weights hybrid only.
- Eval index built fresh per run in a scratch work dir (session scratchpad); production
  index never written (read-only, immutable open for the throughput sample only).
- Live eval NOT run for gemma2 (declared up front): a gemma2 live index needs a full-library
  re-embed — at the measured 1.5–1.7 chunks/s that is ~313k chunks ≈ **54 h**.
- Machine: Apple Silicon, other sessions loading the CPU (load avg 26–40 during the eval
  runs, 7–14 during throughput). Throughput is NOISY; ratios were measured interleaved.

## Results

### Rerank OFF — the discriminating measurement (nDCG@10 / Hit@1, w=1.0)

| model | hybrid overall | hybrid RU | hybrid cross-lingual | vector overall | vector RU | vector cross-lingual |
|---|---|---|---|---|---|---|
| e5-small | 0.8429 / 0.7679 | 0.6339 / 0.5238 | 0.1781 / 0.0000 | 0.9039 / 0.7857 | 0.8433 / 0.6667 | 0.6513 / 0.2500 |
| gemma2-768 | **0.8585 / 0.8036** | **0.6577 / 0.5714** | 0.1781 / 0.0000 | **0.9779 / 0.9464** | **1.0000 / 1.0000** | **1.0000 / 1.0000** |
| gemma2-256 | 0.8519 / 0.7857 | 0.6577 / 0.5714 | 0.1781 / 0.0000 | 0.9726 / 0.9464 | 1.0000 / 1.0000 | 1.0000 / 1.0000 |

Same picture as D-012: gemma2 is perfect on the vector half for RU/cross-lingual, but hybrid
cross-lingual stays **0.1781 for every model** — the keyword half ranks books in the query's
language first and fusion can't overrule it.

### Rerank ON — the shipped default (w=1.0)

| model | hybrid overall | hybrid RU | exact-identifier | semantic-paraphrase |
|---|---|---|---|---|
| e5-small | 0.9690 / 0.9464 | 0.9824 / 0.9524 | 0.9167 | 0.9769 |
| gemma2-768 | **0.9825 / 0.9643** | 0.9824 / 0.9524 | **0.9489** | **1.0000** |
| gemma2-256 | 0.9825 / 0.9643 | 0.9824 / 0.9524 | 0.9489 | 1.0000 |

With the reranker ON the fixture is saturated: hybrid ≡ vector for every model (the rerank
pool covers the whole fixture), RU is identical. gemma2's +0.0135 overall is exactly one
query (`sp-11`, which the 4.3.1 stack broke for e5 — see "ORT drift" below).

### RRF weight sweep (hybrid nDCG@10)

| model | w | ON overall / RU | OFF overall / RU / xl | OFF exact-id | EN vs own w=1.0 |
|---|---|---|---|---|---|
| e5-small | 1.0 | 0.9690 / 0.9824 | 0.8429 / 0.6339 / 0.1781 | 1.0000 | — |
| e5-small | 1.5 | 0.9690 / 0.9824 | 0.8429 / 0.6339 / 0.1781 | 1.0000 | ok |
| e5-small | 2.0 | 0.9690 / 0.9824 | 0.8429 / 0.6339 / 0.1781 | 1.0000 | ok |
| gemma2-768 | 1.0 | 0.9825 / 0.9824 | 0.8585 / 0.6577 / 0.1781 | 1.0000 | — |
| gemma2-768 | 1.5 | 0.9825 / 0.9824 | 0.8519 / 0.6577 / 0.1781 | 0.9692 | ✗ id-05 |
| gemma2-768 | 2.0 | 0.9825 / 0.9824 | 0.8495 / 0.6577 / 0.1781 | 0.9583 | ✗ id-05 |
| gemma2-256 | 1.0 | 0.9825 / 0.9824 | 0.8519 / 0.6577 / 0.1781 | 0.9692 | — |
| gemma2-256 | 1.5 | 0.9825 / 0.9824 | 0.8483 / 0.6577 / 0.1781 | 0.9526 | ✗ (drop 0.017) |
| gemma2-256 | 2.0 | 0.9825 / 0.9824 | 0.8483 / 0.6577 / 0.1781 | 0.9526 | ✗ (drop 0.017) |

The weights do act (29 hybrid orderings change between w=1.0 and 2.0 for e5), but no weight
moves RU or cross-lingual for ANY model, while higher weights cost exact-identifier for
gemma2. **Operating point = w=1.0 for all three.** Agrees with #142 (e5 on 4.2.0, incl. live:
"1.0 stays" — no weight passes its gates). Weighting can't fix cross-lingual hybrid at ≤2.0:
a RU query's keyword hits sit on RU books at keyword rank 1, and 1/(60+1) on the keyword side
keeps beating a w·1/(60+r) vector lead. That needs query-adaptive fusion (#142 non-goal), not
a static weight or a better embedder.

### Gates (declared in `thresholds.json`, scored mechanically)

| gate | gemma2-768 | gemma2-256 |
|---|---|---|
| G1 RU gain: OFF vector ≥ +0.05, OFF hybrid ≥ +0.02, ON no drop | ✓ (+0.157 / +0.024 / 0) | ✓ (+0.157 / +0.024 / 0) |
| G2 cross-lingual OFF vector ≥ +0.05 | ✓ (+0.349) | ✓ (+0.349) |
| G3 EN non-regression (overall ≤0.01, exact-id/front-matter ≤0.01 + 0 broken Hit@1, paraphrase ≤0.02) | ✓ | ✗ — OFF hybrid exact-identifier −0.031, `id-05` loses Hit@1 |
| G4 zero-broken vs frozen gate baseline (ON) | ✓ | ✓ |
| **G5 throughput ≥ ⅓ e5** | **✗ 0.08–0.09×** | **✗ (same weights)** |
| G6 ops: download ≤ 1 GB, dim ≤ 1024, license | ✓ 314 MB q8, 768, Apache-2.0 | ✓ 1024 B/vector, Apache-2.0 |

`id-05` caveat: it is a near-tie query — it also flips for e5 between ORT 1.24 and 1.30 and
between RRF weights in #142's sweep. The gemma2-256 G3 fail stands on that one query; the
throughput fail is what decides.

### Throughput (G5) — embed-only, warm, 120 real library chunks (~430 tokens), interleaved

| run (load avg) | e5-small | gemma2-768 q8 | gemma2-768 q4 | gemma-768 (v1) q8 |
|---|---|---|---|---|
| 1 (12→13) | 21.99 / 18.22 / 20.63 → **20.6** | 1.65 / 1.65 / 1.47 → **1.65 (0.08×)** | 1.67 / 1.66 / 1.49 → 1.66 (0.08×) | — |
| 2 (7→12) | 22.63 / 16.53 / 16.68 → **16.7** | 1.74 / 1.54 / 1.50 → **1.54 (0.09×)** | — | 2.13 / 2.32 / 2.30 → 2.30 (0.14×) |

Not a measurement artifact: a single passage costs 464 ms (gemma2) vs 43 ms (e5) at the same
token length (median 429 vs 440 tokens), and q4 buys nothing over q8 on this ORT build. v1 on
the same stack is 0.14× embed-only — D-012's 0.31× was a whole-pipeline number where
chunking/store overhead diluted e5's lead. For a ~313k-chunk library: e5 ≈ 4.5–5 h of embed
time, gemma2 ≈ 54 h. gemma2's query embed (60 ms) would be fine; the indexing cost is not.

### Index size per vector

| model | bytes/vector | library vectors (313k chunks) |
|---|---|---|
| e5-small | 1 536 | ~481 MB |
| gemma2-768 | 3 072 | ~962 MB |
| gemma2-256 | 1 024 | ~321 MB |

### Floors

| model | vector maxScore positives | negatives | semanticFloor by rule | positives flagged |
|---|---|---|---|---|
| e5-small | 0.798–0.896 | 0.771–0.810 | no gap → 0.82 | 5/38 |
| gemma2-768 | 0.653–0.820 | 0.538–0.571 | **0.61** (gap midpoint) | 0/38 |
| gemma2-256 | 0.682–0.842 | 0.555–0.620 | **0.65** (gap midpoint) | 0/38 |

- **semanticFloor (e5): 0.78 stays.** There was no clean gap on 4.2.0 either (negatives
  0.771–0.810 in #142's OFF run, identical to this one), so the drift didn't move it; 0.82
  would trade 3 more flagged negatives for 5 flagged positives. If gemma2 is ever adopted:
  0.61 (768) / 0.65 (256), both cleanly separating.
- **RERANK_FLOOR: 0.3 stays** under the declared rule (all negatives' max rerank ≤ 0.001 for
  every model). Side finding: 18/38 e5 positive library queries (12/38 gemma2) top out below
  0.3 — sometimes far below (`id-09` 0.0003, `sp-01` 0.0017) while still Hit@1 — so the
  shipped lowConfidence flag fires on about half the fixture's correct answers. A floor
  around 0.01 would separate this fixture, but that needs live evidence; noted as a follow-up.

## ORT 1.30 drift (#139) — what the bump does to e5 on its own

- Rerank OFF: e5 on 4.3.1 is **metric-identical** to 4.2.0 (#142's runs: hybrid 0.8429 / RU
  0.6339, negatives flagged 0.50) — the embedder drift (cos 0.997–0.999) doesn't move the fixture.
- Rerank ON: two near-tie queries flip from the reranker's logit drift — `sp-11` loses Hit@1
  (1.0 → 0.63) and `id-05` exact-identifier 0.63 → 0. Hybrid overall 0.987 → **0.969**, and e5
  on 4.3.1 **fails the frozen G4 zero-broken gate** (`sp-11`).
- So without a model swap, the 4.3.1 bump is a small fixture regression with no quality
  upside, and it still forces a full re-index (D-011/#139). gemma2 happens to win `sp-11` back.

## Recommendation

1. **No swap; `ACTIVE_MODEL` stays `e5-small`, `INDEX_VERSION` stays 3.** gemma2 is the better
   embedder (vector half: overall +0.074, RU +0.157, cross-lingual +0.349; ON +0.0135) but costs
   ~11× the indexing CPU, and in the shipped default (reranker ON) its quality gain shrinks to
   one fixture query. The default-mode RU gap is fusion-bound (cross-lingual hybrid 0.1781 for
   every model and weight).
2. **`VECTOR_RRF_WEIGHT` stays 1.0** (agrees with #142).
3. **Floors:** semanticFloor 0.78 and RERANK_FLOOR 0.3 stay. Pre-computed for a future gemma2
   swap: 0.61 / 0.65.
4. **#139 (transformers 4.3.1) — don't ship it by itself.** Without gemma2 it only buys the ORT
   drift (fails the zero-broken gate, forces a re-index). Park #163 until a re-index happens for
   another reason, or until a transformers/ORT release needs to land; re-baseline the gate then.
5. **Revisit if:** (a) a faster gemma2 runtime appears (WebGPU/CoreML EP in onnxruntime-node,
   or a smaller text-only export); (b) query-adaptive fusion (#142 non-goal) lifts the hybrid
   ceiling so the embedder becomes the binding constraint; (c) indexing moves off the
   interactive machine (one-off batch job), which would make 54 h acceptable.

## Draft decision (D-NNN, number assigned on acceptance — also in docs/dev)

> **D-NNN | 2026-10-21 | Embedding model REAFFIRMED as `multilingual-e5-small` after the #140
> bake-off vs EmbeddingGemma 2 (768 / 256-MRL) on transformers.js 4.3.1 / ORT 1.30; no swap,
> `VECTOR_RRF_WEIGHT` stays 1.0, floors unchanged (semanticFloor 0.78, RERANK_FLOOR 0.3).**
> gemma2-768 passes every quality gate (rerank OFF: vector RU 0.84 → 1.00, cross-lingual
> 0.65 → 1.00, overall 0.90 → 0.98; rerank ON: +0.0135 overall) and is Apache-2.0, but fails the
> ⅓-throughput gate at 0.08–0.09× e5 (1.6 vs 17–21 chunks/s embed-only; ≈54 h vs ≈5 h for the
> library); gemma2-256 also fails EN non-regression on the near-tie `id-05`. Hybrid
> cross-lingual stays 0.1781 for every model and RRF weight 1.0–2.0, so the default-mode RU gap
> is a fusion problem a static weight can't fix (agrees with #142). The 4.3.1 bump alone
> regresses the rerank-ON fixture (`sp-11`, `id-05` flip on reranker logit drift; e5 fails the
> zero-broken gate) → #139/#163 parked until a re-index is needed anyway. Pre-computed gemma2
> floors if ever adopted: semanticFloor 0.61 (768) / 0.65 (256). | Fixture is saturated with
> the reranker ON; the only big wins are in the rerank-OFF vector half, which users don't get by
> default. | Issue #140; `test/eval/retrieval/reports/2026-10-21-embedder-bakeoff-140.md`;
> `thresholds.json` `embedderBakeoff140`.

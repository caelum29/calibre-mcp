# Embedding-model bake-off — e5-small vs EmbeddingGemma-300M (768/256-MRL) vs bge-m3

Prompt 05 (`docs/prompts/semantic/05-embedding-model-eval-swap.md`). Golden-query eval
(prompt 04 harness), fixture corpus, **reranker OFF** (`--rerank off` — one variable at a
time; rerankers mask embedder differences), topK=10, all three modes. Candidate schemes
(prefixes/pooling/dtype) are transcribed from each model card into `src/semantic/model.ts`
`CANDIDATES`; runs switch `ACTIVE_MODEL` and rebuild the fixture index from scratch.

## Thresholds — DECLARED BEFORE ANY CANDIDATE RUN (no post-hoc goalposts)

A candidate must clear **all** of T1–T4 against the same-commit e5-small baseline
(rerank off) to justify a swap:

- **T1 (RU gain — the target axis):** RU-involved nDCG@10 improves by **≥ +0.05 absolute
  in BOTH hybrid and vector** modes.
- **T2 (cross-lingual gain):** `cross-lingual` kind nDCG@10 improves by **≥ +0.05 absolute
  in vector** mode (the kind that motivated the bake-off; keyword mode is blind to it).
- **T3 (EN non-regression):** overall nDCG@10 drops by **≤ 0.01 absolute** in every mode,
  AND neither `semantic-paraphrase` nor `exact-identifier` drops by > 0.02 in hybrid/vector.
- **T4 (ops gates):** warm embed throughput **≥ 1/3 of e5** chunks/s (CPU); q8 download
  **≤ 1 GB**; stored dim **≤ 1024** (≤ ~2.7× e5 index size).

Policy gates (fixed before running, per suite orchestration):

- **License gate:** only a **permissively-licensed** candidate (MIT/Apache-2.0 → bge-m3
  here) can trigger a swap. EmbeddingGemma's weights are under the Gemma terms
  (use-restricted, not OSI) — if it is the only winner, the result is a recommendation +
  an ASK-ARTEM, **not** a swap.
- **MRL note (informational):** if gemma-256 is within 0.01 overall nDCG@10 of gemma-768,
  record that the 3× smaller index is essentially free.
- **Negatives flagged-rate is informational only:** the `lowConfidence` cosine floor
  (`semanticFloor` = 0.78) is calibrated to e5's score distribution; other models' cosine
  distributions differ, so this column is not comparable across models and is not a gate.
- Keyword-mode numbers may drift slightly between candidates even though FTS is
  embedder-independent: chunk boundaries follow the model's tokenizer (token-budgeted
  chunking), so the FTS rows differ. Expected noise, not signal.

## Candidates

| candidate | repo | dim | window | prefixes (query / passage) | pooling | dtype | license | download (q8) |
|-----------|------|-----|--------|---------------------------|---------|-------|---------|----------------|
| e5-small (baseline) | `Xenova/multilingual-e5-small` | 384 | 512 | `query: ` / `passage: ` | mean | q8 | MIT | ~118 MB (cached) |
| gemma-768 | `onnx-community/embeddinggemma-300m-ONNX` | 768 | 2048 | `task: search result \| query: ` / `title: none \| text: ` | baked-in (`sentence_embedding`) | q8 | **Gemma (use-restricted)** | ~309 MB + 20 MB tokenizer |
| gemma-256 | same, MRL truncate 768→256 + re-normalize | 256 | 2048 | same | baked-in | q8 | **Gemma (use-restricted)** | (same weights) |
| bge-m3 | `Xenova/bge-m3` | 1024 | 8192 | *(none — BAAI FAQ: no instructions needed)* | cls | q8 | MIT | ~570 MB + 17 MB tokenizer |

**Excluded — `nomic-embed-text-v2-moe`** (Apache-2.0, on paper the strongest cross-lingual
candidate and the one the prompt targeted at our RU gap): **unrunnable in this stack.**
The official `nomic-ai/nomic-embed-text-v2-moe` repo is sentence-transformers custom code
with **no ONNX export**; the only Hub "onnx" port (`keisuke-miyako/…-onnx-int8`) contains
just a README; and transformers.js 4.2.0's architecture registry has `nomic_bert` (v1/v1.5)
but **not the MoE variant** (verified in `node_modules/@huggingface/transformers/src/models/`,
2026-07-08). Exporting the custom MoE model to ONNX ourselves is out of scope.
**Excluded — `jina-v3`:** CC BY-NC license vs our MIT posture (per prompt).

Chunk token budget held at **512 for every candidate** regardless of window, so the bake-off
compares models, not chunk sizes (chunk-size × model interaction: arXiv 2505.21700).

## Results

All runs at git `eb21ff9` (the thresholds commit; only `ACTIVE_MODEL` switched between
runs), macOS Apple Silicon CPU, Node v24, transformers.js 4.2.0, q8 weights, reranker OFF.
Raw per-candidate reports committed alongside as `2026-07-08-eb21ff9-bakeoff-<candidate>.{md,json}`.

### Headline comparison — overall (negatives excluded), nDCG@10 / Hit@1

| candidate | hybrid | vector | keyword |
|-----------|--------|--------|---------|
| e5-small (baseline) | 0.8404 / 0.7727 | 0.8911 / 0.7500 | 0.8182 / 0.8182 |
| gemma-768 | 0.8487 / 0.7955 | **0.9832 / 0.9545** | 0.8182 / 0.8182 |
| gemma-256 | 0.8487 / 0.7955 | **0.9832 / 0.9545** | 0.8182 / 0.8182 |
| bge-m3 | 0.8404 / 0.7727 | **0.9802 / 0.9545** | 0.8182 / 0.8182 |

### RU-involved (the target axis), nDCG@10 / Hit@1

| candidate | hybrid | vector | cross-lingual kind (vector) |
|-----------|--------|--------|------------------------------|
| e5-small | 0.6302 / 0.5294 | 0.8385 / 0.6471 | 0.6568 |
| gemma-768 | **0.6302 / 0.5294** | 1.0000 / 1.0000 | 1.0000 |
| gemma-256 | **0.6302 / 0.5294** | 1.0000 / 1.0000 | 1.0000 |
| bge-m3 | **0.6302 / 0.5294** | 1.0000 / 1.0000 | 1.0000 |

**The headline finding is the bolded column: hybrid RU-involved is IDENTICAL (0.6302)
across all four models**, and `cross-lingual` in hybrid is 0.2142 in every run. Both
candidates rank the RU/cross-lingual answers PERFECTLY in vector mode (1.000), yet the
fused order doesn't move at all: unweighted RRF (k=60) lets the keyword half — which
scores 0 on cross-lingual by construction — drag the fused ranking to the same order
regardless of how good the vector half is. **The RU gap in the DEFAULT (hybrid) mode is a
fusion problem, not an embedder problem.** The levers for it already exist in the suite:
the weighted-RRF seam (prompt 06) and the shipped always-on reranker (D-011, disabled
here by design).

### Throughput / size

| candidate | warm chunks/s | × e5 | cold load (incl. download) | model cache on disk | fixture index | bytes/vector |
|-----------|---------------|------|----------------------------|----------------------|----------------|--------------|
| e5-small | 9.71 | 1.00 | (cached) | 129 MB | 320 KB | 1 536 |
| gemma-768 | 2.99 | 0.31 | 82.6 s | 326 MB | 389 KB | 3 072 |
| gemma-256 | 2.99 | 0.31 | (same weights) | 326 MB | 307 KB | 1 024 |
| bge-m3 | 3.18 | 0.33 | 257.9 s | 560 MB | 405 KB | 4 096 |

chunks/s is the warm whole-pipeline rate (tokenizer-budgeted chunking + embed + store) on
the 31-chunk fixture; model load excluded (measured separately by the harness). Chunk
counts differ by tokenizer (gemma: 30, e5/bge: 31) — expected, noted as noise up front.

### Gemma MRL 256 vs 768

Overall and RU aggregates are **identical to 4 decimals** (0.9832 / 1.0000 vector);
within-kind shuffles cancel (`semantic-paraphrase` 0.9769→1.0000, `exact-identifier`
0.9692→0.9385 in vector). Delta ≤ 0.01 → per the declared MRL note, the 3× smaller
vector (1 024 B vs 3 072 B) is essentially free at this corpus scale.

### Confidence-floor finding (informational, as pre-declared)

Vector-mode `maxScore` ranges: e5 positives 0.795–0.894 vs negatives 0.769–0.807
(overlapping — the 0.78 floor is a compromise); gemma-768 positives 0.312–0.606 vs
negatives 0.087–0.184; bge-m3 positives 0.410–0.655 vs negatives 0.336–0.432. Both
candidates' cosine scales sit entirely BELOW the e5-calibrated `semanticFloor` (0.78) —
hence "negatives flagged 1.00" (every result set flags low-confidence) — but they
*separate* negatives from positives better than e5 (gemma: zero overlap). A swap would
force a per-model floor recalibration; today the floor is one global config default.

### Caveats

- 15-book / 50-query fixture: one rank flip ≈ 0.02 nDCG overall. The candidates'
  vector gains (+0.09 overall, +0.16 RU, +0.20 Hit@1) are far above that noise floor,
  but gemma-vs-bge differences (≤ 0.003) are not — and both saturate the RU set (1.000),
  so this corpus cannot rank them against each other.
- Throughput ratios include per-model tokenizer cost in chunking, not just the forward
  pass; that is the honest whole-pipeline number the indexer pays.

## Threshold verdict

| gate | gemma-768 / gemma-256 | bge-m3 |
|------|------------------------|--------|
| T1 RU ≥ +0.05 in hybrid AND vector | ✗ — vector +0.16 ✓, **hybrid +0.00 ✗** | ✗ — same |
| T2 cross-lingual vector ≥ +0.05 | ✓ (+0.34) | ✓ (+0.34) |
| T3 EN non-regression (≤0.01 overall / ≤0.02 per-kind) | ✗ — `exact-identifier` hybrid 1.0000→0.9692 (−0.031) | ✗ — same (−0.031) |
| T4 ops (throughput ≥ ⅓ e5, ≤1 GB, dim ≤1024) | ✗ — 0.31 < ⅓ | ✗ (marginal) — 0.33 < ⅓; download/dim pass |
| License gate (MIT/Apache only) | ✗ — Gemma terms (use-restricted) | ✓ — MIT |

## Decision

**Keep `multilingual-e5-small` (D-012 reaffirms D-001/D-010). No swap.** No candidate
clears the pre-declared thresholds: both fail T1 on the hybrid half (the mode users
actually get by default), T3 on the `exact-identifier` hybrid regression, and T4 on
CPU throughput; EmbeddingGemma additionally fails the license gate. `INDEX_VERSION`
stays 3; `ACTIVE_MODEL` stays `e5-small`.

What the bake-off actually bought:

1. **The RU/cross-lingual gap in hybrid mode will not be fixed by a better embedder.**
   Candidates that are *perfect* on the vector half leave hybrid RU at exactly 0.6302.
   Next lever: tune the weighted-RRF knob (landed with prompt 06) toward the vector half
   for high-vector-confidence queries, and re-measure with the reranker ON (D-011 exists
   precisely to recover fused-order precision).
2. **If a swap is ever revisited** (e.g. after fusion tuning moves the hybrid ceiling and
   the embedder becomes the binding constraint): `bge-m3` is the only license-eligible
   candidate (MIT) — costs ~3× embed time, 2.7× vector bytes, a 570 MB download, and a
   `semanticFloor` recalibration. Technically, `gemma-256` is the sweeter spot (RU 1.000
   at 1 024 B/vector, 326 MB, MRL-free truncation — measured here via the `rawDim`
   truncate-and-renormalize path) but its weights are under the use-restricted Gemma
   terms — whether that is acceptable for a *user-downloaded optional model* is Artem's
   call (ASK-ARTEM, INDEX.md prompt-05 flag), and per policy it cannot trigger a swap
   regardless of scores.
3. The embedder is now **parameterized over a cited candidate table**
   (`src/semantic/model.ts` CANDIDATES): rerunning this bake-off after fusion tuning is
   a one-line `ACTIVE_MODEL` switch + `pnpm eval --rerank off` per candidate.

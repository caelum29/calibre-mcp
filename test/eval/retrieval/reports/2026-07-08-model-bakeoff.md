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

_(filled in after the runs below — per-candidate raw reports are committed alongside as
`2026-07-08-<sha>-bakeoff-<candidate>.{md,json}`)_

### Headline comparison

TBD

### Throughput / size

TBD

### Gemma MRL 256 vs 768

TBD

## Decision

TBD

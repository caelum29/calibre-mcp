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
chunk sizes) is guesswork without labels. This harness runs 50 labeled golden queries over
a committed fixture corpus through the REAL pipeline — `calibre_build_index`'s
chunk→embed→store path, then the real `calibre_semantic_search` handler per mode
(hybrid / vector / keyword) — and scores Hit@1, Recall@5, MRR, nDCG@10 per kind and overall.

```
pnpm eval                      # offline, deterministic; writes reports/<date>-<sha>.{md,json}
pnpm eval --tag baseline       # label the report filename
pnpm eval --modes hybrid       # subset of modes
pnpm eval --live               # UNVERIFIED spot check against the real library index (skip in CI)
pnpm eval --rerank off         # disable the shipped D-011 rerank stage (on by default)
```

### Layout

- `queries.json` — 50 golden queries `{ id, kind, scope, query, ru?, relevant }`. Kinds:
  `semantic-paraphrase`, `exact-identifier`, `cross-lingual` (RU↔EN), `ru-monolingual`,
  `negative` (no right answer exists — measures the low-confidence signal). 19/50 are
  RU-involved (`ru: true`): RU is the known weak axis (memory: "RU=0 chapters=RU-gap")
  and is first-class here, not an afterthought. `scope: "book"` queries label relevant
  passages as char spans + a `marker` substring (the harness fails loudly if a fixture
  edit invalidates a span).
- `corpus/` + `corpus.json` — 15 self-authored fixture "books" (10 EN incl. 2 code-heavy,
  5 RU), committed as text; **embeddings are built at eval time** (decision: committing a
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
- `hash-embedder.ts` + `harness.test.ts` — model-free smoke tests that run in the normal
  `pnpm test` suite (seconds): plumbing, query-set contract, determinism, and the
  "deliberately broken ranking degrades the metrics" proof that the harness measures.

### Rules

- `pnpm eval` is NOT part of `pnpm test` (it needs the embedding model and real minutes);
  the smoke tests are.
- Offline determinism: fixed model (`Xenova/multilingual-e5-small` q8), no network after
  the first model download, identical JSON on re-run.
- Reports are committed. Baseline first, then one report per tuning change, so every
  fusion/reranker/model decision cites numbers, not vibes.

# Retrieval eval — 2026-07-08-909afb4-spotcheck-live

Model `Xenova/multilingual-e5-small` · index v2 · corpus 3 books / 3641 chunks · 9 queries (3 RU-involved) · topK=10 · rerank: n/a (no reranker in this build) · git 909afb4

> **LIVE MODE — labels are UNVERIFIED** until Artem confirms them. Not a CI artifact.

## Headline

- **hybrid**: overall nDCG@10 **0.7103** / Hit@1 0.3333 — RU-involved nDCG@10 **0.6309** / Hit@1 0 (RU gap 0.0794) — negatives flagged 0
- **vector**: overall nDCG@10 **0.5436** / Hit@1 0.3333 — RU-involved nDCG@10 **0.6309** / Hit@1 0 (RU gap -0.0873) — negatives flagged 0
- **keyword**: overall nDCG@10 **0.6667** / Hit@1 0.6667 — RU-involved nDCG@10 **0** / Hit@1 0 (RU gap 0.6667) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.6309)
- weakest kind in vector: **semantic-paraphrase** (nDCG@10 0.5)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 3 | 0.3333 | 1 | 0.6111 | 0.7103 |
| vector | 3 | 0.3333 | 0.6667 | 0.5 | 0.5436 |
| keyword | 3 | 0.6667 | 0.6667 | 0.6667 | 0.6667 |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 1 | 0 | 1 | 0.5 | 0.6309 |
| vector | 1 | 0 | 1 | 0.5 | 0.6309 |
| keyword | 1 | 0 | 0 | 0 | 0 |

## By kind

### semantic-paraphrase

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 2 | 0.5 | 1 | 0.6667 | 0.75 |
| vector | 2 | 0.5 | 0.5 | 0.5 | 0.5 |
| keyword | 2 | 1 | 1 | 1 | 1 |

### cross-lingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 1 | 0 | 1 | 0.5 | 0.6309 |
| vector | 1 | 0 | 1 | 0.5 | 0.6309 |
| keyword | 1 | 0 | 0 | 0 | 0 |

## Negatives (no relevant answer exists — low-confidence signal)

| mode | n | flagged rate |
|------|---|--------------|
| hybrid | 6 | 0 |
| vector | 6 | 0 |
| keyword | 6 | 0 |

`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.

## Per-query

### mode=hybrid

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-02 | semantic-paraphrase | library |  | 0 | 1 | 0.3333 | 0.5 | 0.8307 | 889, 187, 2 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8815 | 889, 187, 2 |
| xl-04 | cross-lingual | library | ✓ | 0 | 1 | 0.5 | 0.6309 | 0.8559 | 187, 889 |
| neg-01 | negative | library |  | — | — | — | NOT flagged | 0.8001 | 889, 187, 2 |
| neg-02 | negative | library |  | — | — | — | NOT flagged | 0.8165 | 889, 187, 2 |
| neg-03 | negative | library |  | — | — | — | NOT flagged | 0.8288 | 889, 2, 187 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged | 0.8114 | 187, 889 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged | 0.8099 | 187, 889 |
| neg-06 | negative | library |  | — | — | — | NOT flagged | 0.8226 | 889, 187, 2 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-02 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8307 | 889, 187 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8815 | 889, 187 |
| xl-04 | cross-lingual | library | ✓ | 0 | 1 | 0.5 | 0.6309 | 0.8559 | 187, 889 |
| neg-01 | negative | library |  | — | — | — | NOT flagged | 0.8001 | 889, 187 |
| neg-02 | negative | library |  | — | — | — | NOT flagged | 0.8165 | 889, 187 |
| neg-03 | negative | library |  | — | — | — | NOT flagged | 0.8288 | 889, 187 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged | 0.8114 | 187, 889 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged | 0.8099 | 187, 889 |
| neg-06 | negative | library |  | — | — | — | NOT flagged | 0.8226 | 889, 187 |

### mode=keyword

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 2, 187, 889 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 889, 2 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 187 |
| neg-01 | negative | library |  | — | — | — | NOT flagged |  | 889, 2 |
| neg-02 | negative | library |  | — | — | — | NOT flagged |  | 889, 2 |
| neg-03 | negative | library |  | — | — | — | NOT flagged |  | 2, 889 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged |  | 187 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged |  | 187 |
| neg-06 | negative | library |  | — | — | — | NOT flagged |  | 889, 187, 2 |


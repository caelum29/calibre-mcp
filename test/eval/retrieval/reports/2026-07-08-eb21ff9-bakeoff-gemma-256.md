# Retrieval eval — 2026-07-08-eb21ff9-bakeoff-gemma-256

Model `onnx-community/embeddinggemma-300m-ONNX` · index v3 · corpus 15 books / 30 chunks · 50 queries (19 RU-involved) · topK=10 · rerank: off (0 reranked rows) · git eb21ff9

## Headline

- **hybrid**: overall nDCG@10 **0.8487** / Hit@1 0.7955 — RU-involved nDCG@10 **0.6302** / Hit@1 0.5294 (RU gap 0.2185) — negatives flagged 1
- **vector**: overall nDCG@10 **0.9832** / Hit@1 0.9545 — RU-involved nDCG@10 **1** / Hit@1 1 (RU gap -0.0168) — negatives flagged 1
- **keyword**: overall nDCG@10 **0.8182** / Hit@1 0.8182 — RU-involved nDCG@10 **0.5294** / Hit@1 0.5294 (RU gap 0.2888) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.2142)
- weakest kind in vector: **exact-identifier** (nDCG@10 0.9385)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 44 | 0.7955 | 0.8182 | 0.8242 | 0.8487 |
| vector | 44 | 0.9545 | 1 | 0.9773 | 0.9832 |
| keyword | 44 | 0.8182 | 0.8182 | 0.8182 | 0.8182 |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 17 | 0.5294 | 0.5294 | 0.5745 | 0.6302 |
| vector | 17 | 1 | 1 | 1 | 1 |
| keyword | 17 | 0.5294 | 0.5294 | 0.5294 | 0.5294 |

## By kind

### semantic-paraphrase

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 16 | 1 | 1 | 1 | 1 |
| vector | 16 | 1 | 1 | 1 | 1 |
| keyword | 16 | 1 | 1 | 1 | 1 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 12 | 0.9167 | 1 | 0.9583 | 0.9692 |
| vector | 12 | 0.8333 | 1 | 0.9167 | 0.9385 |
| keyword | 12 | 1 | 1 | 1 | 1 |

### cross-lingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 8 | 0 | 0 | 0.0958 | 0.2142 |
| vector | 8 | 1 | 1 | 1 | 1 |
| keyword | 8 | 0 | 0 | 0 | 0 |

### ru-monolingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 8 | 1 | 1 | 1 | 1 |
| vector | 8 | 1 | 1 | 1 | 1 |
| keyword | 8 | 1 | 1 | 1 | 1 |

## Negatives (no relevant answer exists — low-confidence signal)

| mode | n | flagged rate |
|------|---|--------------|
| hybrid | 6 | 1 |
| vector | 6 | 1 |
| keyword | 6 | 0 |

`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.

## Per-query

### mode=hybrid

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4504 | 101, 103, 107 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5764 | 102, 107, 103 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5661 | 103, 102, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4562 | 104, 110, 106 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4212 | 105, 106, 109 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5362 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5402 | 107, 101, 110 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5924 | 108, 105, 101 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5325 | 109, 110, 103 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5521 | 110, 107, 102 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4301 | 101, 107, 106 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4998 | 104, 105, 107 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4966 | 106, 105, 109 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5579 | 103, 109, 107 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4037 | @0-2002, @2002-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4782 | @0-2115, @2115-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4261 | 109, 106, 101 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.687 | 110, 109, 101 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5847 | 107, 102, 104 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4888 | 105, 106, 107 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4358 | 107, 110, 101 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5994 | 106, 101, 105 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5718 | 101, 110, 106 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.4167 | 111, 105, 106 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3542 | 105, 106, 107 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5598 | 110, 106, 109 |
| idb-01 | exact-identifier | book |  | 0 | 1 | 0.5 | 0.6309 | 0.547 | @1872-2692, @0-1872 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.3288 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.548 | 112, 114, 113 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.4835 | 114, 112, 115 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5564 | 114, 111, 115 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5351 | 115, 113, 112 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.2759 | 108, 106, 109 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.2447 | 108, 102, 109 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.0932 | 105, 106, 102 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0.1 | 0.2891 | 0.41 | 103, 107, 106 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5268 | 112, 115, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5901 | 111, 115, 114 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.572 | 114, 112, 115 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.604 | 113, 115, 112 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6275 | 114, 112, 113 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.354 | 115, 113, 114 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4614 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4712 | @1117-2795, @0-1117 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.2538 | 105, 101, 108 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.2671 | 104, 106, 105 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.1772 | 106, 105, 104 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.2619 | 112, 111, 113 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.2179 | 113, 115, 110 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.21 | 107, 101, 102 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4504 | 101, 106, 103 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5764 | 102, 107, 109 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5661 | 103, 109, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4562 | 104, 106, 109 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4212 | 105, 106, 109 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5362 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5402 | 107, 101, 106 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5924 | 108, 105, 107 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5325 | 109, 110, 106 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5521 | 110, 107, 101 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4301 | 101, 106, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4998 | 104, 106, 103 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4966 | 106, 110, 103 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5579 | 103, 109, 107 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4037 | @0-2002, @2002-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4782 | @0-2115, @2115-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4261 | 109, 106, 101 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.687 | 110, 109, 101 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5847 | 107, 102, 101 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4888 | 105, 106, 107 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4358 | 107, 102, 106 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5994 | 106, 101, 105 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5718 | 101, 110, 106 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.4167 | 111, 105, 101 |
| id-09 | exact-identifier | library |  | 0 | 1 | 0.5 | 0.6309 | 0.3542 | 106, 105, 107 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5598 | 110, 106, 109 |
| idb-01 | exact-identifier | book |  | 0 | 1 | 0.5 | 0.6309 | 0.547 | @1872-2692, @0-1872 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.3288 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.548 | 108, 112, 105 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4835 | 101, 114, 110 |
| xl-03 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5564 | 105, 101, 106 |
| xl-04 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5351 | 109, 103, 106 |
| xl-05 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4793 | 113, 109, 108 |
| xl-06 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5396 | 112, 110, 108 |
| xl-07 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5305 | 111, 105, 102 |
| xl-08 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.41 | 115, 107, 103 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5268 | 112, 110, 108 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5901 | 111, 105, 104 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.572 | 114, 101, 105 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.604 | 113, 110, 115 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6275 | 114, 112, 110 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.354 | 115, 103, 107 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4614 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4712 | @1117-2795, @0-1117 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.2538 | 101, 107, 105 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.2671 | 104, 106, 101 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.1772 | 103, 109, 107 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.2619 | 108, 104, 112 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.2179 | 110, 108, 112 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.21 | 102, 110, 107 |

### mode=keyword

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 107, 103 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 102, 107, 105 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 102, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 102, 110 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 105, 106, 110 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 107, 105, 110 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 108, 106, 101 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 109, 103, 110 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 110, 104, 102 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 107, 102 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 105, 107 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 105, 109 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 104, 109 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @0-2002, @2002-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @0-2115, @2115-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 109 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 109, 104 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 104, 103 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 106 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 101, 110 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 109, 110 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @0-1872, @1872-2692 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @1430-2604 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 114, 115 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 115, 112 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 113, 112 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 115, 112 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 108, 107, 103 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 102, 107, 106 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 106, 105, 109 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 103, 106, 101 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 112, 113, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 115, 113 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 112, 113 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 113, 115, 112 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 113, 112 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 115, 113, 111 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @1117-2795, @0-1117 |
| neg-01 | negative | library |  | — | — | — | NOT flagged |  | 110, 103, 105 |
| neg-02 | negative | library |  | — | — | — | NOT flagged |  | 104, 106, 109 |
| neg-03 | negative | library |  | — | — | — | NOT flagged |  | 106, 105, 104 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged |  | 111, 115, 113 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged |  | 113, 115 |
| neg-06 | negative | library |  | — | — | — | NOT flagged |  | 101, 106, 104 |


# Retrieval eval — 2026-07-08-eb21ff9-bakeoff-gemma-768

Model `onnx-community/embeddinggemma-300m-ONNX` · index v3 · corpus 15 books / 30 chunks · 50 queries (19 RU-involved) · topK=10 · rerank: off (0 reranked rows) · git eb21ff9

## Headline

- **hybrid**: overall nDCG@10 **0.8487** / Hit@1 0.7955 — RU-involved nDCG@10 **0.6302** / Hit@1 0.5294 (RU gap 0.2185) — negatives flagged 1
- **vector**: overall nDCG@10 **0.9832** / Hit@1 0.9545 — RU-involved nDCG@10 **1** / Hit@1 1 (RU gap -0.0168) — negatives flagged 1
- **keyword**: overall nDCG@10 **0.8182** / Hit@1 0.8182 — RU-involved nDCG@10 **0.5294** / Hit@1 0.5294 (RU gap 0.2888) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.2142)
- weakest kind in vector: **exact-identifier** (nDCG@10 0.9692)
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
| vector | 16 | 0.9375 | 1 | 0.9688 | 0.9769 |
| keyword | 16 | 1 | 1 | 1 | 1 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 12 | 0.9167 | 1 | 0.9583 | 0.9692 |
| vector | 12 | 0.9167 | 1 | 0.9583 | 0.9692 |
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
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.436 | 101, 106, 103 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5585 | 102, 107, 105 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5501 | 103, 107, 102 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4111 | 104, 106, 110 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.3197 | 105, 102, 106 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4946 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4759 | 107, 105, 101 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5352 | 108, 101, 105 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4455 | 109, 110, 103 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4897 | 110, 102, 104 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.3607 | 101, 107, 106 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.445 | 104, 107, 105 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4439 | 106, 107, 109 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5545 | 103, 109, 107 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.3187 | @0-2002, @2002-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.431 | @0-2115, @2115-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3895 | 109, 101, 103 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.6063 | 110, 109, 103 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5123 | 107, 102, 104 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4435 | 105, 106, 101 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3287 | 107, 104, 101 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5759 | 106, 101, 105 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4445 | 101, 110, 106 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.3413 | 111, 105, 106 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3122 | 105, 106, 101 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4612 | 110, 106, 109 |
| idb-01 | exact-identifier | book |  | 0 | 1 | 0.5 | 0.6309 | 0.4455 | @1872-2692, @0-1872 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.324 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5341 | 113, 112, 111 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.4232 | 114, 115, 112 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.4672 | 111, 115, 114 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.4628 | 115, 113, 114 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.2016 | 103, 106, 108 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.1276 | 108, 109, 102 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.0413 | 105, 106, 102 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0.1 | 0.2891 | 0.3905 | 103, 107, 106 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5357 | 112, 113, 115 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5654 | 111, 115, 113 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5352 | 114, 112, 113 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5884 | 113, 115, 112 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6045 | 114, 112, 113 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.403 | 115, 114, 113 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4134 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4132 | @1117-2795, @0-1117 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.1636 | 110, 101, 103 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.1497 | 104, 106, 101 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.0868 | 106, 104, 105 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.1462 | 111, 113, 112 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.184 | 115, 113, 110 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.132 | 101, 105, 107 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.436 | 101, 106, 105 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5585 | 102, 110, 109 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5501 | 103, 109, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4111 | 104, 106, 103 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.3197 | 105, 101, 102 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4946 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4759 | 107, 106, 101 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5352 | 108, 105, 101 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4455 | 109, 110, 103 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4897 | 110, 102, 101 |
| sp-11 | semantic-paraphrase | library |  | 0 | 1 | 0.5 | 0.6309 | 0.3607 | 106, 101, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.445 | 104, 107, 105 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4439 | 106, 110, 107 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5545 | 103, 109, 107 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.3187 | @0-2002, @2002-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.431 | @0-2115, @2115-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3895 | 109, 101, 103 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.6063 | 110, 109, 103 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5123 | 107, 102, 101 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4435 | 105, 106, 101 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3287 | 107, 106, 102 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5759 | 106, 101, 105 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4445 | 101, 106, 110 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.3413 | 111, 105, 112 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.3122 | 105, 106, 101 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4612 | 110, 106, 109 |
| idb-01 | exact-identifier | book |  | 0 | 1 | 0.5 | 0.6309 | 0.4455 | @1872-2692, @0-1872 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.324 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5341 | 108, 112, 105 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4232 | 101, 114, 106 |
| xl-03 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4672 | 105, 101, 106 |
| xl-04 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4628 | 109, 103, 110 |
| xl-05 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4175 | 113, 101, 109 |
| xl-06 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5385 | 112, 108, 109 |
| xl-07 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.524 | 111, 105, 108 |
| xl-08 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.3905 | 115, 107, 103 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5357 | 112, 110, 103 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5654 | 111, 105, 104 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5352 | 114, 101, 110 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5884 | 113, 110, 106 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6045 | 114, 106, 115 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.403 | 115, 106, 110 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4134 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4132 | @1117-2795, @0-1117 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.1636 | 101, 107, 109 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.1497 | 104, 101, 108 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.0868 | 109, 104, 103 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.1462 | 108, 104, 105 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.184 | 110, 108, 112 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.132 | 110, 105, 101 |

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


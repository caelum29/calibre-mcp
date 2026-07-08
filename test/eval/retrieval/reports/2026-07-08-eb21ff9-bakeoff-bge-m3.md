# Retrieval eval — 2026-07-08-eb21ff9-bakeoff-bge-m3

Model `Xenova/bge-m3` · index v3 · corpus 15 books / 31 chunks · 50 queries (19 RU-involved) · topK=10 · rerank: off (0 reranked rows) · git eb21ff9

## Headline

- **hybrid**: overall nDCG@10 **0.8404** / Hit@1 0.7727 — RU-involved nDCG@10 **0.6302** / Hit@1 0.5294 (RU gap 0.2102) — negatives flagged 1
- **vector**: overall nDCG@10 **0.9802** / Hit@1 0.9545 — RU-involved nDCG@10 **1** / Hit@1 1 (RU gap -0.0198) — negatives flagged 1
- **keyword**: overall nDCG@10 **0.8182** / Hit@1 0.8182 — RU-involved nDCG@10 **0.5294** / Hit@1 0.5294 (RU gap 0.2888) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.2142)
- weakest kind in vector: **exact-identifier** (nDCG@10 0.9583)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 44 | 0.7727 | 0.8182 | 0.8129 | 0.8404 |
| vector | 44 | 0.9545 | 1 | 0.9735 | 0.9802 |
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
| hybrid | 16 | 0.9375 | 1 | 0.9688 | 0.9769 |
| vector | 16 | 0.9375 | 1 | 0.9688 | 0.9769 |
| keyword | 16 | 1 | 1 | 1 | 1 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 12 | 0.9167 | 1 | 0.9583 | 0.9692 |
| vector | 12 | 0.9167 | 1 | 0.9444 | 0.9583 |
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
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4806 | 101, 107, 103 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6424 | 102, 107, 101 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6398 | 103, 107, 102 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5927 | 104, 108, 105 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5006 | 105, 106, 102 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5035 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5447 | 107, 105, 110 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6551 | 108, 105, 103 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5759 | 109, 110, 103 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5973 | 110, 102, 101 |
| sp-11 | semantic-paraphrase | library |  | 0 | 1 | 0.5 | 0.6309 | 0.4632 | 106, 101, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6089 | 104, 105, 107 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.466 | 106, 109, 105 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6248 | 103, 109, 105 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4713 | @0-1526, @1526-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.5577 | @1048-2686, @0-1048 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5787 | 109, 105, 107 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5423 | 110, 115, 105 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5788 | 107, 110, 102 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4226 | 105, 110, 107 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4429 | 107, 110, 103 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.628 | 106, 102, 107 |
| id-07 | exact-identifier | library |  | 0 | 1 | 0.5 | 0.6309 | 0.5148 | 110, 101, 106 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.4602 | 111, 109, 105 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4395 | 105, 110, 104 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5262 | 110, 109, 103 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.4981 | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.5082 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5262 | 112, 113, 114 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5872 | 114, 112, 115 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5976 | 115, 113, 114 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.5666 | 115, 113, 114 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.4229 | 103, 108, 109 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.3524 | 102, 108, 104 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.3398 | 105, 110, 102 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0.1 | 0.2891 | 0.5263 | 106, 103, 110 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5292 | 112, 114, 115 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6467 | 111, 113, 115 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6194 | 114, 113, 115 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.525 | 113, 111, 114 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6331 | 114, 112, 113 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6313 | 115, 114, 113 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.5504 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4828 | @0-1816, @1816-2795 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.3505 | 110, 108, 105 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.4204 | 104, 109, 108 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.3673 | 105, 106, 104 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.4318 | 112, 113, 111 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.3362 | 113, 115, 109 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.294 | 101, 104, 109 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.4806 | 101, 107, 114 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6424 | 102, 110, 101 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6398 | 103, 109, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5927 | 104, 103, 109 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5006 | 105, 115, 106 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5035 | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5447 | 107, 101, 106 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6551 | 108, 105, 110 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5759 | 109, 110, 104 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.5973 | 110, 102, 101 |
| sp-11 | semantic-paraphrase | library |  | 0 | 1 | 0.5 | 0.6309 | 0.4632 | 106, 101, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6089 | 104, 105, 103 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.466 | 106, 109, 102 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.6248 | 103, 105, 109 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.4713 | @0-1526, @1526-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.5577 | @1048-2686, @0-1048 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5787 | 109, 105, 107 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5423 | 110, 115, 105 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5788 | 107, 110, 102 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4226 | 105, 110, 107 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4429 | 107, 102, 110 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.628 | 106, 102, 107 |
| id-07 | exact-identifier | library |  | 0 | 1 | 0.3333 | 0.5 | 0.5148 | 110, 106, 101 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.4602 | 111, 105, 109 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.4395 | 105, 110, 104 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.5262 | 110, 109, 103 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.4981 | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.5082 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5262 | 108, 103, 112 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5872 | 101, 104, 110 |
| xl-03 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5976 | 105, 106, 102 |
| xl-04 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5666 | 109, 110, 103 |
| xl-05 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5515 | 113, 109, 110 |
| xl-06 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.4099 | 112, 106, 108 |
| xl-07 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6198 | 111, 105, 108 |
| xl-08 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5263 | 115, 106, 110 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.5292 | 112, 108, 102 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6467 | 111, 105, 113 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6194 | 114, 110, 104 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.525 | 113, 111, 109 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6331 | 114, 110, 104 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.6313 | 115, 107, 110 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.5504 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.4828 | @0-1816, @1816-2795 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.3809 | 113, 108, 110 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.4204 | 104, 108, 114 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.3673 | 110, 103, 105 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.4318 | 108, 105, 112 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.3362 | 109, 108, 112 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.3388 | 114, 110, 113 |

### mode=keyword

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 107, 103 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 102, 107, 105 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 102, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 102, 108 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 105, 106, 110 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 107, 105 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 107, 105, 110 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 108, 106, 101 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 109, 103, 101 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 110, 102, 104 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 106, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 105, 107 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 105, 109 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 104, 106 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @0-1526, @1526-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @1048-2686, @0-1048 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 109 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 109, 110 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 104, 103 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 106 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 101, 110 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 109, 110 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @1430-2604 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 114, 111 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 112, 115 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 113, 112 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 115, 112 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 108, 107, 103 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 102, 107, 108 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 106, 105, 109 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 103, 106, 101 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 112, 113, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 115, 113 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 112, 113 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 113, 115, 112 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 113, 112 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 115, 113, 111 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @0-1816, @1816-2795 |
| neg-01 | negative | library |  | — | — | — | NOT flagged |  | 110, 103, 105 |
| neg-02 | negative | library |  | — | — | — | NOT flagged |  | 104, 106, 109 |
| neg-03 | negative | library |  | — | — | — | NOT flagged |  | 105, 106, 104 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged |  | 111, 113, 115 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged |  | 115, 113 |
| neg-06 | negative | library |  | — | — | — | NOT flagged |  | 101, 107, 104 |


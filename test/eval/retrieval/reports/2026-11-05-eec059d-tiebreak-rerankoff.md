# Retrieval eval — 2026-11-05-eec059d-tiebreak-rerankoff

Model `Xenova/multilingual-e5-small` · index v4 · corpus 17 books / 43 chunks · 68 queries (24 RU-involved) · topK=10 · rerank: off (0 reranked rows) · git eec059d

## Headline

- **hybrid**: overall nDCG@10 **0.8572** / Hit@1 0.7966 — RU-involved nDCG@10 **0.6339** / Hit@1 0.5238 (RU gap 0.2233) — negatives flagged 0.5
- **vector**: overall nDCG@10 **0.9056** / Hit@1 0.7966 — RU-involved nDCG@10 **0.8419** / Hit@1 0.6667 (RU gap 0.0637) — negatives flagged 0.5
- **keyword**: overall nDCG@10 **0.818** / Hit@1 0.7966 — RU-involved nDCG@10 **0.5238** / Hit@1 0.5238 (RU gap 0.2942) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.1781)
- weakest kind in vector: **cross-lingual** (nDCG@10 0.6475)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 59 | 0.7966 | 0.8644 | 0.8339 | 0.8572 |
| vector | 59 | 0.7966 | 0.9661 | 0.8743 | 0.9056 |
| keyword | 59 | 0.7966 | 0.8305 | 0.8136 | 0.818 |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 21 | 0.5238 | 0.619 | 0.581 | 0.6339 |
| vector | 21 | 0.6667 | 0.9524 | 0.7897 | 0.8419 |
| keyword | 21 | 0.5238 | 0.5238 | 0.5238 | 0.5238 |

## By kind

### semantic-paraphrase

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 16 | 0.9375 | 1 | 0.9688 | 0.9769 |
| vector | 16 | 0.875 | 1 | 0.9375 | 0.9539 |
| keyword | 16 | 1 | 1 | 1 | 1 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 12 | 1 | 1 | 1 | 1 |
| vector | 12 | 0.8333 | 0.9167 | 0.875 | 0.9047 |
| keyword | 12 | 1 | 1 | 1 | 1 |

### cross-lingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 8 | 0 | 0 | 0.0833 | 0.1781 |
| vector | 8 | 0.25 | 0.875 | 0.5312 | 0.6475 |
| keyword | 8 | 0 | 0 | 0 | 0 |

### ru-monolingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 8 | 1 | 1 | 1 | 1 |
| vector | 8 | 1 | 1 | 1 | 1 |
| keyword | 8 | 1 | 1 | 1 | 1 |

### front-matter-trap

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 6 | 0.8333 | 1 | 0.9167 | 0.9385 |
| vector | 6 | 0.8333 | 1 | 0.9167 | 0.9385 |
| keyword | 6 | 0.6667 | 1 | 0.8333 | 0.877 |

### figure-caption

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 9 | 0.7778 | 1 | 0.837 | 0.8763 |
| vector | 9 | 0.8889 | 1 | 0.9259 | 0.9444 |
| keyword | 9 | 0.7778 | 0.7778 | 0.7778 | 0.7778 |

## Negatives (no relevant answer exists — low-confidence signal)

| mode | n | flagged rate |
|------|---|--------------|
| hybrid | 6 | 0.5 |
| vector | 6 | 0.5 |
| keyword | 6 | 0 |

### Figure negatives (target=figures; gate inactive until the figures floor is calibrated)

| mode | n | flagged rate |
|------|---|--------------|
| hybrid | 3 | 0 |
| vector | 3 | 0 |
| keyword | 3 | 0.3333 |

`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.

## Per-query

### mode=hybrid

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8379 | 101, 116, 117 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8871 | 102, 107, 117 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8712 | 103, 117, 106 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8619 | 104, 117, 116 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8363 | 105, 110, 116 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8697 | 106, 105, 107 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.85 | 107, 110, 105 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.872 | 108, 117, 106 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8591 | 109, 103, 116 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8571 | 110, 116, 117 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8507 | 101, 106, 116 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8937 | 104, 105, 117 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8484 | 106, 116, 117 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.892 | 103, 106, 117 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 | 0.8579 | @0-1526, @1526-2851 |
| spb-02 | semantic-paraphrase | book |  | 0 | 1 | 0.5 | 0.6309 | 0.8697 | @0-1048, @1048-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8644 | 109, 116, 101 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8711 | 110, 116, 117 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8423 | 107, 117, 102 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8206 | 105, 116, 107 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8281 | 107, 103, 116 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8617 | 106, 110, 107 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8461 | 101, 110, 117 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.8063 | 111, 105, 113 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8115 | 105, 117, 104 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8625 | 110, 109, 107 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.831 | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.8628 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.8202 | 113, 112, 114 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.8262 | 114, 115, 113 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.8307 | 114, 113, 115 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.817 | 115, 113, 112 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.8111 | 116, 108, 117 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.8077 | 117, 116, 108 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.8015 | 117, 116, 106 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 | 0.832 | 117, 103, 107 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8668 | 112, 113, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8957 | 111, 113, 115 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8735 | 114, 112, 115 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8567 | 113, 115, 111 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8773 | 114, 113, 112 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8735 | 115, 113, 114 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.8361 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.8399 | @0-1816, @1816-2795 |
| fmt-01 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8943 | @3677-5459, @5459-7523, @1906-3677 |
| fmt-02 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8733 | @1906-3677, @3677-5459, @5459-7523 |
| fmt-03 | front-matter-trap | book |  | 0 | 1 | 0.5 | 0.6309 | 0.8654 | @7523-8331, @5459-7523, @1906-3677 |
| fmt-04 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8779 | @1963-4009, @4009-5688, @8926-10847 |
| fmt-05 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8899 | @6994-8926, @8926-10847, @4009-5688 |
| fmt-06 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8707 | @10847-12407, @8926-10847, @4009-5688 |
| neg-01 | negative | library |  | — | — | — | NOT flagged | 0.7885 | 116, 117, 108 |
| neg-02 | negative | library |  | — | — | — | NOT flagged | 0.8 | 104, 117, 106 |
| neg-03 | negative | library |  | — | — | — | NOT flagged | 0.8141 | 117, 106, 116 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.7709 | 111, 113, 115 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.7791 | 115, 113, 112 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.7733 | 116, 117, 107 |
| fig-01 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.9037 | fig-103#0, fig-103#1, fig-105#0 |
| fig-02 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8884 | fig-103#1, fig-103#0, fig-106#0 |
| fig-03 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8928 | fig-105#0, fig-105#1, fig-103#0 |
| fig-04 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.898 | fig-106#0, fig-103#0, fig-105#0 |
| fig-05 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8716 | fig-108#0, fig-105#0, fig-103#0 |
| fig-ru-01 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 | 0.8983 | fig-112#0, fig-113#0, fig-113#1 |
| fig-ru-02 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 | 0.8856 | fig-113#0, fig-113#1, fig-112#0 |
| fig-xl-01 | figure-caption | library | ✓ | 0 | 1 | 0.3333 | 0.5 | 0.7973 | fig-105#1, fig-112#0, fig-105#0 |
| fig-xl-02 | figure-caption | library | ✓ | 0 | 1 | 0.2 | 0.3869 | 0.842 | fig-103#0, fig-106#0, fig-103#1 |
| figneg-01 | figure-negative | library |  | — | — | — | NOT flagged | 0.7927 | fig-108#0, fig-105#0, fig-103#0 |
| figneg-02 | figure-negative | library |  | — | — | — | NOT flagged | 0.7749 | fig-108#0, fig-103#0, fig-105#0 |
| figneg-03 | figure-negative | library | ✓ | — | — | — | NOT flagged | 0.8054 | fig-112#0, fig-113#1, fig-113#0 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8379 | 101, 107, 116 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8871 | 102, 117, 107 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8712 | 103, 117, 104 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8619 | 104, 117, 116 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8363 | 105, 117, 116 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8697 | 106, 105, 101 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.85 | 107, 106, 101 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.872 | 108, 117, 107 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8591 | 109, 103, 116 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8571 | 110, 116, 106 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8507 | 101, 116, 106 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8937 | 104, 117, 105 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.8484 | 106, 107, 116 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.892 | 103, 106, 117 |
| spb-01 | semantic-paraphrase | book |  | 0 | 1 | 0.5 | 0.6309 | 0.8579 | @1526-2851, @0-1526 |
| spb-02 | semantic-paraphrase | book |  | 0 | 1 | 0.5 | 0.6309 | 0.8697 | @0-1048, @1048-2686 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8644 | 109, 116, 101 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8711 | 110, 116, 117 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8423 | 107, 117, 101 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8206 | 105, 116, 107 |
| id-05 | exact-identifier | library |  | 0 | 1 | 0.3333 | 0.5 | 0.8281 | 117, 103, 107 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8617 | 106, 110, 107 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8461 | 101, 110, 117 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 | 0.8063 | 111, 115, 114 |
| id-09 | exact-identifier | library |  | 0 | 0 | 0.1667 | 0.3562 | 0.8115 | 117, 104, 116 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8625 | 110, 109, 107 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.831 | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 | 0.8628 | @1430-2604, @0-1430 |
| xl-01 | cross-lingual | library | ✓ | 0 | 1 | 0.3333 | 0.5 | 0.8202 | 112, 113, 108 |
| xl-02 | cross-lingual | library | ✓ | 0 | 1 | 0.5 | 0.6309 | 0.8262 | 114, 101, 106 |
| xl-03 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8307 | 105, 115, 114 |
| xl-04 | cross-lingual | library | ✓ | 0 | 1 | 0.25 | 0.4307 | 0.817 | 115, 112, 113 |
| xl-05 | cross-lingual | library | ✓ | 0 | 1 | 0.5 | 0.6309 | 0.8111 | 109, 113, 116 |
| xl-06 | cross-lingual | library | ✓ | 0 | 1 | 0.5 | 0.6309 | 0.8077 | 108, 112, 116 |
| xl-07 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8247 | 111, 108, 117 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0.1667 | 0.3562 | 0.832 | 117, 107, 106 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8668 | 112, 113, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8957 | 111, 113, 114 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8735 | 114, 115, 112 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8567 | 113, 115, 109 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8773 | 114, 110, 115 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8735 | 115, 114, 113 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.8361 | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 | 0.8399 | @0-1816, @1816-2795 |
| fmt-01 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8943 | @3677-5459, @5459-7523, @1906-3677 |
| fmt-02 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8733 | @1906-3677, @3677-5459, @5459-7523 |
| fmt-03 | front-matter-trap | book |  | 0 | 1 | 0.5 | 0.6309 | 0.8654 | @7523-8331, @5459-7523, @1906-3677 |
| fmt-04 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8779 | @1963-4009, @4009-5688, @5688-6994 |
| fmt-05 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8899 | @6994-8926, @8926-10847, @4009-5688 |
| fmt-06 | front-matter-trap | book |  | 1 | 1 | 1 | 1 | 0.8707 | @10847-12407, @8926-10847, @4009-5688 |
| neg-01 | negative | library |  | — | — | — | NOT flagged | 0.7885 | 116, 117, 107 |
| neg-02 | negative | library |  | — | — | — | NOT flagged | 0.8 | 108, 104, 117 |
| neg-03 | negative | library |  | — | — | — | NOT flagged | 0.8141 | 117, 116, 103 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.7709 | 113, 111, 112 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.7791 | 112, 113, 115 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.7733 | 116, 110, 108 |
| fig-01 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.9037 | fig-103#0, fig-103#1, fig-105#1 |
| fig-02 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8884 | fig-103#1, fig-103#0, fig-106#0 |
| fig-03 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8928 | fig-105#0, fig-105#1, fig-106#0 |
| fig-04 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.898 | fig-106#0, fig-105#0, fig-103#0 |
| fig-05 | figure-caption | library |  | 1 | 1 | 1 | 1 | 0.8716 | fig-108#0, fig-106#0, fig-105#0 |
| fig-ru-01 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 | 0.8983 | fig-112#0, fig-113#0, fig-113#1 |
| fig-ru-02 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 | 0.8856 | fig-113#0, fig-113#1, fig-112#0 |
| fig-xl-01 | figure-caption | library | ✓ | 0 | 1 | 0.3333 | 0.5 | 0.7973 | fig-105#1, fig-112#0, fig-105#0 |
| fig-xl-02 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 | 0.842 | fig-113#0, fig-103#0, fig-113#1 |
| figneg-01 | figure-negative | library |  | — | — | — | NOT flagged | 0.7927 | fig-106#0, fig-105#0, fig-105#1 |
| figneg-02 | figure-negative | library |  | — | — | — | NOT flagged | 0.7749 | fig-106#0, fig-108#0, fig-105#0 |
| figneg-03 | figure-negative | library | ✓ | — | — | — | NOT flagged | 0.8054 | fig-112#0, fig-113#1, fig-113#0 |

### mode=keyword

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 116, 117 |
| sp-02 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 102, 107, 105 |
| sp-03 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 117, 107 |
| sp-04 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 117, 116 |
| sp-05 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 105, 110, 116 |
| sp-06 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 107, 117 |
| sp-07 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 107, 105, 110 |
| sp-08 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 108, 106, 117 |
| sp-09 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 109, 103, 101 |
| sp-10 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 110, 117, 116 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 101, 106, 107 |
| sp-12 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 104, 105, 107 |
| sp-13 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 106, 117, 116 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 |  | 103, 104, 117 |
| spb-01 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @0-1526, @1526-2851 |
| spb-02 | semantic-paraphrase | book |  | 1 | 1 | 1 | 1 |  | @1048-2686, @0-1048 |
| id-01 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 109 |
| id-02 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| id-03 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 109, 110 |
| id-04 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-05 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 107, 116, 104 |
| id-06 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 106 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 101, 110 |
| id-08 | exact-identifier | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 109, 113 |
| id-09 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 105 |
| id-10 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 110 |
| idb-01 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @1384-2692, @0-1384 |
| idb-02 | exact-identifier | book |  | 1 | 1 | 1 | 1 |  | @1430-2604 |
| xl-01 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 114, 111 |
| xl-02 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 112, 115 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 114, 113, 112 |
| xl-04 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 113, 115, 114 |
| xl-05 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 108, 117, 116 |
| xl-06 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 117, 116, 102 |
| xl-07 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 117, 106, 116 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0 | 0 | 0 |  | 103, 117, 106 |
| ru-01 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 112, 113, 114 |
| ru-02 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 111, 115, 113 |
| ru-03 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 112, 113 |
| ru-04 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 113, 115, 112 |
| ru-05 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 114, 113, 112 |
| ru-06 | ru-monolingual | library | ✓ | 1 | 1 | 1 | 1 |  | 115, 113, 111 |
| rub-01 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @0-1253, @1253-2307 |
| rub-02 | ru-monolingual | book | ✓ | 1 | 1 | 1 | 1 |  | @0-1816, @1816-2795 |
| fmt-01 | front-matter-trap | book |  | 1 | 1 | 1 | 1 |  | @3677-5459, @5459-7523, @1906-3677 |
| fmt-02 | front-matter-trap | book |  | 0 | 1 | 0.5 | 0.6309 |  | @3677-5459, @1906-3677, @7523-8331 |
| fmt-03 | front-matter-trap | book |  | 0 | 1 | 0.5 | 0.6309 |  | @7523-8331, @5459-7523, @3677-5459 |
| fmt-04 | front-matter-trap | book |  | 1 | 1 | 1 | 1 |  | @1963-4009, @8926-10847, @5688-6994 |
| fmt-05 | front-matter-trap | book |  | 1 | 1 | 1 | 1 |  | @6994-8926, @8926-10847, @4009-5688 |
| fmt-06 | front-matter-trap | book |  | 1 | 1 | 1 | 1 |  | @10847-12407, @8926-10847, @5688-6994 |
| neg-01 | negative | library |  | — | — | — | NOT flagged |  | 116, 117, 110 |
| neg-02 | negative | library |  | — | — | — | NOT flagged |  | 104, 106, 117 |
| neg-03 | negative | library |  | — | — | — | NOT flagged |  | 117, 106, 105 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged |  | 111, 115, 113 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged |  | 115, 113 |
| neg-06 | negative | library |  | — | — | — | NOT flagged |  | 101, 117, 116 |
| fig-01 | figure-caption | library |  | 1 | 1 | 1 | 1 |  | fig-103#0, fig-105#0, fig-103#1 |
| fig-02 | figure-caption | library |  | 1 | 1 | 1 | 1 |  | fig-103#1, fig-103#0, fig-106#0 |
| fig-03 | figure-caption | library |  | 1 | 1 | 1 | 1 |  | fig-105#0, fig-105#1, fig-103#0 |
| fig-04 | figure-caption | library |  | 1 | 1 | 1 | 1 |  | fig-106#0, fig-103#0, fig-105#0 |
| fig-05 | figure-caption | library |  | 1 | 1 | 1 | 1 |  | fig-108#0, fig-103#0, fig-105#0 |
| fig-ru-01 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 |  | fig-112#0 |
| fig-ru-02 | figure-caption | library | ✓ | 1 | 1 | 1 | 1 |  | fig-113#0, fig-113#1 |
| fig-xl-01 | figure-caption | library | ✓ | 0 | 0 | 0 | 0 |  |  |
| fig-xl-02 | figure-caption | library | ✓ | 0 | 0 | 0 | 0 |  | fig-103#1, fig-106#0, fig-108#0 |
| figneg-01 | figure-negative | library |  | — | — | — | NOT flagged |  | fig-108#0, fig-103#0, fig-105#0 |
| figneg-02 | figure-negative | library |  | — | — | — | NOT flagged |  | fig-108#0, fig-103#0, fig-105#0 |
| figneg-03 | figure-negative | library | ✓ | — | — | — | flagged ✓ |  |  |


```text
report-only axes (#363, thresholds.reportOnlyAxes; never gated)
  snippetMarker: trend: higher is better, target 1.0: for book-scope queries, the #243 snippet window of the first passage that holds a labelled marker shows that marker
    hybrid: marker shown 8/12 (0.667)
    vector: marker shown 8/12 (0.667)
    keyword: marker shown 8/12 (0.667)
  spanHit: trend: higher is better: book-scope span-hit@1/@3/@5 = share of positive book-scope queries whose labelled marker sits in a top-k passage that overlaps its span
    hybrid: @1 10/12 (0.833), @3 12/12 (1.000), @5 12/12 (1.000)
    vector: @1 9/12 (0.750), @3 12/12 (1.000), @5 12/12 (1.000)
    keyword: @1 10/12 (0.833), @3 12/12 (1.000), @5 12/12 (1.000)
  confidence: trend: false-flag rate (lowConfidence on Hit@1 = 1 positives) down; AUC of maxRerank and of the top1-top2 rerank margin for telling Hit@1 = 1 apart from misses + negatives up (0.5 = the signal is noise). Reranked rows only.
    hybrid: n/a (no reranked rows)
    vector: n/a (no reranked rows)
    keyword: n/a (no reranked rows)
  latency: trend: lower is better; p50/p95 per-query ms per mode, same-machine comparisons only (wall-clock, noisy)
    hybrid: p50 13 ms, p95 18 ms (n=68)
    vector: p50 12 ms, p95 16 ms (n=68)
    keyword: p50 3 ms, p95 14 ms (n=68)
  ablation: trend: `--gate` prints overall Hit@1 / nDCG@10 per mode x rerank on/off; a fusion change shows in the OFF column, a reranker change in the ON-OFF gap. Chunk-size variants are not wired yet.
    printed by `pnpm eval --gate` (needs the rerank on + off passes)
  highlightInvariant: trend: violations must be 0 (no highlight on a non-query word or a NOT operand). Not measured by this harness yet: highlights come from calibre_search's FTS path, which the fixture doesn't run.
    not measured by this harness
```

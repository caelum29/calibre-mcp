# Retrieval eval — 2026-07-24-c1ce364-before-reindex-live

Model `Xenova/multilingual-e5-small` · index v3 · corpus 780 books / 312551 chunks · 30 queries (6 RU-involved) · topK=10 · rerank: onnx-community/bge-reranker-v2-m3-ONNX q8 (60 reranked rows) · git c1ce364

> **LIVE MODE — labels are UNVERIFIED** until Artem confirms them. Not a CI artifact.

## Headline

- **hybrid**: overall nDCG@10 **0.4899** / Hit@1 0.75 — RU-involved nDCG@10 **0.3919** / Hit@1 0.5 (RU gap 0.098) — negatives flagged 1
- **vector**: overall nDCG@10 **0.4898** / Hit@1 0.7083 — RU-involved nDCG@10 **0.4797** / Hit@1 0.5 (RU gap 0.0101) — negatives flagged 1
- **keyword**: overall nDCG@10 **0.4244** / Hit@1 0.5833 — RU-involved nDCG@10 **0.3989** / Hit@1 0.75 (RU gap 0.0255) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.3919)
- weakest kind in vector: **cross-lingual** (nDCG@10 0.4797)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0.3989)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 24 | 0.75 | 0.5208 | 0.8194 | 0.4899 |
| vector | 24 | 0.7083 | 0.5104 | 0.7917 | 0.4898 |
| keyword | 24 | 0.5833 | 0.4688 | 0.6875 | 0.4244 |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 4 | 0.5 | 0.55 | 0.75 | 0.3919 |
| vector | 4 | 0.5 | 0.55 | 0.75 | 0.4797 |
| keyword | 4 | 0.75 | 0.5 | 0.8333 | 0.3989 |

## By kind

### semantic-paraphrase

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 13 | 0.6923 | 0.4769 | 0.7436 | 0.4934 |
| vector | 13 | 0.6923 | 0.4769 | 0.7692 | 0.4912 |
| keyword | 13 | 0.6154 | 0.4769 | 0.7179 | 0.4347 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 7 | 1 | 0.5857 | 1 | 0.5395 |
| vector | 7 | 0.8571 | 0.55 | 0.8571 | 0.4932 |
| keyword | 7 | 0.4286 | 0.4357 | 0.5476 | 0.4199 |

### cross-lingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 4 | 0.5 | 0.55 | 0.75 | 0.3919 |
| vector | 4 | 0.5 | 0.55 | 0.75 | 0.4797 |
| keyword | 4 | 0.75 | 0.5 | 0.8333 | 0.3989 |

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
| sp-01 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6848 | 0.8961 | 688, 226, 2 |
| sp-02 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.606 | 0.9071 | 202, 665, 296 |
| sp-03 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6817 | 0.8928 | 280, 13, 377 |
| sp-04 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.3811 | 0.8874 | 573, 404, 413 |
| sp-05 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.5366 | 0.8565 | 525, 210, 284 |
| sp-06 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.4125 | 0.9002 | 868, 174, 852 |
| sp-07 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8531 | 403, 862, 126 |
| sp-09 | semantic-paraphrase | library |  | 0 | 0.6 | 0.3333 | 0.4983 | 0.8869 | 421, 417, 906 |
| sp-10 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8886 | 862, 96, 587 |
| sp-11 | semantic-paraphrase | library |  | 1 | 1 | 1 | 0.858 | 0.8725 | 622, 748, 5 |
| sp-12 | semantic-paraphrase | library |  | 0 | 0.4 | 0.3333 | 0.2646 | 0.8918 | 833, 413, 573 |
| sp-13 | semantic-paraphrase | library |  | 1 | 0.2 | 1 | 0.4902 | 0.8902 | 211, 864, 71 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.9079 | 308, 280, 311 |
| id-01 | exact-identifier | library |  | 1 | 0.6 | 1 | 0.469 | 0.8811 | 379, 652, 627 |
| id-03 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8494 | 816, 146, 412 |
| id-04 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.5101 | 0.8837 | 734, 848, 640 |
| id-05 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8822 | 145, 624, 655 |
| id-06 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.6479 | 0.8825 | 180, 45, 868 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8786 | 285, 652, 268 |
| id-09 | exact-identifier | library |  | 1 | 0.4 | 1 | 0.3689 | 0.8566 | 774, 698, 396 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 0.6489 | 0.8863 | 647, 653, 646 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.2489 | 0.8983 | 485, 488, 675 |
| xl-04 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.359 | 0.8872 | 493, 207, 610 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.3109 | 0.8876 | 59, 439, 313 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.8376 | 568, 102, 875 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.853 | 74, 870, 699 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.8688 | 752, 80, 565 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8239 | 505, 250, 539 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8216 | 7, 20, 530 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.8273 | 782, 865, 190 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.5303 | 0.8961 | 688, 226, 2 |
| sp-02 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6805 | 0.9071 | 202, 665, 296 |
| sp-03 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6083 | 0.8928 | 280, 13, 377 |
| sp-04 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.4085 | 0.8874 | 573, 404, 796 |
| sp-05 | semantic-paraphrase | library |  | 0 | 0.4 | 0.5 | 0.3718 | 0.8568 | 210, 284, 178 |
| sp-06 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.4968 | 0.9002 | 868, 174, 852 |
| sp-07 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8557 | 208, 284, 525 |
| sp-09 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.7728 | 0.8869 | 906, 377, 889 |
| sp-10 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8886 | 862, 96, 587 |
| sp-11 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.6938 | 0.8725 | 5, 635, 633 |
| sp-12 | semantic-paraphrase | library |  | 0 | 0.6 | 0.5 | 0.3188 | 0.8918 | 833, 573, 428 |
| sp-13 | semantic-paraphrase | library |  | 1 | 0.2 | 1 | 0.5035 | 0.8902 | 211, 864, 71 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 1 | 0.9079 | 308, 280, 311 |
| id-01 | exact-identifier | library |  | 1 | 0.6 | 1 | 0.469 | 0.8811 | 379, 652, 627 |
| id-03 | exact-identifier | library |  | 0 | 0 | 0 | 0 | 0.8559 | 412, 85, 71 |
| id-04 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.5638 | 0.8837 | 734, 640, 810 |
| id-05 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8822 | 145, 624, 479 |
| id-06 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.6479 | 0.8825 | 180, 45, 868 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8786 | 285, 652, 268 |
| id-09 | exact-identifier | library |  | 1 | 0.4 | 1 | 0.3811 | 0.8566 | 774, 698, 396 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 1 | 0.8863 | 647, 653, 633 |
| xl-03 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.2489 | 0.8983 | 485, 488, 675 |
| xl-04 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.359 | 0.8872 | 493, 207, 610 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.3109 | 0.8876 | 59, 439, 313 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.8376 | 102, 875, 774 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.853 | 191, 74, 699 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.8688 | 752, 875, 629 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8239 | 505, 250, 113 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8216 | 875, 7, 719 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.8273 | 396, 782, 865 |

### mode=keyword

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 0 | 0.6 | 0.3333 | 0.5054 |  | 226, 2, 688 |
| sp-02 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6718 |  | 296, 2, 116 |
| sp-03 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.4595 |  | 155, 377, 395 |
| sp-04 | semantic-paraphrase | library |  | 0 | 0.6 | 0.5 | 0.3437 |  | 833, 573, 891 |
| sp-05 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6016 |  | 525, 774, 788 |
| sp-06 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.5215 |  | 206, 868, 368 |
| sp-07 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 |  | 790, 199, 767 |
| sp-09 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.5225 |  | 379, 652, 636 |
| sp-10 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 |  | 294, 587, 96 |
| sp-11 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.6422 |  | 622, 281, 18 |
| sp-12 | semantic-paraphrase | library |  | 1 | 0.2 | 1 | 0.2895 |  | 699, 889, 618 |
| sp-13 | semantic-paraphrase | library |  | 0 | 0.6 | 0.5 | 0.4601 |  | 852, 868, 180 |
| sp-14 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6332 |  | 280, 753, 29 |
| id-01 | exact-identifier | library |  | 0 | 0 | 0 | 0 |  |  |
| id-03 | exact-identifier | library |  | 0 | 0.25 | 0.3333 | 0.3342 |  | 146, 412, 816 |
| id-04 | exact-identifier | library |  | 1 | 0.6 | 1 | 0.5696 |  | 810, 561, 774 |
| id-05 | exact-identifier | library |  | 0 | 0 | 0 | 0 |  | 655, 748, 617 |
| id-06 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.8112 |  | 45, 180, 94 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 |  | 267, 273, 293 |
| id-09 | exact-identifier | library |  | 0 | 0.4 | 0.5 | 0.224 |  | 561, 640, 55 |
| xl-02 | cross-lingual | library | ✓ | 1 | 0.8 | 1 | 0.5638 |  | 647, 653, 646 |
| xl-03 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.3301 |  | 488, 485, 675 |
| xl-04 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.359 |  | 493, 207, 32 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0.4 | 0.3333 | 0.3425 |  | 401, 889, 313 |
| neg-01 | negative | library |  | — | — | — | NOT flagged |  | 23, 518, 824 |
| neg-02 | negative | library |  | — | — | — | NOT flagged |  | 870, 515, 808 |
| neg-03 | negative | library |  | — | — | — | NOT flagged |  | 752, 113, 565 |
| neg-04 | negative | library | ✓ | — | — | — | NOT flagged |  | 250, 539, 246 |
| neg-05 | negative | library | ✓ | — | — | — | NOT flagged |  | 530, 191, 216 |
| neg-06 | negative | library |  | — | — | — | NOT flagged |  | 742, 480, 572 |


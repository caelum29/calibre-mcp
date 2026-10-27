# Retrieval eval — 2026-10-23-acc89db-rerankfloor-live

Model `Xenova/multilingual-e5-small` · index v3 · corpus 773 books / 313213 chunks · 30 queries (6 RU-involved) · topK=10 · rerank: onnx-community/bge-reranker-v2-m3-ONNX q8 (60 reranked rows) · git acc89db

> **LIVE MODE — labels are UNVERIFIED** until Artem confirms them. Not a CI artifact.

## Headline

- **hybrid**: overall nDCG@10 **0.4716** / Hit@1 0.7083 — RU-involved nDCG@10 **0.3838** / Hit@1 0.75 (RU gap 0.0878) — negatives flagged 1
- **vector**: overall nDCG@10 **0.4596** / Hit@1 0.6667 — RU-involved nDCG@10 **0.4444** / Hit@1 0.75 (RU gap 0.0152) — negatives flagged 1
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.3838)
- weakest kind in vector: **cross-lingual** (nDCG@10 0.4444)

## Overall (negatives excluded)

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 24 | 0.7083 | 0.5125 | 0.8021 | 0.4716 |
| vector | 24 | 0.6667 | 0.5021 | 0.7708 | 0.4596 |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 4 | 0.75 | 0.5 | 0.875 | 0.3838 |
| vector | 4 | 0.75 | 0.55 | 0.875 | 0.4444 |

## By kind

### semantic-paraphrase

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 13 | 0.6154 | 0.5077 | 0.7115 | 0.4772 |
| vector | 13 | 0.6154 | 0.4769 | 0.7308 | 0.4639 |

### exact-identifier

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 7 | 0.8571 | 0.5286 | 0.9286 | 0.5112 |
| vector | 7 | 0.7143 | 0.5214 | 0.7857 | 0.4604 |

### cross-lingual

| mode | n | Hit@1 | Recall@5 | MRR | nDCG@10 |
|------|---|-------|----------|-----|---------|
| hybrid | 4 | 0.75 | 0.5 | 0.875 | 0.3838 |
| vector | 4 | 0.75 | 0.55 | 0.875 | 0.4444 |

## Negatives (no relevant answer exists — low-confidence signal)

| mode | n | flagged rate |
|------|---|--------------|
| hybrid | 6 | 1 |
| vector | 6 | 1 |

`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.

## Per-query

### mode=hybrid

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.6141 | 0.8961 | 688, 226, 2 |
| sp-02 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.6204 | 0.904 | 202, 665, 296 |
| sp-03 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.7538 | 0.8852 | 280, 801, 265 |
| sp-04 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.3301 | 0.8889 | 573, 413, 796 |
| sp-05 | semantic-paraphrase | library |  | 0 | 0.6 | 0.5 | 0.5431 | 0.8593 | 210, 525, 284 |
| sp-06 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.4773 | 0.8961 | 868, 917, 174 |
| sp-07 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8509 | 543, 849, 126 |
| sp-09 | semantic-paraphrase | library |  | 0 | 0.4 | 0.25 | 0.3882 | 0.8913 | 421, 417, 930 |
| sp-10 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8856 | 862, 635, 587 |
| sp-11 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.7624 | 0.8704 | 622, 748, 294 |
| sp-12 | semantic-paraphrase | library |  | 0 | 0.4 | 0.5 | 0.2974 | 0.8908 | 833, 573, 428 |
| sp-13 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.5538 | 0.8902 | 211, 864, 206 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 0.863 | 0.9116 | 308, 280, 54 |
| id-01 | exact-identifier | library |  | 0 | 0.4 | 0.5 | 0.2489 | 0.8815 | 930, 379, 627 |
| id-03 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8528 | 816, 412, 913 |
| id-04 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.5389 | 0.881 | 734, 640, 848 |
| id-05 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8821 | 145, 624, 655 |
| id-06 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.6479 | 0.8822 | 180, 45, 868 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8792 | 285, 289, 268 |
| id-09 | exact-identifier | library |  | 1 | 0.2 | 1 | 0.3621 | 0.8588 | 774, 698, 396 |
| xl-02 | cross-lingual | library | ✓ | 1 | 0.8 | 1 | 0.5541 | 0.8874 | 647, 653, 646 |
| xl-03 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.3301 | 0.8978 | 675, 485, 488 |
| xl-04 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.359 | 0.8873 | 207, 493, 610 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.2918 | 0.8877 | 59, 439, 819 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.8272 | 824, 568, 252 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.853 | 74, 191, 699 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.8664 | 643, 80, 752 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8189 | 505, 503, 539 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8253 | 7, 530, 20 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.8271 | 782, 343, 865 |

### mode=vector

| id | kind | scope | ru | Hit@1 | R@5 | RR | nDCG@10 | maxScore | top-3 retrieved |
|----|------|-------|----|-------|-----|----|---------|----------|-----------------|
| sp-01 | semantic-paraphrase | library |  | 1 | 0.2 | 1 | 0.3647 | 0.8961 | 688, 226, 2 |
| sp-02 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.6204 | 0.904 | 202, 665, 296 |
| sp-03 | semantic-paraphrase | library |  | 1 | 0.8 | 1 | 0.6911 | 0.8852 | 280, 801, 265 |
| sp-04 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.4226 | 0.8889 | 573, 796, 404 |
| sp-05 | semantic-paraphrase | library |  | 0 | 0.4 | 0.5 | 0.4517 | 0.8593 | 210, 284, 178 |
| sp-06 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.5534 | 0.8961 | 868, 917, 174 |
| sp-07 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8549 | 543, 849, 208 |
| sp-09 | semantic-paraphrase | library |  | 0 | 0.6 | 0.5 | 0.6164 | 0.8913 | 930, 906, 377 |
| sp-10 | semantic-paraphrase | library |  | 0 | 0 | 0 | 0 | 0.8856 | 862, 635, 648 |
| sp-11 | semantic-paraphrase | library |  | 1 | 0.6 | 1 | 0.5232 | 0.8704 | 635, 633, 664 |
| sp-12 | semantic-paraphrase | library |  | 0 | 0.4 | 0.5 | 0.3024 | 0.8908 | 833, 573, 428 |
| sp-13 | semantic-paraphrase | library |  | 1 | 0.4 | 1 | 0.5538 | 0.8902 | 211, 864, 206 |
| sp-14 | semantic-paraphrase | library |  | 1 | 1 | 1 | 0.9306 | 0.9116 | 308, 280, 54 |
| id-01 | exact-identifier | library |  | 0 | 0.4 | 0.5 | 0.2489 | 0.8815 | 930, 379, 627 |
| id-03 | exact-identifier | library |  | 0 | 0 | 0 | 0 | 0.8528 | 412, 913, 753 |
| id-04 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.5638 | 0.881 | 734, 640, 810 |
| id-05 | exact-identifier | library |  | 1 | 0.25 | 1 | 0.3904 | 0.8821 | 145, 624, 141 |
| id-06 | exact-identifier | library |  | 1 | 0.8 | 1 | 0.6479 | 0.8822 | 180, 45, 868 |
| id-07 | exact-identifier | library |  | 1 | 1 | 1 | 1 | 0.8792 | 285, 268, 627 |
| id-09 | exact-identifier | library |  | 1 | 0.4 | 1 | 0.3715 | 0.8588 | 774, 698, 396 |
| xl-02 | cross-lingual | library | ✓ | 1 | 1 | 1 | 0.7968 | 0.8874 | 647, 653, 633 |
| xl-03 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.3301 | 0.8978 | 675, 485, 488 |
| xl-04 | cross-lingual | library | ✓ | 1 | 0.4 | 1 | 0.359 | 0.8873 | 207, 493, 610 |
| xl-08 | cross-lingual | library | ✓ | 0 | 0.4 | 0.5 | 0.2918 | 0.8877 | 59, 439, 819 |
| neg-01 | negative | library |  | — | — | — | flagged ✓ | 0.8381 | 913, 774, 875 |
| neg-02 | negative | library |  | — | — | — | flagged ✓ | 0.853 | 74, 191, 699 |
| neg-03 | negative | library |  | — | — | — | flagged ✓ | 0.8664 | 643, 752, 849 |
| neg-04 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8189 | 505, 719, 539 |
| neg-05 | negative | library | ✓ | — | — | — | flagged ✓ | 0.8253 | 875, 7, 719 |
| neg-06 | negative | library |  | — | — | — | flagged ✓ | 0.8271 | 782, 343, 694 |


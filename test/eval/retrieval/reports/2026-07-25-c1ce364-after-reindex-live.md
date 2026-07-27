# Retrieval eval — 2026-07-25-c1ce364-after-reindex-live

Model `Xenova/multilingual-e5-small` · index v3 · corpus 793 books / 320389 chunks · 30 queries (6 RU-involved) · topK=10 · rerank: onnx-community/bge-reranker-v2-m3-ONNX q8 (60 reranked rows) · git c1ce364

> **LIVE MODE — labels are UNVERIFIED** until Artem confirms them. Not a CI artifact.

## Headline

- **hybrid**: overall nDCG@10 **0.4798** / Hit@1 0.7083 — RU-involved nDCG@10 **0.4075** / Hit@1 0.75 (RU gap 0.0723) — negatives flagged 1
- **vector**: overall nDCG@10 **0.473** / Hit@1 0.6667 — RU-involved nDCG@10 **0.4793** / Hit@1 0.75 (RU gap -0.0063) — negatives flagged 1
- **keyword**: overall nDCG@10 **0.4222** / Hit@1 0.5833 — RU-involved nDCG@10 **0.3938** / Hit@1 0.75 (RU gap 0.0284) — negatives flagged 0
- weakest kind in hybrid: **cross-lingual** (nDCG@10 0.4075)
- weakest kind in vector: **semantic-paraphrase** (nDCG@10 0.4643)
- weakest kind in keyword: **cross-lingual** (nDCG@10 0.3938)

## Overall (negatives excluded)

| mode    | n  | Hit@1  | Recall@5 | MRR    | nDCG@10 |
|---------|----|--------|----------|--------|---------|
| hybrid  | 24 | 0.7083 | 0.5458   | 0.8021 | 0.4798  |
| vector  | 24 | 0.6667 | 0.5188   | 0.7708 | 0.473   |
| keyword | 24 | 0.5833 | 0.4604   | 0.684  | 0.4222  |

## RU-involved (cross-lingual + RU-monolingual + RU-flagged) — the known weak axis

| mode    | n | Hit@1 | Recall@5 | MRR    | nDCG@10 |
|---------|---|-------|----------|--------|---------|
| hybrid  | 4 | 0.75  | 0.55     | 0.875  | 0.4075  |
| vector  | 4 | 0.75  | 0.55     | 0.875  | 0.4793  |
| keyword | 4 | 0.75  | 0.45     | 0.8333 | 0.3938  |

## By kind

### semantic-paraphrase

| mode    | n  | Hit@1  | Recall@5 | MRR    | nDCG@10 |
|---------|----|--------|----------|--------|---------|
| hybrid  | 13 | 0.6154 | 0.5231   | 0.7115 | 0.4793  |
| vector  | 13 | 0.6154 | 0.4923   | 0.7308 | 0.4643  |
| keyword | 13 | 0.6154 | 0.4769   | 0.7179 | 0.4348  |

### exact-identifier

| mode    | n | Hit@1  | Recall@5 | MRR    | nDCG@10 |
|---------|---|--------|----------|--------|---------|
| hybrid  | 7 | 0.8571 | 0.5857   | 0.9286 | 0.522   |
| vector  | 7 | 0.7143 | 0.55     | 0.7857 | 0.4856  |
| keyword | 7 | 0.4286 | 0.4357   | 0.5357 | 0.4151  |

### cross-lingual

| mode    | n | Hit@1 | Recall@5 | MRR    | nDCG@10 |
|---------|---|-------|----------|--------|---------|
| hybrid  | 4 | 0.75  | 0.55     | 0.875  | 0.4075  |
| vector  | 4 | 0.75  | 0.55     | 0.875  | 0.4793  |
| keyword | 4 | 0.75  | 0.45     | 0.8333 | 0.3938  |

## Negatives (no relevant answer exists — low-confidence signal)

| mode    | n | flagged rate |
|---------|---|--------------|
| hybrid  | 6 | 1            |
| vector  | 6 | 1            |
| keyword | 6 | 0            |

`flagged` = the tool returned zero results OR set lowConfidence for a query with no valid answer.

## Per-query

### mode=hybrid

| id     | kind                | scope   | ru | Hit@1 | R@5  | RR   | nDCG@10   | maxScore | top-3 retrieved |
|--------|---------------------|---------|----|-------|------|------|-----------|----------|-----------------|
| sp-01  | semantic-paraphrase | library |    | 1     | 0.6  | 1    | 0.6064    | 0.8961   | 688, 226, 2     |
| sp-02  | semantic-paraphrase | library |    | 1     | 0.8  | 1    | 0.6178    | 0.904    | 202, 665, 296   |
| sp-03  | semantic-paraphrase | library |    | 1     | 0.8  | 1    | 0.7242    | 0.8935   | 280, 377, 265   |
| sp-04  | semantic-paraphrase | library |    | 1     | 0.4  | 1    | 0.3301    | 0.8889   | 573, 404, 796   |
| sp-05  | semantic-paraphrase | library |    | 0     | 0.6  | 0.5  | 0.5501    | 0.8573   | 210, 525, 284   |
| sp-06  | semantic-paraphrase | library |    | 1     | 0.6  | 1    | 0.4773    | 0.8961   | 868, 917, 174   |
| sp-07  | semantic-paraphrase | library |    | 0     | 0    | 0    | 0         | 0.857    | 403, 862, 126   |
| sp-09  | semantic-paraphrase | library |    | 0     | 0.4  | 0.25 | 0.4011    | 0.8913   | 421, 417, 930   |
| sp-10  | semantic-paraphrase | library |    | 0     | 0    | 0    | 0         | 0.8858   | 862, 587, 635   |
| sp-11  | semantic-paraphrase | library |    | 1     | 0.8  | 1    | 0.7818    | 0.8715   | 622, 748, 294   |
| sp-12  | semantic-paraphrase | library |    | 0     | 0.4  | 0.5  | 0.2999    | 0.8908   | 833, 573, 428   |
| sp-13  | semantic-paraphrase | library |    | 1     | 0.4  | 1    | 0.5111    | 0.8902   | 211, 864, 71    |
| sp-14  | semantic-paraphrase | library |    | 1     | 1    | 1    | 0.9306    | 0.9116   | 308, 280, 311   |
| id-01  | exact-identifier    | library |    | 0     | 0.6  | 0.5  | 0.3437    | 0.8815   | 930, 379, 652   |
| id-03  | exact-identifier    | library |    | 1     | 0.25 | 1    | 0.3904    | 0.8528   | 816, 412, 913   |
| id-04  | exact-identifier    | library |    | 1     | 0.8  | 1    | 0.5101    | 0.8818   | 734, 848, 640   |
| id-05  | exact-identifier    | library |    | 1     | 0.25 | 1    | 0.3904    | 0.8822   | 145, 624, 655   |
| id-06  | exact-identifier    | library |    | 1     | 0.8  | 1    | 0.6479    | 0.8822   | 180, 45, 868    |
| id-07  | exact-identifier    | library |    | 1     | 1    | 1    | 1         | 0.8792   | 285, 652, 627   |
| id-09  | exact-identifier    | library |    | 1     | 0.4  | 1    | 0.3715    | 0.8562   | 774, 698, 396   |
| xl-02  | cross-lingual       | library | ✓  | 1     | 1    | 1    | 0.6489    | 0.8871   | 647, 653, 646   |
| xl-03  | cross-lingual       | library | ✓  | 1     | 0.4  | 1    | 0.3301    | 0.8983   | 675, 485, 488   |
| xl-04  | cross-lingual       | library | ✓  | 1     | 0.4  | 1    | 0.359     | 0.8872   | 493, 207, 30    |
| xl-08  | cross-lingual       | library | ✓  | 0     | 0.4  | 0.5  | 0.2918    | 0.8864   | 59, 439, 819    |
| neg-01 | negative            | library |    | —     | —    | —    | flagged ✓ | 0.8376   | 568, 824, 252   |
| neg-02 | negative            | library |    | —     | —    | —    | flagged ✓ | 0.853    | 191, 74, 699    |
| neg-03 | negative            | library |    | —     | —    | —    | flagged ✓ | 0.8664   | 80, 643, 565    |
| neg-04 | negative            | library | ✓  | —     | —    | —    | flagged ✓ | 0.8293   | 503, 505, 539   |
| neg-05 | negative            | library | ✓  | —     | —    | —    | flagged ✓ | 0.8253   | 7, 20, 530      |
| neg-06 | negative            | library |    | —     | —    | —    | flagged ✓ | 0.8273   | 782, 865, 190   |

### mode=vector

| id     | kind                | scope   | ru | Hit@1 | R@5  | RR  | nDCG@10   | maxScore | top-3 retrieved |
|--------|---------------------|---------|----|-------|------|-----|-----------|----------|-----------------|
| sp-01  | semantic-paraphrase | library |    | 1     | 0.2  | 1   | 0.4315    | 0.8961   | 688, 226, 2     |
| sp-02  | semantic-paraphrase | library |    | 1     | 0.8  | 1   | 0.684     | 0.904    | 202, 665, 296   |
| sp-03  | semantic-paraphrase | library |    | 1     | 0.8  | 1   | 0.6431    | 0.8935   | 280, 377, 265   |
| sp-04  | semantic-paraphrase | library |    | 1     | 0.4  | 1   | 0.3301    | 0.8889   | 573, 404, 796   |
| sp-05  | semantic-paraphrase | library |    | 0     | 0.4  | 0.5 | 0.4669    | 0.8593   | 210, 284, 774   |
| sp-06  | semantic-paraphrase | library |    | 1     | 0.6  | 1   | 0.5571    | 0.8961   | 868, 917, 174   |
| sp-07  | semantic-paraphrase | library |    | 0     | 0    | 0   | 0         | 0.857    | 543, 284, 399   |
| sp-09  | semantic-paraphrase | library |    | 0     | 0.8  | 0.5 | 0.6371    | 0.8913   | 930, 906, 377   |
| sp-10  | semantic-paraphrase | library |    | 0     | 0    | 0   | 0         | 0.8858   | 862, 587, 635   |
| sp-11  | semantic-paraphrase | library |    | 1     | 0.6  | 1   | 0.5271    | 0.8715   | 635, 633, 664   |
| sp-12  | semantic-paraphrase | library |    | 0     | 0.4  | 0.5 | 0.307     | 0.8908   | 833, 573, 428   |
| sp-13  | semantic-paraphrase | library |    | 1     | 0.4  | 1   | 0.5178    | 0.8902   | 211, 864, 71    |
| sp-14  | semantic-paraphrase | library |    | 1     | 1    | 1   | 0.9337    | 0.9116   | 308, 280, 311   |
| id-01  | exact-identifier    | library |    | 0     | 0.6  | 0.5 | 0.3437    | 0.8815   | 930, 379, 652   |
| id-03  | exact-identifier    | library |    | 0     | 0    | 0   | 0         | 0.8528   | 412, 913, 753   |
| id-04  | exact-identifier    | library |    | 1     | 0.8  | 1   | 0.6332    | 0.8818   | 734, 640, 810   |
| id-05  | exact-identifier    | library |    | 1     | 0.25 | 1   | 0.3904    | 0.8822   | 145, 624, 141   |
| id-06  | exact-identifier    | library |    | 1     | 0.8  | 1   | 0.6479    | 0.8822   | 180, 45, 868    |
| id-07  | exact-identifier    | library |    | 1     | 1    | 1   | 1         | 0.8792   | 285, 652, 627   |
| id-09  | exact-identifier    | library |    | 1     | 0.4  | 1   | 0.3843    | 0.8562   | 774, 698, 396   |
| xl-02  | cross-lingual       | library | ✓  | 1     | 1    | 1   | 0.9364    | 0.8871   | 647, 653, 633   |
| xl-03  | cross-lingual       | library | ✓  | 1     | 0.4  | 1   | 0.3301    | 0.8983   | 675, 485, 488   |
| xl-04  | cross-lingual       | library | ✓  | 1     | 0.4  | 1   | 0.359     | 0.8872   | 493, 207, 610   |
| xl-08  | cross-lingual       | library | ✓  | 0     | 0.4  | 0.5 | 0.2918    | 0.8864   | 59, 439, 819    |
| neg-01 | negative            | library |    | —     | —    | —   | flagged ✓ | 0.8376   | 913, 102, 875   |
| neg-02 | negative            | library |    | —     | —    | —   | flagged ✓ | 0.853    | 191, 74, 699    |
| neg-03 | negative            | library |    | —     | —    | —   | flagged ✓ | 0.8664   | 643, 752, 629   |
| neg-04 | negative            | library | ✓  | —     | —    | —   | flagged ✓ | 0.819    | 719, 505, 539   |
| neg-05 | negative            | library | ✓  | —     | —    | —   | flagged ✓ | 0.8253   | 875, 7, 719     |
| neg-06 | negative            | library |    | —     | —    | —   | flagged ✓ | 0.8273   | 396, 782, 865   |

### mode=keyword

| id     | kind                | scope   | ru | Hit@1 | R@5  | RR     | nDCG@10     | maxScore | top-3 retrieved |
|--------|---------------------|---------|----|-------|------|--------|-------------|----------|-----------------|
| sp-01  | semantic-paraphrase | library |    | 0     | 0.6  | 0.3333 | 0.4417      |          | 226, 2, 688     |
| sp-02  | semantic-paraphrase | library |    | 1     | 0.6  | 1      | 0.687       |          | 296, 2, 665     |
| sp-03  | semantic-paraphrase | library |    | 1     | 0.4  | 1      | 0.4519      |          | 155, 377, 395   |
| sp-04  | semantic-paraphrase | library |    | 0     | 0.4  | 0.5    | 0.3223      |          | 833, 573, 891   |
| sp-05  | semantic-paraphrase | library |    | 1     | 0.6  | 1      | 0.6016      |          | 525, 774, 788   |
| sp-06  | semantic-paraphrase | library |    | 1     | 0.6  | 1      | 0.5215      |          | 868, 206, 368   |
| sp-07  | semantic-paraphrase | library |    | 0     | 0    | 0      | 0           |          | 790, 199, 767   |
| sp-09  | semantic-paraphrase | library |    | 1     | 0.6  | 1      | 0.4983      |          | 379, 930, 652   |
| sp-10  | semantic-paraphrase | library |    | 0     | 0    | 0      | 0           |          | 294, 587, 96    |
| sp-11  | semantic-paraphrase | library |    | 1     | 0.8  | 1      | 0.6173      |          | 622, 281, 138   |
| sp-12  | semantic-paraphrase | library |    | 1     | 0.2  | 1      | 0.2895      |          | 699, 889, 618   |
| sp-13  | semantic-paraphrase | library |    | 0     | 0.6  | 0.5    | 0.5368      |          | 852, 868, 180   |
| sp-14  | semantic-paraphrase | library |    | 1     | 0.8  | 1      | 0.684       |          | 280, 29, 310    |
| id-01  | exact-identifier    | library |    | 0     | 0    | 0      | 0           |          |                 |
| id-03  | exact-identifier    | library |    | 0     | 0.25 | 0.25   | 0.2913      |          | 146, 913, 412   |
| id-04  | exact-identifier    | library |    | 1     | 0.6  | 1      | 0.5696      |          | 810, 561, 774   |
| id-05  | exact-identifier    | library |    | 0     | 0    | 0      | 0           |          | 655, 748, 617   |
| id-06  | exact-identifier    | library |    | 1     | 0.8  | 1      | 0.8112      |          | 45, 180, 94     |
| id-07  | exact-identifier    | library |    | 1     | 1    | 1      | 1           |          | 267, 273, 293   |
| id-09  | exact-identifier    | library |    | 0     | 0.4  | 0.5    | 0.2337      |          | 561, 640, 55    |
| xl-02  | cross-lingual       | library | ✓  | 1     | 0.8  | 1      | 0.5638      |          | 647, 653, 656   |
| xl-03  | cross-lingual       | library | ✓  | 1     | 0.4  | 1      | 0.3301      |          | 488, 485, 675   |
| xl-04  | cross-lingual       | library | ✓  | 1     | 0.4  | 1      | 0.359       |          | 493, 207, 32    |
| xl-08  | cross-lingual       | library | ✓  | 0     | 0.2  | 0.3333 | 0.3221      |          | 401, 889, 549   |
| neg-01 | negative            | library |    | —     | —    | —      | NOT flagged |          | 23, 518, 252    |
| neg-02 | negative            | library |    | —     | —    | —      | NOT flagged |          | 870, 808, 515   |
| neg-03 | negative            | library |    | —     | —    | —      | NOT flagged |          | 752, 113, 565   |
| neg-04 | negative            | library | ✓  | —     | —    | —      | NOT flagged |          | 539, 250, 503   |
| neg-05 | negative            | library | ✓  | —     | —    | —      | NOT flagged |          | 530, 191, 216   |
| neg-06 | negative            | library |    | —     | —    | —      | NOT flagged |          | 742, 480, 572   |

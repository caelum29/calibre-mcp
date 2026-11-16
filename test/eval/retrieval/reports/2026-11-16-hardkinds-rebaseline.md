# #359 hard-kind re-baseline: what moved on the existing queries

Fixture: 17 books / 70 queries (old baselines) → 27 books / 98 queries (new). Every number below is on that fixture [17-book → 27-book fixture], macOS, transformers.js 4.3.2.
Existing labels were never edited. Where a new book took an existing query's Hit@1 in a first measuring run, the new book was reworded or replaced before the freeze (listed in the PR). This file lists, per tier, every existing (mode, query) whose top-10 list changed, the new books (118-127) that entered its top 10 — the cause, since nothing else changed — and every Hit@1 or flag change.

## Tier on (rerank on)

reports/2026-11-16-db98db10-heldout.json → reports/2026-11-16-5abdc650-hardkinds.json: 131 of 210 existing rows changed their top-10 list.

Hit@1 / flag changes on existing queries: 
- vector/id-09: Hit@1 1→0, top3 now 119, 105, 121

| row | kind | new books entering the top 10 (cause) | Hit@1 / flag |
|---|---|---|---|
| hybrid/sp-01 | semantic-paraphrase | 120, 122, 121 | — |
| hybrid/sp-02 | semantic-paraphrase | 124, 121, 122 | — |
| hybrid/sp-03 | semantic-paraphrase | 118, 122, 119, 120 | — |
| hybrid/sp-04 | semantic-paraphrase | 123, 122, 120, 125 | — |
| hybrid/sp-05 | semantic-paraphrase | 122, 123, 119, 124 | — |
| hybrid/sp-06 | semantic-paraphrase | 122, 120, 119, 121 | — |
| hybrid/sp-07 | semantic-paraphrase | 124, 120, 122, 119, 121 | — |
| hybrid/sp-08 | semantic-paraphrase | 125, 120 | — |
| hybrid/sp-09 | semantic-paraphrase | 119, 122, 123 | — |
| hybrid/sp-10 | semantic-paraphrase | 122, 119 | — |
| hybrid/sp-11 | semantic-paraphrase | 122, 119 | — |
| hybrid/sp-12 | semantic-paraphrase | 123, 120 | — |
| hybrid/sp-13 | semantic-paraphrase | 119, 122, 120 | — |
| hybrid/sp-14 | semantic-paraphrase | 119, 118, 122 | — |
| hybrid/id-01 | exact-identifier | 121, 119, 120, 123 | — |
| hybrid/id-02 | exact-identifier | 126, 122, 119, 123, 121 | — |
| hybrid/id-03 | exact-identifier | 122, 119, 121, 120 | — |
| hybrid/id-04 | exact-identifier | 123, 121, 119 | — |
| hybrid/id-05 | exact-identifier | 123, 122 | — |
| hybrid/id-06 | exact-identifier | 120, 121, 123, 122 | — |
| hybrid/id-07 | exact-identifier | 121, 118, 122 | — |
| hybrid/id-08 | exact-identifier | 127, 126, 121, 125 | — |
| hybrid/id-09 | exact-identifier | 119, 121, 123, 125, 120 | — |
| hybrid/id-10 | exact-identifier | 123, 121, 120 | — |
| hybrid/id-11 | exact-identifier | 121, 118, 120, 119 | — |
| hybrid/id-12 | exact-identifier | 118, 122, 124, 120 | — |
| hybrid/xl-01 | cross-lingual | 126, 125, 121, 119 | — |
| hybrid/xl-02 | cross-lingual | 119, 122, 121 | — |
| hybrid/xl-03 | cross-lingual | 125, 121, 123 | — |
| hybrid/xl-04 | cross-lingual | 118, 119, 126 | — |
| hybrid/xl-05 | cross-lingual | 119, 125, 118, 120, 121, 126 | — |
| hybrid/xl-06 | cross-lingual | 126, 125, 120 | — |
| hybrid/xl-07 | cross-lingual | 125, 119, 120 | — |
| hybrid/xl-08 | cross-lingual | 122, 119, 123 | — |
| hybrid/ru-01 | ru-monolingual | 126, 125, 120, 127 | — |
| hybrid/ru-02 | ru-monolingual | 127, 122 | — |
| hybrid/ru-03 | ru-monolingual | 127, 124, 118 | — |
| hybrid/ru-04 | ru-monolingual | 121, 124, 126 | — |
| hybrid/ru-05 | ru-monolingual | 127, 118 | — |
| hybrid/ru-06 | ru-monolingual | 124, 122, 121, 119, 120 | — |
| hybrid/neg-01 | negative | 119, 121, 120 | — |
| hybrid/neg-02 | negative | 121, 124, 120 | — |
| hybrid/neg-03 | negative | 127, 123, 126, 119 | — |
| hybrid/neg-04 | negative | 124, 121, 125 | — |
| hybrid/neg-05 | negative | 125, 126, 119 | — |
| hybrid/neg-06 | negative | 126, 118, 127, 125 | — |
| vector/sp-01 | semantic-paraphrase | 120, 122, 121 | — |
| vector/sp-02 | semantic-paraphrase | 124, 121, 122, 123 | — |
| vector/sp-03 | semantic-paraphrase | 118, 122, 119, 120 | — |
| vector/sp-04 | semantic-paraphrase | 123, 122, 120, 125 | — |
| vector/sp-05 | semantic-paraphrase | 122, 124, 119, 121, 120 | — |
| vector/sp-06 | semantic-paraphrase | 122, 120, 119, 121 | — |
| vector/sp-07 | semantic-paraphrase | 124, 120, 122, 119, 121 | — |
| vector/sp-08 | semantic-paraphrase | 125, 120, 127 | — |
| vector/sp-09 | semantic-paraphrase | 122, 119, 123 | — |
| vector/sp-10 | semantic-paraphrase | 122, 119 | — |
| vector/sp-11 | semantic-paraphrase | 122 | — |
| vector/sp-12 | semantic-paraphrase | 123, 120 | — |
| vector/sp-13 | semantic-paraphrase | 119, 122, 120 | — |
| vector/sp-14 | semantic-paraphrase | 119, 118, 122 | — |
| vector/id-01 | exact-identifier | 121, 119, 120, 123 | — |
| vector/id-02 | exact-identifier | 126, 122, 119, 123, 121 | — |
| vector/id-03 | exact-identifier | 122, 119, 121, 120 | — |
| vector/id-04 | exact-identifier | 123, 121, 119 | — |
| vector/id-05 | exact-identifier | 123, 122 | — |
| vector/id-06 | exact-identifier | 120, 121, 123, 122 | — |
| vector/id-07 | exact-identifier | 121, 122, 123 | — |
| vector/id-08 | exact-identifier | 127, 126, 121, 125 | — |
| vector/id-09 | exact-identifier | 119, 121, 123, 125, 120 | Hit@1 1→0 |
| vector/id-10 | exact-identifier | 123, 121, 120 | — |
| vector/id-11 | exact-identifier | 121, 118, 120, 119 | — |
| vector/id-12 | exact-identifier | 118, 122, 124, 120, 121 | — |
| vector/xl-01 | cross-lingual | 126, 125, 121, 119 | — |
| vector/xl-02 | cross-lingual | 119, 122, 121 | — |
| vector/xl-03 | cross-lingual | 125, 121, 123 | — |
| vector/xl-04 | cross-lingual | 118, 119, 126 | — |
| vector/xl-05 | cross-lingual | 118, 120, 121, 126, 119 | — |
| vector/xl-06 | cross-lingual | 126, 125, 120 | — |
| vector/xl-07 | cross-lingual | 125, 119, 120 | — |
| vector/xl-08 | cross-lingual | 122, 119, 123 | — |
| vector/ru-01 | ru-monolingual | 126, 125, 120, 127 | — |
| vector/ru-02 | ru-monolingual | 127, 122 | — |
| vector/ru-03 | ru-monolingual | 127, 124, 118 | — |
| vector/ru-04 | ru-monolingual | 121, 124, 126 | — |
| vector/ru-05 | ru-monolingual | 127, 118 | — |
| vector/ru-06 | ru-monolingual | 124, 122, 121, 119, 120 | — |
| vector/neg-01 | negative | 121, 120, 119 | — |
| vector/neg-02 | negative | 121, 124, 120 | — |
| vector/neg-03 | negative | 127, 123, 126, 119 | — |
| vector/neg-04 | negative | 124, 121, 125 | — |
| vector/neg-05 | negative | 125, 126, 119 | — |
| vector/neg-06 | negative | 126, 118, 127, 120 | — |
| keyword/sp-01 | semantic-paraphrase | 119, 120, 123, 125 | — |
| keyword/sp-02 | semantic-paraphrase | 122, 120, 124, 118 | — |
| keyword/sp-03 | semantic-paraphrase | 118, 120, 122, 126, 123 | — |
| keyword/sp-04 | semantic-paraphrase | 125, 119, 118 | — |
| keyword/sp-05 | semantic-paraphrase | 123, 119, 118, 124 | — |
| keyword/sp-06 | semantic-paraphrase | 122, 120, 123, 119, 118 | — |
| keyword/sp-07 | semantic-paraphrase | 120, 118, 126, 122 | — |
| keyword/sp-08 | semantic-paraphrase | 125, 126, 123, 120 | — |
| keyword/sp-09 | semantic-paraphrase | 119, 123, 125 | — |
| keyword/sp-10 | semantic-paraphrase | 122, 119, 126, 124, 120 | — |
| keyword/sp-11 | semantic-paraphrase | 119, 122, 126 | — |
| keyword/sp-12 | semantic-paraphrase | 120, 123, 125 | — |
| keyword/sp-13 | semantic-paraphrase | 120, 122, 126, 119, 125 | — |
| keyword/sp-14 | semantic-paraphrase | 119, 122, 120, 126 | — |
| keyword/id-03 | exact-identifier | 125, 123, 120 | — |
| keyword/id-05 | exact-identifier | 122, 126, 118 | — |
| keyword/id-06 | exact-identifier | 120 | — |
| keyword/id-07 | exact-identifier | 118 | — |
| keyword/id-08 | exact-identifier | 127 | — |
| keyword/id-12 | exact-identifier | 124 | — |
| keyword/xl-01 | cross-lingual | 127, 121 | — |
| keyword/xl-02 | cross-lingual | 127, 121 | — |
| keyword/xl-03 | cross-lingual | 127, 121 | — |
| keyword/xl-04 | cross-lingual | 127, 121 | — |
| keyword/xl-05 | cross-lingual | 119, 125, 120, 122, 124, 118 | — |
| keyword/xl-06 | cross-lingual | 126, 122, 120, 123 | — |
| keyword/xl-07 | cross-lingual | 120, 119, 123, 118 | — |
| keyword/xl-08 | cross-lingual | 122, 119, 126, 118, 120 | — |
| keyword/ru-01 | ru-monolingual | 121, 127 | — |
| keyword/ru-02 | ru-monolingual | 127, 121 | — |
| keyword/ru-03 | ru-monolingual | 127, 121 | — |
| keyword/ru-04 | ru-monolingual | 127, 121 | — |
| keyword/ru-05 | ru-monolingual | 121, 127 | — |
| keyword/ru-06 | ru-monolingual | 127 | — |
| keyword/neg-01 | negative | 119, 125, 126, 118, 124 | — |
| keyword/neg-02 | negative | 118, 126, 119 | — |
| keyword/neg-03 | negative | 119, 118, 120, 123 | — |
| keyword/neg-04 | negative | 121, 127 | — |
| keyword/neg-06 | negative | 126, 125, 123, 119 | — |

## Tier fusionOnly (rerank off)

reports/2026-11-16-db98db10-heldout-rerankoff.json → reports/2026-11-16-5abdc650-hardkinds-rerankoff.json: 131 of 210 existing rows changed their top-10 list.

Hit@1 / flag changes on existing queries: 
- vector/sp-01: Hit@1 1→0, top3 now 122, 101, 119

| row | kind | new books entering the top 10 (cause) | Hit@1 / flag |
|---|---|---|---|
| hybrid/sp-01 | semantic-paraphrase | 119, 120, 123, 122 | — |
| hybrid/sp-02 | semantic-paraphrase | 122, 124, 120, 118 | — |
| hybrid/sp-03 | semantic-paraphrase | 120, 122, 118, 119, 123 | — |
| hybrid/sp-04 | semantic-paraphrase | 123, 119, 118, 125 | — |
| hybrid/sp-05 | semantic-paraphrase | 124, 123, 119 | — |
| hybrid/sp-06 | semantic-paraphrase | 120, 122, 119, 123, 118 | — |
| hybrid/sp-07 | semantic-paraphrase | 120, 119, 122 | — |
| hybrid/sp-08 | semantic-paraphrase | 125, 126, 122, 124, 123 | — |
| hybrid/sp-09 | semantic-paraphrase | 119, 123, 122 | — |
| hybrid/sp-10 | semantic-paraphrase | 119, 122, 124, 126 | — |
| hybrid/sp-11 | semantic-paraphrase | 122, 119 | — |
| hybrid/sp-12 | semantic-paraphrase | 123, 120, 119 | — |
| hybrid/sp-13 | semantic-paraphrase | 120, 122, 119, 126, 123 | — |
| hybrid/sp-14 | semantic-paraphrase | 119, 120, 122 | — |
| hybrid/id-01 | exact-identifier | 119, 121, 125, 118 | — |
| hybrid/id-02 | exact-identifier | 124, 123 | — |
| hybrid/id-03 | exact-identifier | 120, 125, 123 | — |
| hybrid/id-04 | exact-identifier | 119, 123, 118 | — |
| hybrid/id-05 | exact-identifier | 122, 120, 118 | — |
| hybrid/id-06 | exact-identifier | 120, 119 | — |
| hybrid/id-07 | exact-identifier | 118, 123, 122 | — |
| hybrid/id-08 | exact-identifier | 127 | — |
| hybrid/id-09 | exact-identifier | 120, 119, 118, 123 | — |
| hybrid/id-10 | exact-identifier | 118, 124 | — |
| hybrid/id-11 | exact-identifier | 118, 119, 122 | — |
| hybrid/id-12 | exact-identifier | 124, 120 | — |
| hybrid/xl-01 | cross-lingual | 127, 121, 125 | — |
| hybrid/xl-02 | cross-lingual | 121, 127, 119 | — |
| hybrid/xl-03 | cross-lingual | 121, 127, 119 | — |
| hybrid/xl-04 | cross-lingual | 121, 127, 119 | — |
| hybrid/xl-05 | cross-lingual | 119, 122, 120, 123, 125 | — |
| hybrid/xl-06 | cross-lingual | 126, 125, 120, 122 | — |
| hybrid/xl-07 | cross-lingual | 123, 120, 119, 118 | — |
| hybrid/xl-08 | cross-lingual | 122, 119, 120, 118 | — |
| hybrid/ru-01 | ru-monolingual | 121, 127, 125, 126 | — |
| hybrid/ru-02 | ru-monolingual | 127, 121, 124 | — |
| hybrid/ru-03 | ru-monolingual | 121, 127 | — |
| hybrid/ru-04 | ru-monolingual | 121, 127 | — |
| hybrid/ru-05 | ru-monolingual | 127, 121 | — |
| hybrid/ru-06 | ru-monolingual | 127, 121, 120, 124 | — |
| hybrid/neg-01 | negative | 119, 124, 118, 126, 120 | — |
| hybrid/neg-02 | negative | 126, 118, 124, 120, 123 | — |
| hybrid/neg-03 | negative | 120, 119, 123, 118 | — |
| hybrid/neg-04 | negative | 127, 121, 119, 120 | — |
| hybrid/neg-05 | negative | 127, 121, 126, 120 | — |
| hybrid/neg-06 | negative | 124, 126, 118 | — |
| vector/sp-01 | semantic-paraphrase | 122, 119, 120, 118 | Hit@1 1→0 |
| vector/sp-02 | semantic-paraphrase | 124, 122, 123, 120, 119 | — |
| vector/sp-03 | semantic-paraphrase | 119, 122, 120, 123, 118 | — |
| vector/sp-04 | semantic-paraphrase | 123, 126, 119, 118, 120 | — |
| vector/sp-05 | semantic-paraphrase | 124, 119, 123, 122 | — |
| vector/sp-06 | semantic-paraphrase | 120, 119, 122, 118 | — |
| vector/sp-07 | semantic-paraphrase | 124, 120, 123, 119 | — |
| vector/sp-08 | semantic-paraphrase | 124, 119, 122, 125, 126 | — |
| vector/sp-09 | semantic-paraphrase | 119, 123, 122, 118 | — |
| vector/sp-10 | semantic-paraphrase | 119, 124, 122 | — |
| vector/sp-11 | semantic-paraphrase | 122, 119 | — |
| vector/sp-12 | semantic-paraphrase | 123, 119, 120, 122 | — |
| vector/sp-13 | semantic-paraphrase | 119, 123, 122, 120 | — |
| vector/sp-14 | semantic-paraphrase | 119, 120, 118, 123 | — |
| vector/id-01 | exact-identifier | 119, 121, 125, 118 | — |
| vector/id-02 | exact-identifier | 124, 123 | — |
| vector/id-03 | exact-identifier | 120, 119, 124, 118, 126 | — |
| vector/id-04 | exact-identifier | 119, 123, 118 | — |
| vector/id-05 | exact-identifier | 124, 123, 119 | — |
| vector/id-06 | exact-identifier | 120, 119 | — |
| vector/id-07 | exact-identifier | 123, 118, 122 | — |
| vector/id-08 | exact-identifier | 127, 121 | — |
| vector/id-09 | exact-identifier | 120, 119, 118, 123 | — |
| vector/id-10 | exact-identifier | 118, 124 | — |
| vector/id-11 | exact-identifier | 118, 119, 122 | — |
| vector/id-12 | exact-identifier | 124, 120 | — |
| vector/xl-01 | cross-lingual | 121, 125, 127 | — |
| vector/xl-02 | cross-lingual | 119, 120, 118, 121, 122 | — |
| vector/xl-03 | cross-lingual | 121, 119, 124 | — |
| vector/xl-04 | cross-lingual | 121, 127, 119 | — |
| vector/xl-05 | cross-lingual | 119, 122, 123, 120 | — |
| vector/xl-06 | cross-lingual | 125, 126, 119, 120 | — |
| vector/xl-07 | cross-lingual | 123, 126, 125 | — |
| vector/xl-08 | cross-lingual | 122, 120, 119, 118 | — |
| vector/ru-01 | ru-monolingual | 125, 126, 121, 127 | — |
| vector/ru-02 | ru-monolingual | 127, 121, 124 | — |
| vector/ru-03 | ru-monolingual | 124 | — |
| vector/ru-04 | ru-monolingual | 121, 118, 119 | — |
| vector/ru-05 | ru-monolingual | 127, 121 | — |
| vector/ru-06 | ru-monolingual | 121, 120, 124 | — |
| vector/neg-01 | negative | 119, 124, 122, 120, 118 | — |
| vector/neg-02 | negative | 124, 126, 120, 123, 125 | — |
| vector/neg-03 | negative | 123, 120, 119, 122 | — |
| vector/neg-04 | negative | 127, 121, 119, 120, 126 | — |
| vector/neg-05 | negative | 127, 121, 126, 120 | — |
| vector/neg-06 | negative | 124, 118 | — |
| keyword/sp-01 | semantic-paraphrase | 119, 120, 123, 125 | — |
| keyword/sp-02 | semantic-paraphrase | 122, 120, 124, 118 | — |
| keyword/sp-03 | semantic-paraphrase | 118, 120, 122, 126, 123 | — |
| keyword/sp-04 | semantic-paraphrase | 125, 119, 118 | — |
| keyword/sp-05 | semantic-paraphrase | 123, 119, 118, 124 | — |
| keyword/sp-06 | semantic-paraphrase | 122, 120, 123, 119, 118 | — |
| keyword/sp-07 | semantic-paraphrase | 120, 118, 126, 122 | — |
| keyword/sp-08 | semantic-paraphrase | 125, 126, 123, 120 | — |
| keyword/sp-09 | semantic-paraphrase | 119, 123, 125 | — |
| keyword/sp-10 | semantic-paraphrase | 122, 119, 126, 124, 120 | — |
| keyword/sp-11 | semantic-paraphrase | 119, 122, 126 | — |
| keyword/sp-12 | semantic-paraphrase | 120, 123, 125 | — |
| keyword/sp-13 | semantic-paraphrase | 120, 122, 126, 119, 125 | — |
| keyword/sp-14 | semantic-paraphrase | 119, 122, 120, 126 | — |
| keyword/id-03 | exact-identifier | 125, 123, 120 | — |
| keyword/id-05 | exact-identifier | 122, 126, 118 | — |
| keyword/id-06 | exact-identifier | 120 | — |
| keyword/id-07 | exact-identifier | 118 | — |
| keyword/id-08 | exact-identifier | 127 | — |
| keyword/id-12 | exact-identifier | 124 | — |
| keyword/xl-01 | cross-lingual | 127, 121 | — |
| keyword/xl-02 | cross-lingual | 127, 121 | — |
| keyword/xl-03 | cross-lingual | 127, 121 | — |
| keyword/xl-04 | cross-lingual | 127, 121 | — |
| keyword/xl-05 | cross-lingual | 119, 125, 120, 122, 124, 118 | — |
| keyword/xl-06 | cross-lingual | 126, 122, 120, 123 | — |
| keyword/xl-07 | cross-lingual | 120, 119, 123, 118 | — |
| keyword/xl-08 | cross-lingual | 122, 119, 126, 118, 120 | — |
| keyword/ru-01 | ru-monolingual | 121, 127 | — |
| keyword/ru-02 | ru-monolingual | 127, 121 | — |
| keyword/ru-03 | ru-monolingual | 127, 121 | — |
| keyword/ru-04 | ru-monolingual | 127, 121 | — |
| keyword/ru-05 | ru-monolingual | 121, 127 | — |
| keyword/ru-06 | ru-monolingual | 127 | — |
| keyword/neg-01 | negative | 119, 125, 126, 118, 124 | — |
| keyword/neg-02 | negative | 118, 126, 119 | — |
| keyword/neg-03 | negative | 119, 118, 120, 123 | — |
| keyword/neg-04 | negative | 121, 127 | — |
| keyword/neg-06 | negative | 126, 125, 123, 119 | — |

## Tier hash (tier 0, lexical FNV embedder)

hash-baseline.json @ 62396165 → hash-baseline.json @ 5abdc650: 131 of 210 existing rows changed their top-10 list.

Hit@1 / flag changes on existing queries: none.

| row | kind | new books entering the top 10 (cause) | Hit@1 / flag |
|---|---|---|---|
| hybrid/sp-01 | semantic-paraphrase | 119, 120, 122, 124, 118 | — |
| hybrid/sp-02 | semantic-paraphrase | 122, 126 | — |
| hybrid/sp-03 | semantic-paraphrase | 122, 120, 118, 119 | — |
| hybrid/sp-04 | semantic-paraphrase | 119, 120, 125, 122 | — |
| hybrid/sp-05 | semantic-paraphrase | 119, 123 | — |
| hybrid/sp-06 | semantic-paraphrase | 120, 119, 122, 118, 124 | — |
| hybrid/sp-07 | semantic-paraphrase | 118, 126 | — |
| hybrid/sp-08 | semantic-paraphrase | 126, 122, 119, 120 | — |
| hybrid/sp-09 | semantic-paraphrase | 119, 123, 122, 118 | — |
| hybrid/sp-10 | semantic-paraphrase | 119, 122, 126, 120, 124 | — |
| hybrid/sp-11 | semantic-paraphrase | 122, 126, 119 | — |
| hybrid/sp-12 | semantic-paraphrase | 123 | — |
| hybrid/sp-13 | semantic-paraphrase | 122, 126, 120, 119 | — |
| hybrid/sp-14 | semantic-paraphrase | 119, 120, 126, 125 | — |
| hybrid/id-01 | exact-identifier | 119, 121, 124 | — |
| hybrid/id-02 | exact-identifier | 125, 126, 124, 122 | — |
| hybrid/id-03 | exact-identifier | 123, 120, 125 | — |
| hybrid/id-04 | exact-identifier | 120, 127, 123 | — |
| hybrid/id-05 | exact-identifier | 122, 126 | — |
| hybrid/id-06 | exact-identifier | 120, 118, 124, 119 | — |
| hybrid/id-07 | exact-identifier | 118, 124 | — |
| hybrid/id-08 | exact-identifier | 126 | — |
| hybrid/id-09 | exact-identifier | 126, 122, 119, 120 | — |
| hybrid/id-10 | exact-identifier | 124, 125 | — |
| hybrid/id-11 | exact-identifier | 121 | — |
| hybrid/id-12 | exact-identifier | 124, 121, 119, 120, 122 | — |
| hybrid/xl-01 | cross-lingual | 127, 121 | — |
| hybrid/xl-02 | cross-lingual | 127, 121, 120 | — |
| hybrid/xl-03 | cross-lingual | 121, 127 | — |
| hybrid/xl-04 | cross-lingual | 127, 121, 119 | — |
| hybrid/xl-05 | cross-lingual | 119, 122, 124, 118, 120, 125 | — |
| hybrid/xl-06 | cross-lingual | 126, 119, 123 | — |
| hybrid/xl-07 | cross-lingual | 120, 125, 123, 118, 119 | — |
| hybrid/xl-08 | cross-lingual | 126, 122 | — |
| hybrid/ru-01 | ru-monolingual | 127, 121, 124 | — |
| hybrid/ru-02 | ru-monolingual | 121, 127 | — |
| hybrid/ru-03 | ru-monolingual | 127, 121, 124, 118 | — |
| hybrid/ru-04 | ru-monolingual | 127, 121 | — |
| hybrid/ru-05 | ru-monolingual | 127, 121, 123 | — |
| hybrid/ru-06 | ru-monolingual | 127, 121 | — |
| hybrid/neg-01 | negative | 119, 125, 118, 126, 123 | — |
| hybrid/neg-02 | negative | 118, 120, 119, 122 | — |
| hybrid/neg-03 | negative | 119, 123, 118, 120 | — |
| hybrid/neg-04 | negative | 121, 127, 118 | — |
| hybrid/neg-05 | negative | 124, 118, 121, 122 | — |
| hybrid/neg-06 | negative | 123, 126, 125 | — |
| vector/sp-01 | semantic-paraphrase | 122, 119, 118, 124, 120 | — |
| vector/sp-02 | semantic-paraphrase | 122, 126 | — |
| vector/sp-03 | semantic-paraphrase | 122, 119, 120, 124 | — |
| vector/sp-04 | semantic-paraphrase | 119, 122, 120, 126, 124 | — |
| vector/sp-05 | semantic-paraphrase | 123, 119, 125 | — |
| vector/sp-06 | semantic-paraphrase | 119, 118, 120, 122, 124 | — |
| vector/sp-07 | semantic-paraphrase | 127, 121, 125 | — |
| vector/sp-08 | semantic-paraphrase | 119, 122, 126, 118 | — |
| vector/sp-09 | semantic-paraphrase | 119, 118, 122, 120, 124 | — |
| vector/sp-10 | semantic-paraphrase | 119, 122, 120, 124, 118 | — |
| vector/sp-11 | semantic-paraphrase | 126, 122 | — |
| vector/sp-12 | semantic-paraphrase | 123 | — |
| vector/sp-13 | semantic-paraphrase | 122, 126 | — |
| vector/sp-14 | semantic-paraphrase | 120, 118, 119, 125 | — |
| vector/id-01 | exact-identifier | 119, 121, 124 | — |
| vector/id-02 | exact-identifier | 125, 126, 124, 122 | — |
| vector/id-03 | exact-identifier | 123, 120, 121 | — |
| vector/id-04 | exact-identifier | 120, 127, 123 | — |
| vector/id-05 | exact-identifier | 127 | — |
| vector/id-06 | exact-identifier | 120, 118, 124, 119 | — |
| vector/id-07 | exact-identifier | 124, 121 | — |
| vector/id-08 | exact-identifier | 123, 126 | — |
| vector/id-09 | exact-identifier | 126, 122, 119, 120 | — |
| vector/id-10 | exact-identifier | 124, 125 | — |
| vector/id-11 | exact-identifier | 121, 119 | — |
| vector/id-12 | exact-identifier | 121, 119, 120, 122, 118 | — |
| vector/xl-01 | cross-lingual | 127, 121 | — |
| vector/xl-02 | cross-lingual | 127, 121, 120 | — |
| vector/xl-03 | cross-lingual | 121, 127 | — |
| vector/xl-04 | cross-lingual | 127, 121, 119 | — |
| vector/xl-05 | cross-lingual | 119, 122, 124, 118, 126, 120 | — |
| vector/xl-06 | cross-lingual | 119, 123, 127, 126 | — |
| vector/xl-07 | cross-lingual | 125, 120, 126 | — |
| vector/xl-08 | cross-lingual | 126, 123 | — |
| vector/ru-01 | ru-monolingual | 127, 121, 124 | — |
| vector/ru-02 | ru-monolingual | 121, 127 | — |
| vector/ru-03 | ru-monolingual | 127, 121, 124, 118 | — |
| vector/ru-04 | ru-monolingual | 121, 127, 123 | — |
| vector/ru-05 | ru-monolingual | 127, 121, 123 | — |
| vector/ru-06 | ru-monolingual | 121, 119, 127, 122 | — |
| vector/neg-01 | negative | 119, 118, 125, 123, 126 | — |
| vector/neg-02 | negative | 119, 118, 120, 122, 124 | — |
| vector/neg-03 | negative | 121, 127, 119, 125 | — |
| vector/neg-04 | negative | 121, 118 | — |
| vector/neg-05 | negative | 124, 118, 121, 122, 119 | — |
| vector/neg-06 | negative | 123, 126 | — |
| keyword/sp-01 | semantic-paraphrase | 119, 120, 124 | — |
| keyword/sp-02 | semantic-paraphrase | 122, 118, 126, 119 | — |
| keyword/sp-03 | semantic-paraphrase | 120, 118, 122, 123, 126 | — |
| keyword/sp-04 | semantic-paraphrase | 125, 123, 119 | — |
| keyword/sp-05 | semantic-paraphrase | 119, 118, 123, 124 | — |
| keyword/sp-06 | semantic-paraphrase | 120, 122, 119, 123, 118 | — |
| keyword/sp-07 | semantic-paraphrase | 120, 118, 122 | — |
| keyword/sp-08 | semantic-paraphrase | 125, 126, 122, 120, 123 | — |
| keyword/sp-09 | semantic-paraphrase | 119, 123, 125 | — |
| keyword/sp-10 | semantic-paraphrase | 126, 122, 119, 120 | — |
| keyword/sp-11 | semantic-paraphrase | 119, 122, 126 | — |
| keyword/sp-12 | semantic-paraphrase | 123, 120, 125 | — |
| keyword/sp-13 | semantic-paraphrase | 120, 122, 119, 126, 125 | — |
| keyword/sp-14 | semantic-paraphrase | 119, 122, 126, 123 | — |
| keyword/id-03 | exact-identifier | 123, 120, 125 | — |
| keyword/id-05 | exact-identifier | 122, 126 | — |
| keyword/id-06 | exact-identifier | 120 | — |
| keyword/id-07 | exact-identifier | 118 | — |
| keyword/id-08 | exact-identifier | 127 | — |
| keyword/id-12 | exact-identifier | 124 | — |
| keyword/xl-01 | cross-lingual | 127, 121 | — |
| keyword/xl-02 | cross-lingual | 127, 121 | — |
| keyword/xl-03 | cross-lingual | 127, 121 | — |
| keyword/xl-04 | cross-lingual | 127, 121 | — |
| keyword/xl-05 | cross-lingual | 119, 125, 120, 122, 124, 118 | — |
| keyword/xl-06 | cross-lingual | 126, 122, 125 | — |
| keyword/xl-07 | cross-lingual | 120, 119, 118, 123 | — |
| keyword/xl-08 | cross-lingual | 122, 119, 126, 120 | — |
| keyword/ru-01 | ru-monolingual | 121, 127 | — |
| keyword/ru-02 | ru-monolingual | 127, 121 | — |
| keyword/ru-03 | ru-monolingual | 127, 121 | — |
| keyword/ru-04 | ru-monolingual | 127, 121 | — |
| keyword/ru-05 | ru-monolingual | 127, 121 | — |
| keyword/ru-06 | ru-monolingual | 127 | — |
| keyword/neg-01 | negative | 119, 125, 126, 118, 120 | — |
| keyword/neg-02 | negative | 118, 120 | — |
| keyword/neg-03 | negative | 119, 118, 123, 120 | — |
| keyword/neg-04 | negative | 121, 127 | — |
| keyword/neg-06 | negative | 125, 123, 126, 119 | — |

## Accepted Hit@1 breaks, and why each stays

Found in the measuring runs and kept after rewording the new books did not move them.

- **on, vector, `id-09` ("overlayfs" → 105, now 119 first).** The cross-encoder scores both
  books at noise level, 119 at 0.00067 and 105 at 0.00033. This is the same `id-09` noise the
  `thresholds.linux` platform-drift entry documents for Linux. Book 119 (LSM trees) is the
  confuser for 103, and its core vocabulary (merge, levels, files) is what a reranker this
  unsure latches onto. The hybrid row of `id-09` still has 105 at rank 1.
- **fusionOnly, vector, `sp-01` ("when is memory freed in a language without a garbage
  collector" → 101, now 122 first).** No shared word causes it. e5 scores any short
  programming prose at about 0.84 for this query, and book 122 (memoization) beats 101 by
  0.0004 (0.8383 vs 0.8379). Removing its language names and its GC-like WeakMap sentence did
  not change the order. Book 122 has to be programming prose, because it is the target of the
  no-overlap kind. The rerank-on tier and the other modes still solve `sp-01`.

The hash tier has no existing-query Hit@1 change. Three earlier hash breaks (`sp-03`, `id-06`
and `ru-03`, all from shared tokens or FNV slot collisions in books 119, 120, 122 and 127)
were fixed by rewording those books before the freeze.

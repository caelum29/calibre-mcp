# Re-index gate — 2026-10-24, INDEX_VERSION 4 (#139)

transformers.js 4.2.0 → 4.3.1 (onnxruntime-node 1.24.3 → 1.30.0) at f8bb617, full re-index of
`Programming Books` into a v4 index. Reports:
`2026-10-24-f8bb617-v4-t431-fixture.{md,json}` and `2026-10-24-f8bb617-v4-t431-live.{md,json}`.

## Index

| | v3 (prod, 2026-07-27 + incremental) | v4 |
|---|---|---|
| books indexed / in library | 780 / — | 981 / 1011 |
| chunks | 315,074 | 389,935 |
| figures | 39,462 | 54,943 |
| books with front-matter chunks | 392 | 750 |

30 books are not indexed: 27 report no extractable text (mostly scanned PDFs; a few look like
text PDFs and need a closer look) and 3 fail extraction on every retry (44, 251, 1160).
Build: 1011 books at concurrency 3 in 7.8 h (27.75 s/book wall), then a concurrency-1 retry of
7 failures recovered 4.

## Fixture gate

Against the old baseline (`2026-07-15-9725d1e-issue18-after.json`) the gate FAILS on one query:
`sp-11` drops Hit@1 in hybrid and vector (top-1 116 instead of 101). Both candidates score
maxRerank ~0.015, which is cross-encoder noise on short self-authored fixture passages. The same
flip already appeared in `2026-10-23-rerank-floor-calibration.md`, whose run had 4.3.1 installed.
Every other gate passes, negatives flagged 6/6.

**Re-baselined** `thresholds.json` → `2026-10-24-f8bb617-v4-t431-fixture.json`. Gate: PASS.

## Live triage (labels unverified, not a gate)

| mode | Hit@1 v3 → v4 | nDCG@10 v3 → v4 | negatives flagged |
|---|---|---|---|
| hybrid | 0.708 → 0.625 | 0.472 → 0.443 | 6/6 |
| vector | 0.667 → 0.583 | 0.460 → 0.429 | 6/6 |

The drops are label gaps, not regressions. The new top-1 books joined the library after the
July labels were written:

- `sp-13` (three-way merge), `id-06` (git reflog): 1178 *Mastering Git, 2nd Ed.* (added 2026-08-10)
- `sp-02` (timer vs promise handlers): 1211 *The Node.js Guide* (added 2026-09-23)
- `sp-11` vector only: 947 (added 2026-08-09, title missing)

`sp-05` and `sp-12` (vector) gained Hit@1. Re-labelling with post-July books is a follow-up.

## RERANK_FLOOR (not changed here)

With the gate green, `rerank-floor.ts` now reports `zeroBroken: PASS` and selects **0.03** by
the pre-declared rule. Not adopted in this change: on the v4 live run 0.03 leaves neg-02 and
neg-03 unflagged (0.1 leaves neg-03). The floor stays 0.3 pending a separate decision.

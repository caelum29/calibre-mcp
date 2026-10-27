# Weighted-RRF weight sweep (#142) — VECTOR_RRF_WEIGHT ∈ {1.0, 1.25, 1.5, 2.0}

**Verdict: `VECTOR_RRF_WEIGHT = 1.0` stays** (D-021). No candidate passes the gates declared in
`thresholds.json` `rrfWeightSweep` (committed in `4e06eaa` before any sweep run). RU never
moves at any weight, and EN `exact-identifier` regresses from w=1.25 (fused order) and from
w=1.5 (live).

## Setup

- `e5-small`, `KEYWORD_RRF_WEIGHT` 1.0 fixed, weight applied at all three fusion sites
  (chunk / book / figure: one shared `RRF_WEIGHTS`), `RRF_K` 60, hybrid mode.
- Driver `test/eval/retrieval/rrf-sweep.sh` (rewrites the constant per run and restores it).
  Scorer `test/eval/retrieval/rrf-sweep.ts` (mechanical PASS/FAIL + the selection rule).
- Three measurements per weight:
  - **fixtureOn**: fixture, reranker ON (the shipped default).
  - **fixtureOff**: fixture, `--rerank off`. This is the fused order users get when the
    reranker is unavailable, busy (#156) or disabled, so it isolates fusion.
  - **liveOn**: a copy of the real `Programming_Books` index (773 books / 313k chunks),
    reranker ON, UNVERIFIED live labels. The production index was read only, never written.
- Re-measured baseline: the full-mode run `2026-10-21-71cc6f2-rrf142-v1.0` (`--gate` PASS)
  plus the `rrf142-w1.0-*` reports. These replace the pre-#97 D-012 numbers.

## Results (hybrid nDCG@10)

| VECTOR_RRF_WEIGHT | liveOn RU / xl | liveOn exact-id | fixtureOff RU / xl | fixtureOff exact-id / fmt | fixtureOn RU / xl | fixtureOn exact-id / fmt | zero-broken | RU gate | EN gate |
|---|---|---|---|---|---|---|---|---|---|
| 1 (baseline) | 0.4075 / 0.4075 | 0.5089 | 0.6339 / 0.1781 | 1.0000 / 0.8770 | 0.9824 / 1.0000 | 0.9692 / 1.0000 | PASS | — | — |
| 1.25 | 0.4075 / 0.4075 | 0.5180 | 0.6339 / 0.1781 | 0.9692 / 0.8770 | 0.9824 / 1.0000 | 0.9692 / 1.0000 | PASS | FAIL | FAIL |
| 1.5 | 0.4075 / 0.4075 | 0.4722 | 0.6339 / 0.1781 | 0.9583 / 0.8770 | 0.9824 / 1.0000 | 0.9692 / 1.0000 | PASS | FAIL | FAIL |
| 2 | 0.4075 / 0.4075 | 0.4722 | 0.6339 / 0.1781 | 0.9583 / 0.8770 | 0.9824 / 1.0000 | 0.9692 / 1.0000 | PASS | FAIL | FAIL |

`xl` = cross-lingual; `fmt` = front-matter-trap (book scope, fixture only). Per-check detail:

### w=1.25 — FAIL
- [PASS] fixtureOn RU-up — RU-involved 0.9824 (+0.0000, need ≥+0.0000), cross-lingual 1.0000 (+0.0000, need ≥+0.0000)
- [PASS] fixtureOn EN exact-identifier — nDCG@10 0.9692 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [PASS] fixtureOn EN front-matter-trap — nDCG@10 1.0000 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] fixtureOff RU-up — RU-involved 0.6339 (+0.0000, need ≥+0.0200), cross-lingual 0.1781 (+0.0000, need ≥+0.0200)
- [FAIL] fixtureOff EN exact-identifier — nDCG@10 0.9692 (drop 0.0308, allowed 0.01); broken Hit@1 1 [id-05] (allowed 0)
- [PASS] fixtureOff EN front-matter-trap — nDCG@10 0.8770 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] liveOn RU-up — RU-involved 0.4075 (+0.0000, need ≥+0.0100), cross-lingual 0.4075 (+0.0000, need ≥+0.0100)
- [PASS] liveOn EN exact-identifier — nDCG@10 0.5180 (drop -0.0091, allowed 0.02); broken Hit@1 0 (allowed 0)
- [PASS] fixtureOn zero-broken gate (nonRegression) — PASS

### w=1.5 — FAIL
- [PASS] fixtureOn RU-up — RU-involved 0.9824 (+0.0000, need ≥+0.0000), cross-lingual 1.0000 (+0.0000, need ≥+0.0000)
- [PASS] fixtureOn EN exact-identifier — nDCG@10 0.9692 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [PASS] fixtureOn EN front-matter-trap — nDCG@10 1.0000 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] fixtureOff RU-up — RU-involved 0.6339 (+0.0000, need ≥+0.0200), cross-lingual 0.1781 (+0.0000, need ≥+0.0200)
- [FAIL] fixtureOff EN exact-identifier — nDCG@10 0.9583 (drop 0.0417, allowed 0.01); broken Hit@1 1 [id-05] (allowed 0)
- [PASS] fixtureOff EN front-matter-trap — nDCG@10 0.8770 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] liveOn RU-up — RU-involved 0.4075 (+0.0000, need ≥+0.0100), cross-lingual 0.4075 (+0.0000, need ≥+0.0100)
- [FAIL] liveOn EN exact-identifier — nDCG@10 0.4722 (drop 0.0367, allowed 0.02); broken Hit@1 1 [id-03] (allowed 0)
- [PASS] fixtureOn zero-broken gate (nonRegression) — PASS

### w=2 — FAIL
- [PASS] fixtureOn RU-up — RU-involved 0.9824 (+0.0000, need ≥+0.0000), cross-lingual 1.0000 (+0.0000, need ≥+0.0000)
- [PASS] fixtureOn EN exact-identifier — nDCG@10 0.9692 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [PASS] fixtureOn EN front-matter-trap — nDCG@10 1.0000 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] fixtureOff RU-up — RU-involved 0.6339 (+0.0000, need ≥+0.0200), cross-lingual 0.1781 (+0.0000, need ≥+0.0200)
- [FAIL] fixtureOff EN exact-identifier — nDCG@10 0.9583 (drop 0.0417, allowed 0.01); broken Hit@1 1 [id-05] (allowed 0)
- [PASS] fixtureOff EN front-matter-trap — nDCG@10 0.8770 (drop 0.0000, allowed 0.01); broken Hit@1 0 (allowed 0)
- [FAIL] liveOn RU-up — RU-involved 0.4075 (+0.0000, need ≥+0.0100), cross-lingual 0.4075 (+0.0000, need ≥+0.0100)
- [FAIL] liveOn EN exact-identifier — nDCG@10 0.4722 (drop 0.0367, allowed 0.02); broken Hit@1 1 [id-03] (allowed 0)
- [PASS] fixtureOn zero-broken gate (nonRegression) — PASS

SELECTION: 1 stays — no candidate weight passes all declared gates

## Why RU does not move

1. **fixtureOn is weight-invariant by construction.** The rerank pool (`RERANK_POOL` 30) is
   bigger than the whole fixture: 16 books, and per-book chunk and figure counts are smaller
   still. So the cross-encoder re-sorts every candidate and the fused order is discarded. The
   four fixtureOn reports have byte-identical rankings. On this corpus the reranker already
   closes the D-012 gap (RU 0.98, xl 1.00), which matches the D-012 post-hoc note.
2. **In fused order (fixtureOff), k=60 makes RRF too flat for a ≤2× weight to matter.** A
   cross-lingual answer is in the vector list only, because keyword gets 0 by construction.
   Every distractor that the RU query keyword-matches is in BOTH lists. Take the correct doc at
   vector rank 1 and a distractor at vector rank v and keyword rank s. The correct doc wins only
   when `w·(1/61 − 1/(60+v)) > 1/(60+s)`. For (v=2, s=1) that needs w ≈ 62. For (v=16, s=5) it
   needs w ≈ 4.8. Even the best case for the vector side sits far above 2.0, while EN
   `exact-identifier` already loses `id-05` at 1.25. cross-lingual stays 0.1781 at every weight.
3. **Live (rerank ON): changing the pool doesn't reach top-10.** The xl top-5 lists are
   identical at w=1.0 and w=2.0. Live xl Hit@1 is already 0.75. Its nDCG ceiling comes from
   the broad topic labels (recall@5 is capped by label-set size), not from fusion. Meanwhile
   `id-03` loses its Hit@1 at w ≥ 1.5 because the keyword half carries exact identifiers.

## Implications

- A static weight does not fix the fused-order RU gap. Query-adaptive weighting would not
  help much either, because the binding term is RRF's k-flatness, not the weight. The RU gates
  never pass, so the "adaptive-needed" branch of the selection rule does not trigger. Not built
  (non-goal).
- The shipped default (reranker ON) has no fusion-shaped RU gap left on the fixture. The
  remaining exposure is the reranker-degraded path (busy / unavailable / disabled). Levers
  there are out of #142's scope: `RRF_K`, a vector-only fallback when the keyword half is
  empty or cross-script, or keeping the vector order on rerank skip.
- The fixture can no longer separate fusion variants with the reranker ON. Future fusion
  tuning must gate on `--rerank off` and live, as this sweep did.
- #140 (EmbeddingGemma 2 bake-off) is not masked by fusion weights. Run it reranker-OFF as
  D-012 did.

# RERANK_FLOOR calibration (2026-10-23) — verdict: 0.3 stays

Gates declared + committed before measuring (`thresholds.json` `rerankFloor`, commit
`acc89db`, D-012). One fixture run (`2026-10-23-acc89db-rerankfloor-fixture.*`, reranker ON,
all modes) and one live run (`2026-10-23-acc89db-rerankfloor-live.*`, hybrid+vector, a copy of
the real `Programming_Books` index in a scratch work dir, UNVERIFIED labels) at shipped code.
Each candidate floor is replayed offline over the recorded per-row `maxRerank`/`maxScore`
(`rerank-floor.ts`). The floor only toggles `lowConfidence`, so rankings are identical for
every candidate.

```
node --import tsx test/eval/retrieval/rerank-floor.ts \
  --fixture test/eval/retrieval/reports/2026-10-23-acc89db-rerankfloor-fixture.json \
  --live    test/eval/retrieval/reports/2026-10-23-acc89db-rerankfloor-live.json
```

## Mechanical result

| floor | negative separation | fixture false flags | live false-flag rate | live negatives unflagged |
|---|---|---|---|---|
| 0.3 | PASS | 38/112 (33.9%) | 3.0% | none |
| 0.1 | PASS | 22/112 (19.6%) | 0.0% | none |
| 0.03 | PASS | 14/112 (12.5%) | 0.0% | neg-02/hybrid, neg-02/vector |
| 0.01 | FAIL | 12/112 (10.7%) | 0.0% | neg-02/hybrid, neg-01/vector, neg-02/vector, neg-05/vector |
| 0.005 | FAIL | 10/112 (8.9%) | 0.0% | neg-01/hybrid, neg-02/hybrid, neg-03/hybrid, neg-01/vector, neg-02/vector, neg-03/vector, neg-05/vector |
| 0.003 | FAIL | 6/112 (5.4%) | 0.0% | neg-01/hybrid, neg-02/hybrid, neg-03/hybrid, neg-05/hybrid, neg-01/vector, neg-02/vector, neg-03/vector, neg-05/vector |

max fixture negative maxRerank: 0.01152; min fixture Hit@1-positive maxRerank: 0.0003346; clean separation: NO
best by selection rule: 0.03; zeroBroken (nonRegression gate on the fixture report): FAIL
selected: 0.3 (current floor stays)

The selection rule's best candidate is **0.03**: all fixture negatives sit below F/2 and the
fixture false-flag rate drops from 33.9% to 12.5%. It is **not adopted** because the declared
`zeroBroken` precondition fails. The nonRegression gate is red on `main` itself: `sp-11`
drops Hit@1 in hybrid and vector. That is the #139 transformers 4.3.1 reranker-logit drift
the #140 bake-off already flagged. It does not depend on the floor, because the floor cannot
change rankings. Every other gate passes, including negatives flagged 6/6.

## Distributions (reranked rows, hybrid + vector)

| population | n rows | min maxRerank | max maxRerank |
|---|---|---|---|
| fixture negatives (negative + figure-negative) | 18 | 2.15e-5 (neg-06) | 0.01152 (figneg-01) |
| fixture positives, Hit@1 = 1 | 112 | 3.35e-4 (id-09) | 0.9995 |
| live negatives | 12 | 0.00141 (neg-06) | **0.0791 (neg-02)** |
| live positives, Hit@1 = 1 | 33 | **0.1423 (sp-11/vector)** | 0.9976 |

Fixture Hit@1 positives under 0.03 are id-09 (marker-stacked fixture, known), xl-05, xl-02,
xl-06, xl-01 (cross-lingual) and sp-01. No floor separates the fixture cleanly: the lowest
positive (3.3e-4) sits below the highest negative (0.0115).

## Why the live triage matters more than the fixture here

The two populations sit on different absolute scales:

- **Fixture positives score low** because the fixture "books" are short, self-authored
  passages. The cross-encoder gives them sigmoids around 1e-3 even when they rank first.
- **Live positives score high.** Real books contain real answers, so the minimum is 0.14 and
  only 1 of 33 Hit@1 rows (sp-11 vector, 0.142) is flagged at 0.3, a 3.0% false-flag rate.
  The "half of correct answers flagged" finding from #140 does not hold on the real library.
- **A real negative leaks at 0.03.** neg-02 ("training a golden retriever puppy not to bite")
  scores 0.079 with cosine 0.853, so neither signal would flag it.

On live, the only candidate that separates both groups is **0.1**: negatives ≤ 0.079 and
positives ≥ 0.142, with 0 false flags and every negative flagged. The margin is thin, though,
and that is n = 12 negatives on unverified labels. Switching to 0.1 now would be post-hoc
tuning, so it stays a recommendation for a future pre-declared run.

## Follow-ups

1. Fix or re-baseline the `sp-11` nonRegression break on main (#139 drift). Until then no
   eval-gated change can be adopted.
2. Verify the live labels (live-relevance.json is still `unverified`) and add more live
   negatives. Then pre-declare a live-informed floor rule (candidate 0.1) and re-run.

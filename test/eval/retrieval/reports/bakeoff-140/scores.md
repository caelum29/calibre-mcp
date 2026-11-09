## e5-small — RRF weight sweep (hybrid nDCG@10)

| VECTOR_RRF_WEIGHT | ON overall / RU / xl | OFF overall / RU / xl | exact-id ON / OFF | front-matter ON / OFF | EN vs own w=1.0 |
|---|---|---|---|---|---|
| 1 | 0.9690 / 0.9824 / 1.0000 | 0.8429 / 0.6339 / 0.1781 | 0.9167 / 1.0000 | 1.0000 / 0.8770 | ok |
| 1.5 | 0.9690 / 0.9824 / 1.0000 | 0.8429 / 0.6339 / 0.1781 | 0.9167 / 1.0000 | 1.0000 / 0.8770 | ok |
| 2 | 0.9690 / 0.9824 / 1.0000 | 0.8429 / 0.6339 / 0.1781 | 0.9167 / 1.0000 | 1.0000 / 0.8770 | ok |

Operating point: **w=1**

## gemma2-768 — RRF weight sweep (hybrid nDCG@10)

| VECTOR_RRF_WEIGHT | ON overall / RU / xl | OFF overall / RU / xl | exact-id ON / OFF | front-matter ON / OFF | EN vs own w=1.0 |
|---|---|---|---|---|---|
| 1 | 0.9825 / 0.9824 / 1.0000 | 0.8585 / 0.6577 / 0.1781 | 0.9489 / 1.0000 | 1.0000 / 0.8770 | ok |
| 1.5 | 0.9825 / 0.9824 / 1.0000 | 0.8519 / 0.6577 / 0.1781 | 0.9489 / 0.9692 | 1.0000 / 0.8770 | EN ✗ (off exact-identifier drop 0.0308 broken [id-05]) |
| 2 | 0.9825 / 0.9824 / 1.0000 | 0.8495 / 0.6577 / 0.1781 | 0.9489 / 0.9583 | 1.0000 / 0.8770 | EN ✗ (off exact-identifier drop 0.0417 broken [id-05]) |

Operating point: **w=1**

## gemma2-256 — RRF weight sweep (hybrid nDCG@10)

| VECTOR_RRF_WEIGHT | ON overall / RU / xl | OFF overall / RU / xl | exact-id ON / OFF | front-matter ON / OFF | EN vs own w=1.0 |
|---|---|---|---|---|---|
| 1 | 0.9825 / 0.9824 / 1.0000 | 0.8519 / 0.6577 / 0.1781 | 0.9489 / 0.9692 | 1.0000 / 0.8770 | ok |
| 1.5 | 0.9825 / 0.9824 / 1.0000 | 0.8483 / 0.6577 / 0.1781 | 0.9489 / 0.9526 | 1.0000 / 0.8770 | EN ✗ (off exact-identifier drop 0.0166 broken []) |
| 2 | 0.9825 / 0.9824 / 1.0000 | 0.8483 / 0.6577 / 0.1781 | 0.9489 / 0.9526 | 1.0000 / 0.8770 | EN ✗ (off exact-identifier drop 0.0166 broken []) |

Operating point: **w=1**

## Comparison at operating points — rerank ON (nDCG@10 / Hit@1)

| model (w) | hybrid overall | hybrid RU | hybrid xl | vector overall | vector RU | vector xl | keyword overall |
|---|---|---|---|---|---|---|---|
| e5-small (1) | 0.9690 / 0.9464 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.9690 / 0.9464 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.8082 / 0.7857 |
| gemma2-768 (1) | 0.9825 / 0.9643 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.9825 / 0.9643 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.8082 / 0.7857 |
| gemma2-256 (1) | 0.9825 / 0.9643 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.9825 / 0.9643 | 0.9824 / 0.9524 | 1.0000 / 1.0000 | 0.8082 / 0.7857 |

Per-kind nDCG@10 (hybrid / vector):

| model | cross-lingual | exact-identifier | figure-caption | front-matter-trap | ru-monolingual | semantic-paraphrase |
|---|---|---|---|---|---|---|
| e5-small | 1.0000 / 1.0000 | 0.9167 / 0.9167 | 0.9590 / 0.9590 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.9769 / 0.9769 |
| gemma2-768 | 1.0000 / 1.0000 | 0.9489 / 0.9489 | 0.9590 / 0.9590 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 |
| gemma2-256 | 1.0000 / 1.0000 | 0.9489 / 0.9489 | 0.9590 / 0.9590 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 |

## Comparison at operating points — rerank OFF (nDCG@10 / Hit@1)

| model (w) | hybrid overall | hybrid RU | hybrid xl | vector overall | vector RU | vector xl | keyword overall |
|---|---|---|---|---|---|---|---|
| e5-small (1) | 0.8429 / 0.7679 | 0.6339 / 0.5238 | 0.1781 / 0.0000 | 0.9039 / 0.7857 | 0.8433 / 0.6667 | 0.6513 / 0.2500 | 0.8082 / 0.7857 |
| gemma2-768 (1) | 0.8585 / 0.8036 | 0.6577 / 0.5714 | 0.1781 / 0.0000 | 0.9779 / 0.9464 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.8082 / 0.7857 |
| gemma2-256 (1) | 0.8519 / 0.7857 | 0.6577 / 0.5714 | 0.1781 / 0.0000 | 0.9726 / 0.9464 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.8082 / 0.7857 |

Per-kind nDCG@10 (hybrid / vector):

| model | cross-lingual | exact-identifier | figure-caption | front-matter-trap | ru-monolingual | semantic-paraphrase |
|---|---|---|---|---|---|---|
| e5-small | 0.1781 / 0.6513 | 1.0000 / 0.9182 | 0.8763 / 0.9444 | 0.8770 / 0.8770 | 1.0000 / 1.0000 | 0.9539 / 0.9539 |
| gemma2-768 | 0.1781 / 1.0000 | 1.0000 / 0.9583 | 0.9319 / 1.0000 | 0.8770 / 0.8770 | 1.0000 / 1.0000 | 0.9769 / 0.9769 |
| gemma2-256 | 0.1781 / 1.0000 | 0.9692 / 0.9444 | 0.9319 / 1.0000 | 0.8770 / 0.8770 | 1.0000 / 1.0000 | 0.9769 / 0.9688 |

## Gates G1–G4 (vs e5-small at its operating point)

- e5-small (4.3.1) G4 zero-broken vs the frozen gate baseline: FAIL — non-regression hybrid: broken Hit@1 queries: 1 broken (allowed 0): sp-11; non-regression vector: broken Hit@1 queries: 1 broken (allowed 0): sp-11

### gemma2-768 (w=1) — G1–G4 PASS
- [PASS] G1 off vector RU — +0.1567 (need ≥+0.0500)
- [PASS] G1 off hybrid RU — +0.0238 (need ≥+0.0200)
- [PASS] G1 on vector RU — +0.0000 (need ≥+0.0000)
- [PASS] G1 on hybrid RU — +0.0000 (need ≥+0.0000)
- [PASS] G2 off vector cross-lingual — +0.3487 (need ≥+0.0500)
- [PASS] G3 on hybrid overall — drop -0.0135 (≤0.01)
- [PASS] G3 on vector overall — drop -0.0135 (≤0.01)
- [PASS] G3 on hybrid exact-identifier — drop -0.0322, broken Hit@1 []
- [PASS] G3 on hybrid front-matter-trap — drop 0.0000, broken Hit@1 []
- [PASS] G3 on hybrid semantic-paraphrase — drop -0.0231
- [PASS] G3 on vector semantic-paraphrase — drop -0.0231
- [PASS] G3 off hybrid overall — drop -0.0156 (≤0.01)
- [PASS] G3 off vector overall — drop -0.0740 (≤0.01)
- [PASS] G3 off hybrid exact-identifier — drop 0.0000, broken Hit@1 []
- [PASS] G3 off hybrid front-matter-trap — drop 0.0000, broken Hit@1 []
- [PASS] G3 off hybrid semantic-paraphrase — drop -0.0230
- [PASS] G3 off vector semantic-paraphrase — drop -0.0230
- [PASS] G4 zero-broken (on, w=1.0) — PASS

### gemma2-256 (w=1) — G1–G4 FAIL
- [PASS] G1 off vector RU — +0.1567 (need ≥+0.0500)
- [PASS] G1 off hybrid RU — +0.0238 (need ≥+0.0200)
- [PASS] G1 on vector RU — +0.0000 (need ≥+0.0000)
- [PASS] G1 on hybrid RU — +0.0000 (need ≥+0.0000)
- [PASS] G2 off vector cross-lingual — +0.3487 (need ≥+0.0500)
- [PASS] G3 on hybrid overall — drop -0.0135 (≤0.01)
- [PASS] G3 on vector overall — drop -0.0135 (≤0.01)
- [PASS] G3 on hybrid exact-identifier — drop -0.0322, broken Hit@1 []
- [PASS] G3 on hybrid front-matter-trap — drop 0.0000, broken Hit@1 []
- [PASS] G3 on hybrid semantic-paraphrase — drop -0.0231
- [PASS] G3 on vector semantic-paraphrase — drop -0.0231
- [PASS] G3 off hybrid overall — drop -0.0090 (≤0.01)
- [PASS] G3 off vector overall — drop -0.0687 (≤0.01)
- [FAIL] G3 off hybrid exact-identifier — drop 0.0308, broken Hit@1 [id-05]
- [PASS] G3 off hybrid front-matter-trap — drop 0.0000, broken Hit@1 []
- [PASS] G3 off hybrid semantic-paraphrase — drop -0.0230
- [PASS] G3 off vector semantic-paraphrase — drop -0.0149
- [PASS] G4 zero-broken (on, w=1.0) — PASS

## Floors

| model | vector maxScore positives | negatives | semanticFloor (rule) | positives flagged | rerank max positives | negatives | negatives < 0.3 | positives < 0.3 |
|---|---|---|---|---|---|---|---|---|
| e5-small | 0.798–0.896 | 0.771–0.810 | 0.82 (no gap) | 5/38 | 0.000–0.994 | 0.000–0.001 | 12/12 | 36/76 |
| gemma2-768 | 0.653–0.820 | 0.538–0.571 | 0.61 (gap midpoint) | 0/38 | 0.005–0.994 | 0.000–0.001 | 12/12 | 24/76 |
| gemma2-256 | 0.682–0.842 | 0.555–0.620 | 0.65 (gap midpoint) | 0/38 | 0.001–0.994 | 0.000–0.001 | 12/12 | 30/76 |

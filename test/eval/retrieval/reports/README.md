# Committed eval reports — reading notes

Reports are append-only decision records: **never rewritten**, even when the harness
changes. Read them with these caveats:

- **Metric quirk in every report BEFORE `*-post-metricfix`:** binary nDCG@10 credited EVERY
  position matching a label (recall deduped, nDCG did not), so duplicate-label positions —
  e.g. two book-scope chunks covering the same labeled span — could inflate nDCG past 1.0.
  Fixed 2026-07-09 (`metrics.ts` `ndcgAtK` label dedupe); the corrected-current-state run
  `2026-07-08-ceca19a-post-metricfix` (UTC-dated) is byte-identical to the prior reranker
  report on every metric — no committed number was actually inflated — but future
  book-scope tuning would have been. Compare across the fix boundary with care.
- `*-live*` reports use `live-relevance.json` labels that are **UNVERIFIED** until Artem
  confirms them (verification planned after the full-library rebuild).
- `rerank:` in each report's meta line records whether the D-011 cross-encoder stage ran
  (`--rerank off` disables it; `rerankedRows` counts rows it actually reordered).

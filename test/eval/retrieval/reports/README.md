# Committed eval reports — reading notes

Reports are append-only decision records: **never rewritten**, even when the harness
changes. Read them with these caveats:

- **Metric quirk in reports dated ≤ 2026-07-08:** binary nDCG@10 credited EVERY position
  matching a label (recall deduped, nDCG did not), so duplicate-label positions — e.g. two
  book-scope chunks covering the same labeled span — inflated nDCG and could push it past
  1.0. No committed report contains an out-of-range value, but in-range values may be
  slightly inflated. Fixed 2026-07-09 (`metrics.ts` `ndcgAtK` label dedupe); the first
  corrected-current-state run is `2026-07-09-*-post-metricfix`. Compare across the fix
  boundary with care.
- `*-live*` reports use `live-relevance.json` labels that are **UNVERIFIED** until Artem
  confirms them (verification planned after the full-library rebuild).
- `rerank:` in each report's meta line records whether the D-011 cross-encoder stage ran
  (`--rerank off` disables it; `rerankedRows` counts rows it actually reordered).

# #102 phase 2 — heading-structured front-matter fixture (117): the gate can now see the rule

Follow-up to `2026-10-21-issue102-front-matter.md`. That run passed the gate, but no fixture
had Markdown headings, so `leadingFrontMatter` returned 0 for all 16 fixtures and the gate
could not measure it. This adds a fixture that only the #102 rule can handle, plus a gate
for it.

## Fixture 117 — *Observability in Practice* (self-authored)

The shape matches book 929 *Vector Databases*. The topic is different on purpose, so it
doesn't compete with the library-scope queries for 103/104:

- `# Title` ×2, `# Copyright`, `# Revision History for the First Edition`.
- `# Preface` → `## What's in This Book`: one summary paragraph per chapter. Each one
  repeats its chapter's query terms ("what an error budget is, how an error budget is
  computed…").
- `# **Chapter 1. **…` through `# **Chapter 4. **…` body, each chapter with a definitional
  passage.

Boundaries (12 407 chars):

| | boundary | front-matter chunks |
|---|---|---|
| D-016 chapter detector alone | 0 (structural, title page at char 0) | 0 |
| `frontMatterEnd` with #102 | **2 273** (`anchor`, `Chapter 1. Observability Versus Monitoring`) | 1 (`@0-1963`) |

The smoke test `harness.test.ts` keeps all three properties: the rule claims a boundary >
0, D-016's first chapter stays at 0, and `frontMatterEnd` equals the rule's boundary. A
later fixture edit can't silently make the gate blind again.

Queries (`front-matter-trap`, scope book 117, span labels on the body definitions):
`fmt-04` "what is observability", `fmt-05` "what is a span in distributed tracing",
`fmt-06` "what is an error budget".

## Gate (declared before the rule-on run, D-012)

`thresholds.json` → `headingFrontMatter`, committed in bab0b03 before measuring (Artem
chose a dedicated block over relying on `nonRegression`). `nonRegression` only diffs queries
that exist in `baselineReport` (issue18-after), so it cannot see new queries. The block
requires Hit@1 on ≥ 2/3 of `fmt-04..06` in keyword mode and 3/3 in hybrid/vector. A missing
query counts as a miss.

## Results

Two full runs of the same fixture set at the same tree. The only difference: in the rule-off
run, `frontMatterEnd` dropped the `leadingFrontMatter` term, via an uncommitted one-line
patch in a scratch worktree.

- Rule ON: `2026-10-23-bab0b03-issue102-fixture.{md,json}` — `pnpm eval --gate` → **GATE PASS**
  (all non-regression, figure and heading-front-matter checks).
- Rule OFF: `2026-10-23-021cf6d-issue102-fixture-rule-off.{md,json}` — comparison artifact,
  not a gate.

| query | keyword top-1, rule OFF | keyword top-1, rule ON | hybrid/vector top-1 (both) |
|---|---|---|---|
| fmt-04 | `@0-1963` preface ✗ | `@1963-4009` ✓ | ✓ |
| fmt-05 | `@0-1963` preface ✗ | `@6994-8926` ✓ | ✓ |
| fmt-06 | `@0-1963` preface ✗ | `@10847-12407` ✓ | ✓ |

| `front-matter-trap` kind (6 queries: 116 + 117) | Hit@1 | MRR | nDCG@10 |
|---|---|---|---|
| keyword, rule OFF | 0.167 | 0.583 | 0.692 |
| keyword, rule ON | **0.667** | 0.833 | 0.877 |
| hybrid / vector, both | 1 | 1 | 1 |

- **Keyword trap Hit@1 on fixture 117: 0/3 → 3/3.** BM25 ranks the keyword-dense preface
  summary first for every query. Demotion pushes it below the body hits. The 2 remaining
  keyword misses are 116's `fmt-02`/`fmt-03`, unchanged from every report since #18: the
  winners there are body chunks, not front matter.
- Hybrid/vector already hit 3/3 with the rule off. The rule still drops the preface chunk
  from rank 2 out of the top 3 in all six rows. That is the demotion working, and
  Hit@1/nDCG don't register it.
- **Diff across all 204 per-query rows: only these 9 (fmt-04..06 × 3 modes) changed.** The
  other 59 queries have identical metrics and top-3 in both runs. Overall keyword Hit@1 went 0.746 → 0.797,
  entirely from 117. Adding 117 to the library-scope corpus broke no existing query and kept
  6/6 negatives flagged.

Timings are meaningless (≈ 50 min per run, load average 50–67 from concurrent sessions).

Provenance note: the runs were measured on the pre-squash #170 branch. `bab0b03` and `021cf6d`
in the report names and above are pre-rebase SHAs. On main, the gate declaration is
"eval: declare headingFrontMatter gate before the rule-on run". The base later gained
#165/#169 (figure-caption fixtures/EPUB marker placement). Those don't touch the text fixtures or
the front-matter path, so the eval was not re-run.

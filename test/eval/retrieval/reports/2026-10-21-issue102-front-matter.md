# #102 — heading-structured front matter (D-016 EPUB gap): evidence + recommended rule

Issue #102. Rule: `src/domain/structure/front-matter.ts` (`leadingFrontMatter`).
`frontMatterEnd` moved into the same module. It returns the later of the chapter
detector's first chapter (PDF outline / numeric / structural, #134) and this rule.
Tests: `test/domain/structure/front-matter.test.ts`. After the move, `frontMatterEnd`
was re-run on all 773 books: 0 boundary mismatches against the measurements below.

## Method (read-only)

- **Corpus = the whole library, not a sample.** Each indexed book's text was rebuilt
  from its `chunks` rows in the production index (`Programming_Books.sqlite`, opened
  `readOnly`; chunk bodies are verbatim slices at their `char_start`, overlaps are
  identical, gaps are whitespace-only chunks). 773 books: 175 EPUB, 598 PDF (format
  from the #87 re-index `progress.jsonl`). Nothing was written to the library or index.
- "Front-matter chunks" = the build_index majority rule (≥50% of a chunk before the
  boundary) applied to the book's real chunk offsets, so counts are what a re-index
  would store.
- **Before** = today's `frontMatterEnd` on the rebuilt text. Note: today's code already
  covers more than the stored index (68 EPUBs claim a boundary vs 40 with flagged
  chunks) because most of those 68 boundaries are a title-page heading 17–3000 chars in,
  too shallow to flag any chunk. "Covered" below = at least one flagged chunk.

## Why EPUBs miss

Survey of the EPUBs `frontMatterEnd` returns 0 for, by cause:

| cause | EPUBs |
|---|---|
| structural detector, first heading at char ~0 | 92 |
| numeric detector, first chapter past the cap | 9 |
| no headings at all (plain-text EPUB) | 5 |
| structural, past the cap | 1 |

The numeric detector misses decorated chapter headings: EPUB→Markdown emits
`# **Chapter 1. **Introduction…`, `# CHAPTER 1**Routing**`, `# **1****`, `# \[ 1 \]`,
and `EXPLICIT_CHAPTER` is anchored at `^\s*chapter`. The structural fallback then
treats the title page as chapter 1.

## Recommended rule (`leadingFrontMatter`)

Applied as `fmEnd = max(frontMatterEnd(text), leadingFrontMatter(text).end)`. The new
rule only ever moves a boundary later, and only on heading-structured text.

1. **Anchor.** The first-chapter heading after decoration stripping (`*`, `_`, `\`
   escapes, `[ n ]` boxes): `Chapter 1…`, `CHAPTER 1`, `Глава 1`, `Part I` / `Part 1:`,
   `1 Title`, `1. Title`, bare `1`. `1.1 …` sub-numbering does not count. Among the
   chapter-1 headings within the cap, take the one with the longest gap to the next
   chapter-2 heading. That skips TOC copies, and the gap must be ≥ `FM_SHORT_SECTION_CHARS`,
   so a numbered list item never anchors. A `Part I` heading within that distance
   before Chapter 1 becomes the boundary instead.
2. **Run** (only if no anchor, and only when the first heading sits ≤
   `FM_FIRST_HEADING_MAX_CHARS` from the start). Walk the leading sections:
   - Short unnamed sections before any named one are title-page stubs.
   - Named front-matter sections (EN/RU/UK title list) absorb their subsections.
   - The body starts at the first unnamed section after a named one, or at the first
     long unnamed section.
3. **Same plausibility cap as D-016.** A boundary past min(20% of the text, 60k chars)
   claims nothing.

| constant | value | why |
|---|---|---|
| `FM_MAX_FRACTION` / `FM_MAX_CHARS` | 0.2 / 60 000 | unchanged D-016 guard |
| `FM_SHORT_SECTION_CHARS` | 2 500 | title/copyright/revision stubs run 70–2 300 chars (Manning copyright ≈ 2 200); also the min chapter-1→chapter-2 gap |
| `FM_FIRST_HEADING_MAX_CHARS` | 1 500 | restricts the run rule to heading-first texts (see PDF FPs below) |
| `FM_MAX_RUN_SECTIONS` | 40 | a TOC rendered as headings is long; past this we are in the body |
| front-matter title list | ~80 patterns | whole-title match: praise, copyright, dedication, contents, revision history, foreword, preface, acknowledgments, about the author/reviewer/book/cover, O'Reilly/Manning/Packt/No Starch preface boilerplate; RU предисловие/оглавление/содержание/благодарности/об авторе…; UK передмова/зміст/подяки/про автора |

## Results (all 773 books)

| | books | covered before | covered after | front-matter chunks before → after |
|---|---|---|---|---|
| **EPUB** | 175 | 40 (23%) | **166 (95%)** | 182 → 1 779 (of 63 779) |
| PDF | 598 | 345 (58%) | 345 (58%), **unchanged** | 5 336 → 5 336 |

- Rule breakdown for EPUBs: 135 anchor, 14 run, 19 keep D-016's own boundary, 7 claim nothing.
  The 7 with nothing: 5 heading-less, 1 Gutenberg text whose TOC is one 1 000-char line,
  1 whose first heading is 4 k in.
- The `fill-only` variant (use the new rule only when D-016 claims 0) reaches 140/175
  (80%). `max` adds 26 more books, where D-016's boundary is a title-page heading
  17–3 000 chars in. Every one of those 45 "new > old" boundaries was checked: each is a
  real Chapter 1 / Part I.
- 145 books change, all EPUB. Per changed book: median front-matter chunks 0 → 10
  (max 39); median boundary depth 3.3% of the book (max 11.3%).
- Book 929 *Vector Databases*: boundary 0 → 17 294 chars (`Chapter 1. Introduction to
  Vector Databases`), 0 → 9 chunks. This matches the ~17k front matter cited in the
  issue.
- RU: the 3 RU EPUBs are already covered by D-016 (`Часть I`, numbered/structural);
  the RU/UK title list is exercised by unit tests only.

## False positives (spot-checked by reading)

The headings demoted in each of the 149 anchor/run books were listed and read.

Fixed while iterating:
- **PDF `# code comments` as headings.** 9 PDFs (`# Iterate over the retrieved
  documents`, `# Close connection`…) got run-rule boundaries deep in chapter 1 →
  `FM_FIRST_HEADING_MAX_CHARS` gate. PDFs are now untouched.
- **Short chapter openers absorbed by length.** Packt's `Introducing and Installing
  Rust` is 600 chars before its first subsection, so the run walked 5–12k into chapter 1
  (books 622/627/636) → after a named section, length no longer extends the run.
- **Numbered list item as anchor.** `**1.** **Transaction Support**` (760) → minimum
  chapter-1→2 gap.
- **Preface-TOC `Chapter 1:` entry** chosen over the real `[ 1 ]` heading (767) →
  `[ n ]` unboxing.

Residual (accepted; same behaviour D-016 already has for PDFs, where everything
before `Chapter 1` is front matter):
- A substantive **Introduction / preface primer before Chapter 1** is demoted:
  162/420 *Mastering API Architecture* (Introduction ≈ 27k chars), 807 *Learning
  LangChain* (LLM primer in the preface), 804 (preface essays). In 11 anchor books an
  `Introduction` heading precedes Chapter 1. Reading their openings: 2 are substantive
  (162/420). The other 9 are motivational or about-the-book framing ("welcome to the
  book", "who is this book for", a career anecdote). An "Introduction carve-out" would
  help 2 books and un-demote 9, so it is not recommended.
- An unnumbered Part intro before `1.` (903, ~3.5k chars).
- Demotion re-ranks; nothing is dropped. `[front matter]` hits still surface below body
  matches.

Conservative misses (no harm): Packt boilerplate titles missing from the list stop the
run early (e.g. `Landmarks`, `Join our Discord`). That loses demotion but never demotes
the body.

## Retrieval non-regression gate

`pnpm eval --gate` was run with the rule wired into `calibre_build_index` as
`max(frontMatterEnd, leadingFrontMatter)`. That is the same function that shipped.
Report: `2026-10-21-71cc6f2-issue102-prototype.md`. The fixture
corpus has **no heading-structured book**: `leadingFrontMatter` returns 0 for all 16
fixtures, including 116's plain-text front matter, which D-016 keeps at 1 485. So the
gate shows no regression by construction, but it cannot see the new path. Phase 2 should
add a heading-first `front-matter-trap` fixture (an EPUB-shaped 929 analogue) so the rule
is measured, not just unit-tested.

**Result: GATE PASS.**

| mode | broken Hit@1 queries (allowed) | negatives flagged | Hit@1 / nDCG@10 overall |
|---|---|---|---|
| hybrid | 0 (0) | 6/6 | 0.964 / 0.987 |
| vector | 0 (0) | 6/6 | 0.964 / 0.987 |
| keyword | 0 (1) | — | 0.786 / 0.808 |

Figure-caption gates also pass. The run took 24.7 min, but timings mean nothing here:
#142's CPU-heavy evals were running concurrently, load average ~45.

## Re-index impact (Phase 2)

The rule changes `chunks.front_matter` for 145 EPUBs. The schema is unchanged, so this
is an additive data change like D-016: no INDEX_VERSION bump and no forced rebuild.
Books gain demotion when re-indexed. The full list of affected books (id, rule,
boundary heading, chunks before → after) was produced from the measurement run. Phase 2
reports it. The production index is never rebuilt by this work.

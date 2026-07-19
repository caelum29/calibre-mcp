---
name: calibre-distill
description: "Turn ONE Calibre book into a reusable agent skill — frameworks, mental models, principles, techniques, anti-patterns, glossary, cheatsheet — by driving the calibre-mcp server (chapter map, keyword + semantic in-book search; no temp files, no Python). Use when the user wants to study a Calibre book through Claude Code / Copilot / Amp, apply an author's frameworks while working, fold a new source or a targeted topic slice into an existing skill, or stamp what they learned back into the library (tags + distill note via the gated write tools). Works on EN + RU/UK books. Single-book distiller — for one topic synthesized across several books, use the sibling calibre-distill-topic."
---

<!--
Provenance: forked from virgiliojr94/book-to-skill (MIT, © 2025 virgiliojr94) @ bd33a90.
Steps 3–9, the Fold-in workflow, and the Quality Rules are adapted nearly verbatim; the
extraction/access mechanics are replaced with calibre-mcp tool calls (no Python, no temp
files) and two calibre-only additions: Mode 5 (targeted topic fold-in via in-book search)
and Step 9.5 (library write-back through the gated write tools).

Cross-agent notes (informational; ignored by host agents):
  - Compatible skill roots: Claude Code (~/.claude/skills, .claude/skills), GitHub
    Copilot CLI (~/.copilot/skills, ~/.agents/skills, .github/skills), Amp
    (.agents/skills, ~/.config/agents/skills).
  - `allowed-tools` intentionally omitted to stay agent-neutral. The skill needs the
    calibre-mcp tools (calibre_search, calibre_get_content, calibre_semantic_search, and
    — for write-back — calibre_update_book) plus file read/write for the generated skill.
  - Argument hint: <book id | title | search query> [skill-name-slug]
-->

# Calibre Distill

Turn a book already in your Calibre library into an actionable agent skill by extracting
its **structure** — not producing summaries. The calibre-mcp server supplies the chapter
map and in-book search; the host agent (this LLM) does all synthesis.

## Philosophy

Books contain crystallized expertise: frameworks, principles, and techniques that took
years to develop. This skill extracts that knowledge into a format a compatible agent can
leverage repeatedly.

**Extract structure, not summaries.** A skill isn't a book report. It's a toolkit of:
- Named frameworks (mental models with clear application)
- Actionable principles (rules that guide decisions)
- Techniques (step-by-step methods)
- Anti-patterns (what to avoid and why)
- Voice calibration (how the author thinks and communicates)

**Preserve the author's precision.** "The 5 Whys" isn't interchangeable with "ask why
multiple times." Capture the exact formulation.

**Layer depth appropriately.** Simple books → simple skills. Complex books with 10+
frameworks → skills with reference files and on-demand chapters.

**Why calibre-mcp instead of a local extractor:** the book is already in the library, so
there's nothing to upload or clean up. In-book keyword + semantic search (RU/UK-aware,
cross-lingual) lets you probe topics precisely instead of grepping a flat file, and the
byproducts can flow back into the catalog (Step 9.5).

---

## Modes of Operation

Route based on what the user asks:

### 1. Full Conversion (Default)
**Trigger:** A book reference (id / title / query) with no special instructions.
**Action:** Run Steps 0–9.
**Output:** Complete skill with SKILL.md, chapters/, glossary, patterns, cheatsheet.

### 2. Analyze Only
**Trigger:** "analyze", "just extract", "I want to review before generating".
**Action:** Run Steps 0–3, produce an extraction report, then stop.

### 3. Generate from Prior Analysis
**Trigger:** User has existing analysis notes / previously ran analyze-only.
**Action:** Skip Steps 0–3, run Steps 4–9 from the provided analysis.

### 4. Update / Fold-in — whole source (Existing Skill)
**Trigger:** An existing skill (folder or slug) **plus** a new book reference, no single
topic named.
**Action:** Steps 0–2, then the **Update / Fold-in Workflow** — merge the entire new book.

### 5. Targeted Fold-in — topic-scoped (Existing Skill) — *calibre-only*
**Trigger:** An existing skill **plus** a book reference **plus** an explicit topic/question
(e.g. "supplement `kafka-ops` with what book 187 says about *rebalancing*").
**Action:** Locate the topic with in-book search, read only the matching chapters, merge
that slice. See the **Targeted Fold-in Workflow** (§Mode 5). This is what a flat-file
pipeline cannot do — it needs ranked, cross-lingual retrieval.

> **Synthesizing ONE topic across MULTIPLE books (≥3) into a new concept-keyed skill?**
> That's a different artifact — use the sibling skill **`calibre-distill-topic`**, not a
> Mode here.

---

## Skill Locations

This distiller can generate skills for multiple agent systems. For the **generated** skill,
pick a destination the user's host agent can discover (see Step 5). Probe in order:

1. Claude Code personal: `~/.claude/skills/`
2. GitHub Copilot CLI personal: `~/.copilot/skills/` → `~/.agents/skills/`
3. Amp global: `~/.config/agents/skills/`
4. Project-local: `.claude/skills/` → `.github/skills/` → `.agents/skills/`

When more than one valid root exists, ask the user once and remember the answer for the
session — do not silently default.

**This skill itself** lives in the calibre-mcp repo (`skills/calibre-distill/`). Install it
by copying or symlinking to `~/.claude/skills/calibre-distill/`. Note: the calibre-mcp MCPB
bundle **cannot** ship skills — install the skill separately from the MCP server.

---

## Step 0 — Out-of-scope check

If no book reference is provided, stop:
> "calibre-distill needs a book — give me an id, title, or search query, plus an optional
> skill slug. Example: `calibre-distill 187 kafka-ops` or `calibre-distill "AI Engineering"`."

Requires the **calibre-mcp** server connected. If its tools aren't available, say so and
stop. Parse the input into the book reference and an optional `SKILL_NAME` slug (lowercase
hyphens). If the reference / slug matches an existing skill in a skills root, or the user
asks to update, flag this run as **Mode 4/5** (Fold-in).

---

## Step 1 — Resolve the book

Resolve the reference to a single Calibre book with `calibre_search`:
- Numeric id → confirm via `calibre_get_book` (title/authors).
- Title / query → `calibre_search`; if it returns **more than one** plausible match, list
  the top hits (id, title, author) and **ask which one** — never guess.
- No match → stop with the query echoed back.

Record `BOOK_ID`, title, authors, and available formats. Prefer EPUB, else PDF (scanned
PDFs yield no text — Calibre has no OCR; if `calibre_get_content` reports an image PDF,
tell the user this book can't be distilled).

Also record the **ISBN-13** — the stable, cross-machine key the artifact binds to (the L4
back-link / bibliography). If library metadata has none and **writes are enabled**, backfill it
once with `calibre_extract_isbn(id=BOOK_ID, apply=true)` — an offline scan of the book's own
front matter / back cover for a checksum-valid ISBN. If it finds nothing, or writes are off,
leave ISBN as "—" and rely on the `title:"…" AND authors:"…"` fallback key. (E2)

---

## Step 1.5 — Identify content type

Ask the user, **pre-suggesting from library metadata** (tags / format):

> "Is this book **technical** (code, tables, formulas — e.g. programming, papers) or
> **text-heavy** (mostly prose — management, narrative non-fiction)?
> Based on its tags/format I'd guess **<technical|text>** — confirm or correct."

Pre-suggest `technical` when tags include programming/engineering-ish terms or the format
is a code-dense PDF; else `text`. Store as `BOOK_TYPE ∈ {technical, text}`. (This mirrors
the reverse-direction win in Step 9.5: metadata helps the distill before the distill helps
the metadata.)

---

## Step 2 — Get the chapter map

Call `calibre_get_content` with `structure=true`:

```
calibre_get_content(id=<BOOK_ID>, structure=true)
```

Returns `structuredContent`:
- `chapters`: `[{ n, heading, startChar, endChar, approxTokens, cursor }]` — each `cursor`
  seeks straight to that chapter's start in a follow-up `calibre_get_content` call.
- `hasToc`, `detector` (`numeric` | `structural` | `none`), `totalChars`, `format`, `backend`.

If `detector = none` / `chapters = []`, the book has no machine-detectable headings — walk
it with plain `calibre_get_content` cursor pages (no `structure`) and infer sections from
the text, or treat the whole book as one section for a thin doc.

**No files are created and nothing is cached on your side** — the server holds the extracted
text in its own sha256 LRU cache, so re-runs and later chapter reads are fast.

---

## Step 2.5 — Pre-flight cost estimate

From the chapter map present an estimate **before generating anything**:

```
📖 Book: <Title> — <Author>   (id <BOOK_ID>, <format> via <backend>)
📄 Chapters: <N> (<detector>) | ToC: <yes/no> | Total: ~<totalChars/4/1000>K tokens

💰 Estimated token cost (Full Conversion / Update):
   Input  (chapter reads + prompts): ~<N>K tokens
   Output (skill files):             ~<N>K tokens
   Total:                            ~<N>K tokens
   ⏱  ~<N> minutes

📁 To generate: SKILL.md + <N> chapter files + glossary + patterns + cheatsheet

➡  Proceed? (or "analyze only" to preview first)
```

**How to estimate:**
- Token total ≈ `totalChars / 4`. Per-chapter tokens ≈ `approxTokens` from the map.
- Input ≈ Σ chapter tokens × 1.3 (prompt overhead per pass).
- Output ≈ chapters × per-chapter budget (Step 7 matrix) + 4,000 (SKILL.md) + 4,500
  (glossary + patterns + cheatsheet).
- Prices (as of 2026): Claude Sonnet input=$3/MTok output=$15/MTok — Haiku input=$0.80/MTok
  output=$4/MTok. Quote Sonnet and Haiku lines.

Wait for confirmation. "analyze only" → Mode 2.

---

## Step 2.6 — Targeted in-book access (don't dump the whole book)

Never load the whole book into context — you have precise probes. Treat the book as a
queryable corpus:

- **Read one chapter:** `calibre_get_content(id=<BOOK_ID>, cursor=<chapter.cursor>,
  maxChars=<budget>)` — pages from the chapter start; follow `nextCursor` if a chapter
  spans more than one page (stop at the next chapter's `startChar`).
- **Find a concept / where a topic lives:** `calibre_semantic_search(scope=book,
  bookId=<BOOK_ID>, query="<concept>")` → ranked passages with char offsets; map each hit's
  offset to a chapter via the Step 2 map. Cross-lingual and RU/UK-aware.
- **Exact term / verify a framework is really in the book:**
  `calibre_search(scope=book, id=<BOOK_ID>, query="<exact phrase>")` (FTS) — use the hit
  count as the "is this actually mentioned?" check before you claim it in SKILL.md.

Use these for Step 3 (structure), Step 7 (per-chapter reads), and Step 8 (glossary/patterns
extraction). Reading only the slices you need keeps generation cost proportional to output,
not to book size. Semantic search needs the book indexed (`calibre_build_index bookId=…`);
if it's not indexed, either build the index or fall back to FTS (`calibre_search`) — say
which you used.

---

## Step 3 — Analyze book structure

Using the chapter map (Step 2) plus a read of the first chapter / front matter, identify:
- Book **title** and **author(s)** (already known from Step 1 — reconcile).
- **Chapter structure** — the map gives you this directly; skim the ToC region if `hasToc`.
- **Core themes** and subject domain.

**If Mode 2 (Analyze Only):** produce the extraction report now and stop:
```
## Extraction Report — <Title>

### Author's Core Frameworks
- **<Framework Name>**: <what it is and when to apply>

### Key Principles
- <Principle>: <actionable rule>

### Techniques & Methods
- <Technique>: <step-by-step or how-to>

### Anti-patterns
- <What to avoid>: <why>

### Suggested Skill Name
`{author-lastname}-{core-concept}` — e.g. `huyen-ai-engineering`

### Chapters Detected
| # | Title | Main Frameworks |
```

---

## Step 4 — Ask purpose (Full Conversion only)

> "What should this skill help you do? (Pick one or more)
> 1. Apply the author's frameworks while working
> 2. Think with the author's mental models
> 3. Reference specific chapters and concepts
> 4. All of the above"

**Derive `DEPTH` (no extra prompt):**
- Answer is **only** option 3 → `DEPTH=reference` — lean, fast-lookup chapters.
- Answer includes 1, 2, or 4 → `DEPTH=study` — deeper chapters with worked detail.

`DEPTH` + `BOOK_TYPE` set the per-chapter budget in Step 7. (Modes 2/3 default `DEPTH=study`.)

---

## Step 5 — Determine skill name and destination

If `SKILL_NAME` was given, use it. Otherwise propose two and let the user choose:
- **By author-concept**: `{author-lastname}-{core-concept}` (e.g. `huyen-ai-engineering`)
- **By title**: lowercase-hyphen title (e.g. `designing-data-intensive-apps`)

Default to author-concept when the book has a strong methodological identity.

Choose the destination skill root (`SKILLS_HOME`) by the host the user is running in (see
**Skill Locations**). If exactly one candidate root exists, use it; if none, ask which to
create; if the user asked for project-local, prefer that. Check whether
`$SKILLS_HOME/<skill_name>/` already exists → if so, offer **Update/Fold-in (Mode 4/5)**,
**Overwrite**, or **Rename**.

---

## Step 6 — Create skill directory structure

```bash
mkdir -p "$SKILLS_HOME/<skill_name>/chapters"
```

---

## Step 7 — Generate chapter summaries

**TOKEN BUDGET RULE — CRITICAL (adaptive):**

| | `DEPTH=reference` | `DEPTH=study` |
|---|---|---|
| `BOOK_TYPE=text` | 800–1,200 tokens | 1,000–1,800 tokens |
| `BOOK_TYPE=technical` | 1,200–1,800 tokens | 2,000–3,000 tokens |

- Per-file targets, not hard caps. Density beats length (Quality Rule #3) — never pad.
- Chapter files load on-demand, so a bigger chapter only costs tokens when read.
- Between two cells, use the lower budget; depth comes from precision, not volume.

**`DEPTH=study` is earned with content, not a bigger number.** To reach the study budget
honestly a chapter must add concrete material:
- **Reconstruct one worked example** on a FRESH scenario under a `## Worked Example`
  section — the single biggest lever and the main thing a learner returns for.
- **Expand the "How" of each framework** into explicit steps or criteria.
- **Add a short "Why it works / failure mode" note** to the top 1–2 frameworks.

If a chapter genuinely has no worked example, let it land below the study floor and note it
is thin — don't pad. A `reference` chapter deliberately omits worked examples.

For EACH chapter in the Step 2 map: read it via its `cursor` (Step 2.6), then create
`$SKILLS_HOME/<skill_name>/chapters/ch<NN>-<slug>.md`. The `# Chapter N:` title should be a
concise paraphrase of the chapter's subject, **not** the book's verbatim heading (the
verbatim heading may appear only in the L4 footer metadata).

**Adapt emphasis by `BOOK_TYPE`:** `technical` → prioritize Code Examples, Reference Tables,
Commands & APIs; API/config identifiers and syntax rules are facts and stay exact, but the
author's own example code / tables get re-authored, not copied (see the sections below).
`text` → prioritize Frameworks, Mental Models, Key Takeaways; skip empty technical sections.

```markdown
# Chapter N: <paraphrased subject — not the book's verbatim heading>

## Core Idea
<1–2 sentences: the single most important thing this chapter teaches>

## Frameworks Introduced
- **<Framework Name>**: <exact formulation — preserve the author's naming>
  - When to use: <specific situation>
  - How: <steps or criteria>

## Key Concepts
- **<Term>**: <precise definition in 1 sentence>
(5–10 most important terms)

## Mental Models
<2–4 thinking tools. Write as "Use X when Y" or "Think of X as Y">

## Anti-patterns
- **<What to avoid>**: <why it fails>

## Code Examples *(technical books only — omit if BOOK_TYPE=text)*
<!-- Re-author a minimal example that demonstrates the same technique — fresh variable
     names, a fresh scenario. API/config identifiers and syntax rules are facts and stay
     exact; the author's example code does NOT get copied verbatim. -->
```<language>
<a re-authored minimal example demonstrating this chapter's technique>
```
- **What it demonstrates**: <one line>

## Reference Tables *(technical books only — omit if BOOK_TYPE=text)*
<!-- Re-author the decision content of any comparison/parameter/decision table: parameter
     names, values, thresholds are facts — keep them exact; the row prose and table
     composition are re-expressed. Don't lift the author's table verbatim. -->

## Worked Example *(DEPTH=study only — omit for DEPTH=reference)*
<!-- Reconstruct the author's method on a FRESH scenario of your own — new numbers, a new
     domain object — that exercises the same steps. Never re-tell the author's own example
     end-to-end, and never copy raw passages. -->

## Key Takeaways
1. <Actionable insight>
(3–7 takeaways a practitioner must remember)

## Connects To
- **Ch N**: <why this chapter relates>
- **<Concept>**: <external concept or standard>
```

---

## Step 8 — Generate supporting files

### glossary.md
`$SKILLS_HOME/<skill_name>/glossary.md` — every significant term, alphabetized. Format:
`**Term** — definition (Ch N)`. Max 1,500 tokens. Use `calibre_search scope=book` to
confirm a term's usage/chapter before listing it.

### patterns.md
`$SKILLS_HOME/<skill_name>/patterns.md` — all concrete techniques/patterns/algorithms.
Format: `## Pattern Name` / `**When to use**` / `**How**` / `**Trade-offs**`. Max 2,000 tokens.

### cheatsheet.md
`$SKILLS_HOME/<skill_name>/cheatsheet.md` — **the most differentiated layer; a reasoning
aid, not a keyword list.** It captures the author's *judgment*. Prioritize, in order:
1. **Decision rules** — "When X, do Y, because Z."
2. **Decision trees / flowcharts** (nested bullets or a small table) for >2-branch choices.
3. **Trade-off matrices** — options scored on the author's dimensions.
4. **Thresholds & defaults** — the specific numbers / rules of thumb the author commits to.
5. **Tells & smells** — fast heuristics for recognizing a situation.

Avoid bare term→definition rows (glossary) and prose paragraphs (chapters). Every line
helps the reader *decide* something. Compact tables + decision rules. Max 1,200 tokens.

---

## Step 9 — Generate the master SKILL.md

**CRITICAL TOKEN BUDGET: keep the SKILL.md body under 4,000 tokens.** Compaction truncates
from the END — put the most important content FIRST.

```markdown
---
name: <skill_name>
description: "Knowledge base from \"<Full Title>\" by <Author(s)>. Use when applying <author>'s frameworks for <3–6 key topics>, studying the book, or referencing its concepts."
---

<!-- argument-hint: [topic, framework name, or chapter number] -->

# <Full Title>
**Author**: <Author(s)> | **Chapters**: <N> | **Calibre id**: <BOOK_ID> | **Generated**: <YYYY-MM-DD>

## Attribution
<!-- Mandatory. Fill from library metadata (Step 1); ISBN may be backfilled via calibre_extract_isbn (Step 1). Leave "—" only if truly absent. -->
- **Title**: <Full Title>
- **Author(s)**: <Author(s)>
- **Publisher**: <Publisher>
- **ISBN**: <ISBN-13>
- This is a lossy, transformative study aid — **buy the book for the full treatment**.

## How to Use This Skill
- **Without arguments** — load core frameworks for reference
- **With a topic** — ask about an indexed topic; I read the relevant chapter
- **With chapter** — ask for `ch05`; I load that chapter
- **Browse** — ask "what chapters do you have?"

## Core Frameworks & Mental Models
<!-- ~2,000 tokens: the author's most important named frameworks and principles.
     Preserve exact names. Write as "Use X when Y", "Prefer X over Y because Z". -->

## Chapter Index
| # | Title | Key Frameworks |
|---|-------|----------------|
| [ch01](chapters/ch01-<slug>.md) | <Title> | <framework1>, <framework2> |
...

## Topic Index
<!-- Alphabetical. Major terms/frameworks → chapter(s). This is how the agent navigates. -->
- **<Term>** → ch<N>[, ch<N>]

## Supporting Files
- [glossary.md](glossary.md) — key terms
- [patterns.md](patterns.md) — techniques & patterns
- [cheatsheet.md](cheatsheet.md) — decision rules & quick reference

## Scope & Limits
This skill covers the book content only. Source: Calibre book <BOOK_ID>. For topics beyond
this book, check related skills or ask the agent directly.
```

---

## Step 9.5 — Library write-back (optional, opt-in) — *calibre-only*

Distillation byproducts can flow back into the **catalog** so it starts answering topic
queries without the semantic index, and raw-metadata books get enriched as a side effect of
being studied. This is a **separate, opt-in, final** step — the core distill above writes
nothing to Calibre.

Requires the write gate on (`CALIBRE_MCP_ENABLE_WRITE=1`). If the write tools are absent,
report "skipping library stamping (writes disabled)" and finish normally.

| Artifact | Destination | Mechanics |
|---|---|---|
| Topic-Index topics (~5–12, not every glossary term) | `tags` (+ marker tag `distilled`) | `calibre_update_book`; **read → union → write** (set_metadata replaces the whole field, so merge first — same pattern as `calibre_extract_isbn` identifiers) |
| Compact distill note (date + skill slug + core framework names, a few lines) | `comments` (append a delimited block) | human-visible in the GUI, agent-visible via `calibre_get_book` |
| Full glossary / machine artifacts | a `#custom` column (e.g. `#distill`), **only if it already exists** | probe first; degrade with a note if absent — never auto-create columns |

**Rules:**
- **Preview-first:** show the proposed tag/comment diff and **ask before applying**. Never
  stamp silently.
- **Idempotent re-runs:** on fold-in (Mode 4/5) **replace** the distill note block and
  re-union tags — no duplicate blocks, no tag churn.
- **Cap tag spam:** stamp only Topic-Index-level topics.

**Payoff:** `calibre_search "tags:exactly-once"` now finds the book; the book-surface work
feeds the catalog surface.

---

## Step 10 — Report

Nothing to clean up (no temp files — the server owns its cache). Report:

```
✅ Skill created: $SKILLS_HOME/<skill_name>/

📚 Book: <Full Title> — <Author>   (Calibre id <BOOK_ID>)
📄 Chapters: <N>

Files generated:
  SKILL.md         — core frameworks + index   (~X tokens)
  chapters/        — <N> chapter summaries     (~X total)
  glossary.md      — key terms                 (~X tokens)
  patterns.md      — techniques & patterns     (~X tokens)
  cheatsheet.md    — decision rules            (~X tokens)
  Total (on-demand): ~X tokens

Usage:
  Ask for <skill_name>                → load core frameworks
  Ask <skill_name> about <topic>      → find and explain a topic
  Ask <skill_name> for ch<N>          → dive into a chapter
  (Reload: Claude Code — restart the session.)
```

If Step 9.5 ran, add a line: `🏷  Library: stamped <k> tags + distill note on book <BOOK_ID>.`

---

## Update / Fold-in Workflow (Mode 4 — whole source)

When updating an existing skill at `$SKILLS_HOME/<skill_name>/` with an entire new book:

### 1. Read Existing Skill Structure
Parse `SKILL.md` (Chapter Index, Topic Index, metadata, Core Frameworks); list
`chapters/` to find the highest chapter number; read `glossary.md`, `patterns.md`,
`cheatsheet.md` for what's already indexed.

### 2. Match Content & Identify Revisions vs. Additions
Get the new book's chapter map (Step 2) and probe topics (Step 2.6) to decide, per section:
- **Revision** — updates an existing chapter's topic → merge into that chapter file.
- **Addition** — new material → new chapter files, numbered after the highest existing one.

### 3. Generate or Update Chapter Files
For each new/revised chapter, read the source slice (via cursors) and follow Step 7.

### 4. Merge Supporting Files
- **glossary.md** — combine + alphabetize; if a term exists, append the new chapter/source
  ref (`**Term** — definition (Ch 4, Ch 13)`).
- **patterns.md** — append new patterns, keep under ~2,500 tokens.
- **cheatsheet.md** — integrate new decision rules / tables cleanly.

### 5. Re-generate SKILL.md
Increment chapter count, update `Generated` date, add source; fold high-impact frameworks
into Core (keep under 4,000 tokens); append to Chapter Index; merge Topic Index
alphabetically (append new chapter links to existing topic lines).

### 6. Report (and optional Step 9.5)
Print a custom update report — new chapters, merged glossary terms, updated indices. Offer
Step 9.5 write-back for the new topics.

---

## Targeted Fold-in Workflow (Mode 5 — topic-scoped) — *calibre-only*

Their Mode 4 always merges the **whole** new source. This variant merges only what a book
says about **one topic** — impossible for a flat-file pipeline (no ranked, cross-lingual
retrieval).

**Trigger:** existing skill + book ref + an explicit topic/question.

1. **Resolve** the book (Step 1) and get its chapter map (Step 2).
2. **Locate the topic:** `calibre_semantic_search(scope=book, bookId=<id>, query="<topic>")`
   (+ `calibre_search scope=book` for exact terms). Map hit offsets → chapters via the map.
   Read **only those chapters** through their cursors. Nothing else from the book enters
   context.
3. **Merge, scoped:** revise the matching chapter file(s) or add **one** new chapter/section
   for the topic; fold only topic-relevant terms into the glossary (with the new source
   ref), topic-relevant rules into the cheatsheet; append the new chapter to the topic's
   line in the Topic Index. Do **not** renumber or rewrite unrelated files.
4. **Report** what was merged and from which chapters (provenance line in the updated
   chapter: source book + chapter heading).

**Guardrail:** if `calibre_semantic_search` returns `lowConfidence`, say so and **ask before
merging** — don't fold in weak matches silently.

---

## Quality Rules

1. **Extract structure, not summaries** — named frameworks, exact formulations, anti-patterns; not chapter recaps.
2. **Preserve the author's precision** — "The 5 Whys" ≠ "ask why multiple times".
3. **Density over completeness** — a 1,000-token summary beats a 10,000-token excerpt.
4. **Practitioner voice** — write "Use X when Y", not "The book explains X".
5. **Front-load SKILL.md** — compaction keeps the first ~5,000 tokens; most important first.
6. **Chapter files are on-demand** — they don't count against skill budget until loaded.
7. **Never copy raw book text** — always synthesize (also respects the source's license).
   Verbatim quoting is capped: **max 25 words per quote, max 200 quoted words total per
   skill**, non-contiguous, and every quote is **always attributed** to the source.
8. **Topic index is critical** — it's how the agent navigates to the right chapter file.
9. **Verify before you claim** — use `calibre_search scope=book` to confirm a framework is really in the book before naming it.

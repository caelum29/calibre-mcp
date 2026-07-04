# DISTILL-ROADMAP — L4 back-links & v2 enhancements for `calibre-distill`

<!-- Design session capture, 2026-07-05 (Claude chat). Delta document: everything here
     is an ENHANCEMENT to skills/calibre-distill/SKILL.md, not a replacement. Read that
     skill first; this file only describes what it does NOT yet do. -->

## Status vs. the existing skill

Ideas from the design session mapped against `skills/calibre-distill/SKILL.md`:

| Idea | Status |
|---|---|
| Resolve via `calibre_search`, confirmation gate | ✅ exists (Step 1) |
| Streaming per-chapter extraction, never whole-book | ✅ exists (Step 2.6) |
| Token-budgeted distillation templates | ✅ exists (Step 7, DEPTH × BOOK_TYPE) |
| Library write-back registry (`distilled` tag, comments note) | ✅ exists (Step 9.5) |
| Topic-scoped fold-in via in-book search | ✅ exists (Mode 5) |
| **E1. L4 back-link footer in chapter files** | ❌ this doc |
| **E2. ISBN as stable key (re-import survival)** | ❌ this doc |
| **E3. Post-generation smoke test (Step 9.9)** | ❌ this doc |
| **E4. `library-index` meta-skill** | ❌ this doc |
| **E5. Install strategy: L1 description budget** | ⚠ partial ("Skill Locations") |

## Core idea: 4-level progressive disclosure

Standard skills have 3 levels (metadata → SKILL.md body → bundled resources). A generated
book skill can have a 4th, because the source of truth is a live, queryable daemon:

```
L1: name + description        — always in context
L2: SKILL.md body             — on trigger
L3: chapters/*.md             — on demand, zero cost until read
L4: live source via calibre-mcp — exact quotes, deeper context, verification
```

L1–L3 are the distillate (lossy by design — "density over completeness"). L4 is the
escape hatch from lossy compression: when the summary is not enough, the reading agent
pulls ranked passages or full chapter text from the library instead of hallucinating
detail. The generated skill stops being a dead snapshot and becomes an index over a live
corpus — compiled artifact **with source maps**.

Mechanically this costs almost nothing: the footer is a template block with pre-filled
tool calls. The reading agent doesn't need to know calibre-mcp exists — the instruction
is in its context at the exact moment it needs it (agent-facing text, Karpathy test).

---

## E1 — L4 back-link footer in every chapter file

Add to the Step 7 chapter template, after `## Connects To`:

```markdown
---
<!-- L4: live source (generated — do not edit) -->
**Need depth or an exact quote? Do not reconstruct from memory — query the source:**
- Concept / where a topic lives: `calibre_semantic_search(scope=book, bookId={{BOOK_ID}}, query="<question>")`
- Exact phrase / verify a claim: `calibre_search(scope=book, id={{BOOK_ID}}, query="<phrase>")`
- Full chapter text: `calibre_get_content(id={{BOOK_ID}}, cursor="{{CHAPTER_CURSOR}}")`
- If book id is stale (re-import): `calibre_search(query="identifiers:isbn:{{ISBN}}")` → new id
```

Notes:
- `{{CHAPTER_CURSOR}}` comes from the Step 2 chapter map — it is already in hand during
  generation; persisting it in the footer is free.
- The footer must also state the fallback when semantic index is absent: FTS via
  `calibre_search scope=book` (mirrors Step 2.6 guidance).
- The wording is an instruction to the *future reading agent*, not a comment for humans.
  It changes behavior at read time: summary → tool call instead of summary → guess.

## E2 — ISBN as the stable key

`BOOK_ID` is a library-local autoincrement: it does not survive re-import, library moves,
or dedupe. ISBN (or another identifier) does.

- Step 9 SKILL.md header: add `**ISBN**: <isbn>` next to `**Calibre id**`.
- Every E1 footer carries the `identifiers:isbn:` fallback line.
- If the book has no ISBN, run the existing `calibre_extract_isbn` flow first (the server
  already ships it) or fall back to `title:"..." AND authors:"..."` in the footer.

## E3 — Step 9.9: post-generation smoke test (mandatory)

The skill currently verifies claims *during* generation (Quality Rule 9) but never tests
the *artifact*. Add a validation step before Step 10 report:

1. **Structural check** — every `chapters/*.md` ends with the `<!-- L4 -->` footer block;
   SKILL.md header contains both `Calibre id` and `ISBN`.
2. **Smoke queries** — answer 3 questions using ONLY the generated skill files
   (1 framework question, 1 topic lookup via Topic Index, 1 chapter dive), then
   cross-check each answer against `calibre_search(scope=book)` FTS hits.
   Any contradiction with the source = FAIL → regenerate the offending chapter.
3. Report PASS/FAIL per check in the Step 10 output.

This is the seed of a trace-based judge: same three probes, run by a fresh-context
verifier subagent, become an automated eval when the skill count grows (fresh context
outperforms self-critique — do not let the generating agent grade itself).

## E4 — `library-index` meta-skill

One skill, regenerated from the catalog, answering "which books are already distilled
and where do their skills live":

- Source query: `calibre_search "tags:distilled"` (the Step 9.5 marker tag).
- Body: one table — book title → skill slug → 5–8 topic keywords → skill root.
- Regenerated (overwritten) after every distill run that executed Step 9.5.
- Index-first pattern: the reading agent asks the index, then pulls one book skill,
  instead of scanning N book-skill descriptions.

## E5 — Install strategy: protect the L1 budget

Every installed book skill adds its description to the always-loaded metadata level.
50 distilled books installed globally = 50 descriptions taxing every session.

- Default destination stays user-chosen (existing "Skill Locations" logic), but the
  report (Step 10) must warn when the target is a global root and suggest per-project
  installs or symlinks for selective activation (`<skill-name>` in a skills root may be
  a symlink; hosts follow it).
- `library-index` (E4) is the cheap global citizen: one description in L1, N books
  reachable behind it.

## Non-goals (explicit)

- **Batch mode over tags** ("distill everything tagged X"). WHY: distillation quality
  must be validated per-book first; cost is unbounded. STOP SIGNAL: you are writing a
  loop over bookIds — stop and ask.
- **Auto-install into a skills root without the Step 5 dialog.** "AI proposes, never owns."
- **Auto-creating custom columns in Calibre** (already a Step 9.5 rule — reaffirmed).

## Implementation plan (one Macro Action, ~20 min)

**WHAT**: edit `skills/calibre-distill/SKILL.md` only —
1. Step 7 template: append E1 footer block (with `{{CHAPTER_CURSOR}}`, `{{ISBN}}` slots).
2. Step 9 template: add ISBN header field (E2).
3. New Step 9.9 (E3) between Step 9.5 and Step 10; extend Step 10 report lines.
4. "Skill Locations": add the L1-budget warning sentence (E5).

**CONSTRAINTS**: do not touch server `src/`; do not renumber existing steps; keep the
skill agent-neutral (no `allowed-tools`); E4 is a separate follow-up skill, not this edit.

**VALIDATION**: run Full Conversion on one small EPUB from the test library →
`grep -L "L4: live source" <skill>/chapters/*.md` returns empty; Step 9.9 reports 3/3
smoke queries PASS; re-run on the same book (Mode 4 path) produces no duplicate footers.

**COMMIT**: `feat(distill): L4 back-link footers + ISBN keys + smoke test (live-source skills) → library-index skill`

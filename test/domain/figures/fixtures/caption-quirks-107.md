# #107 caption quirks — diagnosis (Phase 1, 2026-10-21)

Probe: each book's PDF fetched from the Content Server, run through `pdftotext -enc UTF-8`
and `pdfimages -list`, then `buildInventory` at three revisions: **pre-#116** (`29d8194^`,
the v0.7.0 Desktop-verification state the issue was filed against), **current** (`main`
@ v0.7.6, inventory v3), and a **prototype** of the fix rules below (scratch, not committed).
Fixtures: `caption-quirks-107.ts` (all fail on current, all pass on the prototype).

## Verdicts

| # | Quirk | Cause | Status on current main |
|---|-------|-------|------------------------|
| 1 | Empty captions (175: 19 rows) | 18 are **in-text references**, not figures: `…the code flow diagram is shown in` / *(blank)* / `Figure 12-32.` — the `.` ends the referring sentence. Every one has a real-caption twin with the same label. 1 is a **real** side-column caption with text on the next lines (`Figure 12-2:` / `Network-linked` / `computers.`). | #116 removed 16; **3 left** (12-32, 18-3 = references past a blank line; 12-2 = real, text unread). |
| 2 | Mid-clause truncation (175) | Lost at scan time: `matchCaptionLine` reads one physical line. 139 of 355 captions in 175 are wrapped. The 100-char display slice is a second, separate silent cut. | Open. |
| 3 | Body-text false positives (610) | Wrapped in-text references. #116's previous-line guard removed all 24 that the issue saw (idx 9/29/41/49 included). **2 survive**, because the previous line ends in a period from an abbreviation: `(см.` / `рис. 11.10) или…`. One of them (p.586) still **steals the page's only raster** — the real `Рис. 11.10` falls to page-render. Same shape in other RU books: lowercase `рис. 3.18 наглядно…` at a page top (503, 590). | 2 FPs left in 610, 1 raster stolen. |
| 4 | Index gap (610, idx 163) | **Legitimate.** Indexes span captioned *and* uncaptioned entries; p.466 has caption 9.14 and two rasters, so the second raster is an uncaptioned entry, hidden by default. Today's gaps are idx 0, 1, 144 (cover/front matter + that raster). Not an off-by-one. | Works as designed; the listing could say why gaps exist. |
| 5 | Two-line bare label (165) | No pattern matches `Figure 2.10` alone on a line. 229 such lines → **0 figures**. Captions are Title Case (`…Superscalar Machine of` / `Degree n = 3.`), so continuation can't rely on a lowercase start. The same shape shows up in Manning (802: 28 labels, 403: 10) and RU Питер (45: label-only `Рис. 7.2`). | 0 figures in 165. |

## Fix rules (prototype-validated)

1. **Bare-label head (5).** In `scanCaptions` only, not `matchCaptionLine` (EPUB caption elements share it):
   a line that is just `Figure <label>` is a head. The #116 guard applies to it unchanged.
2. **Label-only heads read the next line (1, 5).** If the head's text is empty, the next line is its text,
   provided it doesn't start lowercase. A lowercase next line (`sys_socket`, `shows…`) means a
   reference or a diagram label, so the head is rejected. That drops 12-32 and 18-3 and recovers
   12-2 and all of 165. A blank next line leaves a label-only Figure (45 `Рис. 7.2`, Manning).
3. **Continuation joining (2).** Append following lines while the text lacks terminal punctuation (`.!?…`),
   the next line isn't blank or a caption, and either the next line starts lowercase or `(`, the text
   ends in a dangling function word (`of`, `the`, `и`, `для`, …), or the caption came from a bare
   label (rule 2: block-set captions are Title Case). Cap: 3 extra lines / 300 chars. Join `-`/`¬`
   hyphenation without a space.
4. **Truncation marker (2).** Text still ending in a dangling word or at the cap gets `…`. The 100-char
   display slice in `listFigures` gets `…` too.
5. **Reference tails (3).** Reject caption text that opens with `)`, `]`, `,` or `;`. That's the referring
   sentence: `рис. 11.10) или`.
6. **RU lowercase text (3).** For the RU pattern, reject text that starts with a lowercase Cyrillic letter or
   `(`+lowercase: `рис. 3.18 наглядно`, `рис. 3.2 (справа)`. RU captions start capitalized.
7. **PUA separator glyphs (3).** Strip a leading U+E000–U+F8FF char from the text. Book 610 renders ``
   at the start of every caption.
8. **Label-only listing (1).** Keep `captioned: true` with empty text (the label anchors a Figure, per CONTEXT.md),
   but render `(label only — no caption text)` instead of a blank cell.

Optional belt-and-braces, not needed for the measured books: for a `.`-terminated empty head
(`Figure 12-32.`), apply the #116 run-on guard to the nearest *non-blank* previous line.

## Measured (current → prototype)

Columns: captioned figures / empty captions / raster-paired / mean caption length.

| Book | Current | Prototype | Notes |
|------|---------|-----------|-------|
| 175 Linux Kernel Arch. | 355 / 3 / 0 / 39 | 353 / 0 / 0 / 52 | 2 refs dropped, 139 captions completed |
| 610 Распределенные БД (RU) | 216 / 0 / 138 / 37 | 214 / 0 / 138 / 51 | 2 FPs dropped; p.586 raster back to the real caption |
| 165 Modern Processor Design | 0 / 0 / 0 / 0 | 226 / 3 / 0 / 54 | 3 heads rejected (lowercase next line); 3 label-only |
| 351, 889, 374 (O'Reilly, Packt) | 29, 137, 85 | same counts | text unchanged or completed |
| 893 AI Engineering (O'Reilly) | 161 / 0 / 159 / 74 | 161 / 0 / 159 / 109 | 81 wrapped captions completed, all read and correct |
| 730, 821 (No Starch) | 57, 20 | same | |
| 45, 613 (Питер, RU) | 175 (25 label-only), 50 | same | |
| 590 (ДМК, RU) | 36 | 33 | 3 lowercase `рис.` references dropped (`рис. 3.2 (справа)`, a same-label twin on p.131, `рис. 10.4 дает`) |
| 503 (ДМК, RU) | 3 | 0 | all 3 were references (`, оказалась`, `).`, `рис. 3.18 наглядно`) |
| 802, 403 (Manning) | 0, 0 | 28 (27 label-only), 10 | bare labels; Manning caption text isn't on the next line |
| 779, 959 (Wiley, Addison) | 0 | 0 | |

Known leftover: 175 p.823 `Figure 12-25. tcp_v4_do_rcv is a multiplexer…` is an in-text reference
right under a running header. It's a duplicate label of p.820's real caption, so it could be caught
by "a later same-label line whose text isn't caption-shaped". Not in scope.

## Re-index implications (for Phase 2)

- **Figure indexes renumber** in every book whose caption set changes. Dropped false positives and
  new figures shift all later indexes. The semantic index stores figure rows (index + caption) and
  bakes `[image #N …]` markers into chunk text, so affected books go stale until re-indexed.
- `INVENTORY_VERSION` (figure-inventory.ts) must bump 3→4. The **text cache** (`TEXT_CACHE_VERSION`
  in extract.ts) holds marker-injected text keyed independently of the inventory version. It must bump
  too, or cached text keeps markers pointing at old indexes.
- `markers.ts` `findCaptionLine` needs the 30-char caption head to occur on the caption line. A joined
  caption whose *first line* is shorter than 30 chars (`Division of virtual` + `address space.`) would
  stop matching and fall back to page-boundary placement. Compare against the head of the line's own
  text instead. The same applies to bare-label heads, whose line carries no text. markers.ts is #101's
  file: Phase 2 waits for #101.
- Books that would change, from this sample: 175, 610, 165, 893, 590, 503, 802, 403, plus caption-text
  changes in 351/730/821/374/45/613. A library-wide before/after sweep (inventory only, no index
  rebuild) produces the full list in Phase 2.

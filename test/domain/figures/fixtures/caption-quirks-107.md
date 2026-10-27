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

## Phase 2 — shipped rules and library sweep (2026-10-23)

Implemented rules 1–8 above, plus three guards the library sweep forced:

- **Stray label-only heads.** A label-only head is dropped when its label has a real caption
  elsewhere in the book (a reference or index entry). All label-only heads are dropped on a
  page carrying 4+ of them: back-of-book figure indexes. Book 1111 *TCP/IP Guide* gained 322
  phantom figures from its index without this.
- **Block captions must be self-contained.** Text under a bare label counts only if it is
  isolated (a blank line or the next caption follows) or is one short sentence. It must also
  start caption-shaped: no page numbers, index entries (`… 371,385,510`), image ids
  (`F03MQ02`), admonitions (`ПРИМЕЧАНИЕ`, `NOTE`), lone words, or `Figure N` references.
  Body prose that follows a label (947: `Figure 2-2` / `Figure 2-3 shows…`) leaves a label-only
  Figure.
- **Markers.** Bare and label-only heads anchor on their next line. A wrapped caption's
  continuation line counts in the prefix match (610: `Рис. 3.1  Отношение,` was 10 chars).
  `_`/`*` pairing now runs only on markdown text. In pdftotext output it mangled identifier
  captions (`task_struct, thread_info`), which left **57 of book 175's 355 markers** on the
  page-boundary fallback; now 0.

### Sweep: every PDF/EPUB in Programming Books (1037 files, read-only, origin/main vs branch)

| | main | branch |
|---|---|---|
| captioned figures | 53,481 | 56,878 |
| label-only figures (no caption text) | 1,469 | 4,385 |
| books with figures recovered from 0 | — | 66 (Manning, Wrox, Modern Processor Design…) |

415 files changed, all PDF (EPUB inventories are byte-identical). 289 changed caption text
only: wrapped captions completed, PUA glyphs stripped, `…` marks. **126 renumbered:** 73 gained
figures, 53 lost references. 3 files could not be scanned (pdfimages timeout on 236 and 916,
pdftotext failure on 1160), so they are unchanged either way. Marker placement on 175/610/165/45/893/182/1111/947/865:
0 page-boundary fallbacks, 0 unplaced.

Most new figures are **label-only**. Manning PDFs set the caption text away from the label,
and many books put it after a blank line. Pulling that text in needs layout geometry
(`pdftotext -bbox`), not line heuristics, so it's the follow-up. The listing shows these as
`(label only — no caption text)`. Residual false positives found by sampling: 175 p.823
`Figure 12-25. tcp_v4_do_rcv…` (reference under a running header) and 380 `4-7`
(diagram text taken as a block caption).

### Re-index implications

- `INVENTORY_VERSION` 3→4 and `TEXT_CACHE_VERSION` 5→6: cached inventories and marker-injected
  text rebuild on next use. No index change needed for correctness of `calibre_get_figures`.
- The semantic index stores figure rows (`fig_index`, caption) and bakes `[image #N …]` markers
  into chunk text. Of the 773 indexed books, **102 have renumbered PDF figures**. Their indexed
  figure hits point at the wrong `calibre_get_figures` index until re-indexed (if the index used
  their PDF). **227 more** changed caption text only. Their indexes stay valid but figure-caption
  search sees the old, shorter text.
- Renumbered and indexed (re-index these first):
  9 16 20 21 23 24 30 38 43 55 74 104 108 110 122 128 134 136 165 175 182 183 184 186 193 194 200 209 216 233 243 251 259 266 278 281 284 289 295 357 358 373 379 380 383 390 396 398 403 439 467 468 473 475 494 503 504 505 525 533 538 541 545 561 564 565 575 590 593 610 612 648 650 672 677 678 683 685 695 696 704 705 729 732 741 754 772 783 792 794 796 800 802 805 823 835 845 860 861 865 866 934
- The production index was not touched. The 2026-07-27 index predates #116 too, so the pending
  full re-index (#140) covers all of this.

## Phase 3 — caption text from page layout (2026-10-23)

Phase 2 left 4,385 label-only Figures across PDF+EPUB. This re-run counts 4,196 over the 823
PDFs that scanned cleanly (main @ #172, same harness, stderr drained). The text stream
can't pair them safely: in reading order, the line under `Figure 1.2` is often diagram
text (`TV 2 consumer`). `pdftotext -bbox-layout` geometry can. `caption-layout.ts` takes
a line holding only `keyword label` as the anchor and reads, in this order:

1. **Beside (same baseline).** The nearest line to the anchor's right, within 3 label heights,
   with similar type size (0.75–1.3×). The lines wrapped under it in its block count too:
   left-aligned, centered within its width (1234), or hanging back to the label's edge (938).
   This covers Manning, Pearson, Addison-Wesley and Gray Hat: 182, 74, 802, 1234, 439, 110, 396.
   The text gate is loose here because the position already says "caption": one word
   (`Brokers`) and identifier or mixed-case starts (`jMock…`, `RESTful…`) pass. Bare numbers,
   admonitions and a second label don't.
2. **Column below.** A narrow run (≤3.5× the label's width) right under the label, flush with
   its left edge (403 side columns) or its right edge (Wiley/Dummies 836, 371, 378). It must
   open capitalized and run 2+ words.
3. **Wide block below.** One self-contained block of ≤2 lines, flush left, ending a sentence
   (Wiley 1231). A paragraph that opens under a label runs longer.

If no shape reads cleanly, or two anchors for the label read differently, the Figure stays
label-only. The layout pass runs only when the scan leaves label-only captions: one
`-bbox-layout` run over the first–last such page, parsed only for those pages. That's +1–5 s
on a Manning book. A failed run leaves the captions label-only and doesn't fail the inventory.

Markers: a label-only head on the figure's own page anchors its marker. The marker shows
`label + inventory caption`, not the label's neighbour line. A page-first label line starts
on the page's form feed, so page lookup uses `start + 1`. Without that, 231 markers in
836/378/371/772 fell back to the page boundary in the first sweep.

### Sweep: every PDF in Programming Books (823 files, read-only, branch vs this change)

| | before | after |
|---|---|---|
| captioned figures | 43,702 | 43,702 |
| label-only figures | 4,196 | **900** |
| books with captions recovered | — | 69 (3,296 captions) |
| figure indexes changed | — | **0** (only caption text changes) |
| marker page-boundary fallbacks / unplaced | 6 / 0 | 6 / 0 |

One file failed both ways (1160, pdftotext exit 99). Samples, before → after:
182 71→0, 74 129→0, 1234 68→0, 439 123→0, 110 101→0, 836 223→0, 1231 60→0,
938 7→0, 802 28→3, 371 127→3, 403 8→1, 45 25→25.

Eye check: all recovered captions in 182/74/802/1234/439/110/403/836/1231/938, plus 70 random
ones from 60+ other books. The random ones were all real captions. 938's (Norman) long
paragraph captions read whole up to the 300-char cap.

What stays label-only, and why:
- **No caption text printed.** Wrox 1156 (`Figure 1-1` under screenshots), RU 45 (`Рис. 7.2`).
- **Phantom heads from Phase 2.** 371 `Figure 3-5.` ends Figure 3-6's caption
  (`…relationship in / Figure 3-5.`). Geometry leaves it alone. Dropping it (the anchor is a
  non-first line of another caption's block) would renumber indexes, so it's a follow-up.
- **Shapes skipped on purpose.** Caption type much larger than the label (802 p.44, 1.43×),
  a wrap set in code font in another block (836 `clearBoard-` / `Diplay()`, which keeps
  `The test for…`), text that opens on another label (403 `Figure 9.12 with…`).

### Re-index implications

- `INVENTORY_VERSION` 4→5 and `TEXT_CACHE_VERSION` 6→7. Figure indexes don't move, so the
  semantic index's figure rows stay valid. Figure-caption search for these 69 books still sees
  empty captions until re-indexed (#140 covers it).

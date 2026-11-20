# #631 metadata list: acceptance rule (committed before any measurement)

The query side of #631 fuses the `book_metadata` ranking as a third reciprocal rank fusion (RRF)
list in library hybrid search, shipped at weight 0. This file states, before any snapshot dump,
how the A/B decides whether that weight is ever raised. It is the approved default 6 of the
wave-5 plan, committed verbatim.

## The rule

- **Wire** if, for one weight: the slice's hit@3 rises by at least 2 queries against the baseline; book 247 is found by #631's query and survives the rerank; on the 90 library queries blind hit@3 falls by at most 1 point and no category's paired confidence interval for ΔNDCG@5 lies entirely below 0 (`pnpm eval:judged:compare`).
- **Otherwise drop:** M1 parks unmerged, the verdict and tables go on #631, and the report asks Artem to close #631 or move it to `post-1.0`.
- On "wire", M1 still merges with default weight **0**. Setting the weight changes fixture rankings, needs a re-freeze and restarts #364's nightly count, so it is a one-line follow-up PR that waits for Artem. Put that diff in your report; don't open it.

## Arms (pre-registered)

All arms run on the wave-5 live snapshot (`CALIBRE_MCP_INDEX_DIR=$WAVE/index`), through
`pnpm eval:judged:dump --rrf-weights v,k,m` (the `retrieve()` `opts.rrfWeights` seam), cross-encoder
on, one fresh run dir per arm under `$WAVE/M/`:

| arm | `--rrf-weights` | rerank |
|---|---|---|
| `m0` (baseline) | `1,1,0` | on |
| `m05` | `1,1,0.5` | on |
| `m10` | `1,1,1` | on |
| `m0-off` | `1,1,0` | off (`CALIBRE_MCP_RERANK=off`, ADR-0021) |
| better arm `-off` | that arm's weights | off |

The keyword half's `book_meta` BM25 column weight stays 0.5 in every arm (its sweep is post-1.0).
"The better arm" is the one of `m05` / `m10` with the higher slice hit@3; on a tie, the higher
90-query blind hit@3; on a second tie, the lower weight.

## Reading the rule

- **Slice** = `queries.json` in this directory: 20 known-item queries (12 for books with a blurb
  and thin or image-only text, 247 and 544 among them, plus #631's own query; 8 for ordinary books),
  picked from the snapshot's `book_metadata` table, not from search results. Each query has one
  target book (`expectedBooks[0]`). **Slice hit@3** = number of slice queries whose target book is
  in the hybrid top 3. It is mechanical (known-item), no judges.
- **Book 247** "is found by #631's query and survives the rerank" = with the cross-encoder on, book
  247 is in the hybrid result list for `professional JavaScript for web developers: DOM, events,
  browser APIs` (slice id `ki-01`). The judged dump asks for the top 5, so "found" is the top 5
  after the rerank; its fused (pre-rerank) rank comes from the debug provenance (`fusedRank`).
- **90 library queries** = the library-scope text queries of the 2026-11 blind query set
  (`docs/dev/evals/semantic-judged-blind-2026-11/queries.json`) that chain J's version-5 runs use;
  blind hit@3 and ΔNDCG@5 per category from the judgment store
  `docs/dev/evals/judgments/3f335e5122b8.jsonl`, new hits judged blind by the `judged-blind`
  Workflow (judges A = opus, B = sonnet), never by the measuring session.

## How the slice was picked (2026-11-20, before any dump)

From the snapshot (`$WAVE/index/Programming_Books.sqlite`, version 5 with the #722 flags pass), one
read-only scan: per book with a metadata row, `blurb_chars`, chunk count, extracted characters and
characters per `\f` page. No search was run.

- **known-thin (12):** books with a blurb and the thinnest text. 247 (3 chars/page, 1 chunk) and
  544 (8 chars/page) are the two image-only PDFs with 1,800-char blurbs; 693, 502 and 470 are the
  other near-empty books of the #595 probe that have a (short) blurb; 88 has 3 chunks; the rest are
  the lowest chars/page among books with a blurb of at least 200 characters (1284, 116, 239, 1181,
  57, 225). Skipped: 1151 / 1157 (two Vue.js books with the same blurb: no single known item) and
  286 (a second book, 654, has the same title).
- **known-ordinary (8):** books with a blurb and normal text (about 800–1,000 chars/page), titles
  with no near-duplicate in the library: 1411, 1310, 1126, 552, 42, 99, 271, 676.

Queries name the book by title, part of the title, author or topic, as a user would, in the
book's own language (544 and 693 in Russian, 88 in German).

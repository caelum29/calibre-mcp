# Tool reference

The calibre-mcp server exposes <!-- tool-count:modelFacing -->19<!-- /tool-count:modelFacing --> tools your AI assistant can call to work with your
[Calibre](https://calibre-ebook.com) library. They fall into two scopes:

- **Catalog / library** — search across the whole library, browse categories, curate
  metadata, dedupe, run quality audits, add/remove/merge books.
- **Single book** — read a book's text or chapter map, and search *inside* one book.

The two search tools (`calibre_search`, `calibre_semantic_search`) span both scopes via a
`scope: library | book` parameter — no separate per-book tools.

Everything is read-only unless you turn writes on; see [Write safety](#write-safety) at the
end. Most tools accept a `library` parameter (the library's display name or id, as shown by
`calibre_list_libraries`); leave it unset to use the Content Server's default library (unless `calibre_list_libraries` says the default is unavailable — then pass an explicit id).

Book ids: wherever a tool takes `id` / `bookId`, you can pass a numeric database id or a
book uuid — they're interchangeable. The id you get back from a search result is what these
tools expect.

Errors: a failed call returns its message followed by a `Code: <errorCode>` line and, when the
message doesn't already say it, a `Next: <step>` line (see
[Troubleshooting → Reading an error](TROUBLESHOOTING.md#troubleshooting)).

---

## Health check

### `calibre_ping`

Confirms the server can reach your running Calibre Content Server (end to end, via
`calibredb`) and reports semantic-search status — whether the embedding model and its
dependency are present, how many vectors the index holds, and the index generation
(`indexVersion`, read from the index itself — flagged **stale** with a rebuild hint when it
doesn't match the running server). It also prints the server version, MCP SDK version, `calibredb` path, Content Server URL and write-gate state, plus a per-library index line (`Index: My Books (id: My_Books) [default]: 1064/1092 indexed · … · Other Books (id: Other_Books): none`; `indexes[].isDefault`) so unindexed books are visible and every library id is at hand. The semantic-search line names the library its counts describe (`…; My_Books index v4: 1064 books / …`, `semantic.libraryId`). An index another process holds locked shows as `busy — index locked by another process, retry` (`state: "busy"`), not as unreadable. Past 20 libraries the text ends with `… +K more — full list in structuredContent / calibre_list_libraries`; `indexes` keeps them all; books indexed keyword-only (FTS-searchable, out of semantic search's reach) are labelled, e.g. `1064/1092 indexed (40 without embeddings)`. A library refused for a
[case-only id clash](#case-clashing-library-ids) shows as `not indexable` (`state: "conflict"`,
with `conflictsWith` naming the other id), and the semantic-search line prints the refusal
instead of a build hint.
Libraries the server is currently failing fast after a Calibre timeout are listed as
`busy: library "…"` (`busyLibraries`). It also lists the server's recent errors (the last 20 distinct ones, newest first, each with its tool and
`call` id; a repeated error is one entry with `count` and `firstTs`, shown as `(×N since …)`, and the header reads `recent errors: N (M occurrences)` when any repeat) and the path of today's log file — see [Troubleshooting → Logs](TROUBLESHOOTING.md#logs).
When Calibre is reachable it also asks whether Calibre itself accepts writes, with a probe that
cannot write anything (a `POST` to `set_metadata` at a module version that does not exist):
`calibre writes: allowed`, `refused — <how to allow writes>` (the GUI setting "Allow
un-authenticated local connections to make changes", or `--enable-local-write` for a command-line
`calibre-server`, or an authenticated user: the same remedy a refused write gives), or
`unknown (<reason>)` when the answer is unclear
(`calibreWriteAccess`). If `CALIBRE_MCP_ENABLE_WRITE` is on but Calibre refuses, a `warning:` line
says every write tool will fail. `ok` stays true either way: reads work.
Use it first when something isn't working, or to answer "why is semantic search off?" or "are writes set up?".

No parameters.

> Ask: *"is calibre reachable?"* · *"why isn't semantic search working?"*

---

## Read & search

### `calibre_search`

Find books by exact metadata (title, author, ISBN, tag, or Calibre's query syntax) or by full
text. This is the tool for "find the book(s) that match X". For meaning/topic questions ("which
book explains Y?") prefer `calibre_semantic_search`. Large result sets paginate: the response
includes a `nextCursor` token — pass it back verbatim as `cursor` to get the next page.

`scope: book` searches the full text *inside* one book and returns short keyword snippets.
Because Calibre's in-book full-text hits are unranked, the first ones often land in the table
of contents or front matter; for a definitional or topic question within a book,
`calibre_semantic_search` with `scope: book` gives ranked passages instead.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `query` | string | *(required)* | Search text or Calibre query syntax (e.g. `author:knuth`, `tag:rust`) |
| `mode` | `meta` \| `fts` \| `annotations` \| `notes` | `meta` | `meta` = metadata/query-syntax search; `fts` = full-text search; `annotations` / `notes` = highlights and item notes (Calibre 9.18+) |
| `scope` | `library` \| `book` | `library` | `book` searches inside one book (forces full text; needs `bookId`) |
| `bookId` | number \| uuid | — | Required when `scope: book` |
| `library` | string | *(default)* | Library name or id |
| `sort` | `title` \| `authors` \| `pubdate` \| `timestamp` \| `rating` \| `last_modified` | — | Sort field (metadata search) |
| `sortOrder` | `asc` \| `desc` | — | Sort direction |
| `limit` | number | `20` | Results per page (max 50) |
| `cursor` | string | — | Continuation token from a previous response's `nextCursor` |
| `filter` | string | — | Bundle name to scope the search to (library scope; see `calibre_manage_bundles`) |
| `include_excluded` | boolean | `false` | Include books from `-`-named exclusion bundles |

Library-scope searches automatically subtract books in **exclusion-marker** bundles (saved
searches whose name starts with `-`), and say so in the result: `exclusions applied: [-noise]
(pass include_excluded=true to disable)`. There is no silent subtraction — if nothing is
reported, nothing was subtracted.

**Date keywords (Calibre 9.18+).** In `mode: meta`, date fields (`date` = added, `pubdate`,
`last_modified`) accept `lastmonth`, `thisyear`, `lastyear`, and `Nmonthsago` / `Nyearsago` with
the number in front. Examples: `date:lastmonth`, `date:thisyear`, `pubdate:lastyear`,
`date:>2monthsago`. `monthsago3` is not valid and returns nothing. Older Calibre versions
don't know these words; use `date:>7daysago` or explicit dates there.

Full-text search (`mode: fts`, `scope: book`) uses Calibre's own full-text index, which you
enable per library in Calibre (the **FT** button left of the search bar). If it is off, the call
says so at once. Matches come back ranked; snippets are fetched only for the books on the
current page, one book at a time, within a time budget — books whose snippets didn't fit are
named in the lead line (`snippetsSkipped` in structured output). While the index is still being
built, the result says how far along it is (`indexing`). Each call answers within 45 s; if
Calibre is still busy with an earlier long request, the call fails fast with a retry time
instead of queueing behind it.

**Annotations and notes (Calibre 9.18+).** `mode: annotations` searches the highlights,
their notes and the bookmark titles made in the Calibre E-book viewer (and by Content Server
users) — all users, read-only. Hits come in Calibre's relevance order, one
`annotation <id> · <type> · book <bookId> · …` line each, with the highlighted text and the
note fenced as data; `structuredContent.annotations[]` carries `id`, `bookId`, `title`,
`format`, `type` (`highlight` / `bookmark`), `text`, `note`, `chapter`, `timestamp`, `user`.
`filter` and exclusion markers apply as in `meta` / `fts`; `scope: book` + `bookId` searches
one book, and `query: "*"` there lists every annotation of the book (in Calibre's export order;
those rows carry no annotation `id` or `title`). `mode: notes` searches the notes attached to
authors, series, tags and other items: one `note · <field>: <item>` line per hit with Calibre's
snippet (`structuredContent.notes[].snippet`). A query of the form `<field>:<item>` — `authors`,
`series`, `tags`, `publisher` or a custom `#column`, item quoted or not (`authors:"Adam Bellemare"`)
— shows that item's whole note as Markdown (`notes[].text`); an item without a note returns
`not_found`. Notes belong to items, not books, so `filter` and `scope: book` don't apply. Both modes cap at
`limit` (no `cursor`, no `sort`); on a Calibre older than 9.18 they return `calibre_too_old`.

> Ask: *"find books about Rust"* · *"search my library for author:knuth"* · *"where does book 187 mention rebalancing?"* (`scope: book`) · *"search async runtimes in the Rust bundle"* (`filter`) · *"what did I highlight about commits?"* (`mode: annotations`) · *"which author notes mention the outbox pattern?"* (`mode: notes`)

### `calibre_get_book`

Get full metadata for one book — authors, ISBN and other identifiers, formats, comments,
series, tags, cover link. Use it to inspect a book you found in a search. The cover is returned
as a link by default; set `include_cover: true` only when the cover *image itself* needs to be
seen (it then embeds the image in the result).

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to fetch — id and bookId are interchangeable |
| `library` | string | *(default)* | Library name or id |
| `include_cover` | boolean | `false` | Embed the cover image in the result |

> Ask: *"show me The Rust Programming Language"* · *"what formats does book 42 have?"*

### `calibre_get_content`

Read a book's text as a capped, fenced excerpt. To read the *whole* book, walk it page by
page: each response carries a `nextCursor` token you pass back verbatim as `cursor` to continue
where the last excerpt ended. To jump to a known character position (for example the
`charStart` of a semantic-search passage), pass `offset` instead. `cursor` and `offset` are
mutually exclusive — pass one or the other, not both.

Set `structure: true` to get a **chapter map** instead of text: a list of headings with
character ranges, approximate token counts, and a per-chapter `cursor` you can feed back to
start reading at that chapter. Works on English and Russian/Ukrainian books. Scanned/image PDFs
yield no text (Calibre has no OCR).

The map reports which `detector` built it, in this order of precedence:

| `detector` | Source |
|---|---|
| `pdf-outline` | The PDF's own bookmarks (needs poppler's `pdftohtml`). Used when the outline yields at least two plausible chapters; leading front matter (cover, copyright, contents, preface…) is left out, `Part` entries are opened up into their chapters, and each chapter starts at its heading line on the bookmarked page. Flat "bookmark every section/page" outlines are rejected. `n` is a running number, not the printed chapter number. |
| `epub-toc` | The EPUB's own table of contents (`nav.xhtml` or NCX). Same chapter-level rule as `pdf-outline`; additionally any TOC entry whose children are numbered chapters (`Раздел I` → `Глава 1`, `Глава 2`) is opened up. Each chapter starts where its spine document begins in the extracted text; a `#section` link inside a document starts at its title line. Needs the system `unzip`. `n` is a running number. |
| `numeric` | Headings in the text: `Chapter 5`, `Глава 5`, `Розділ 3`, Roman numerals, `第5章` |
| `structural` | Markdown/AsciiDoc headings (`#`, `##`, setext) — mostly EPUB/Markdown books |
| `none` | Nothing found — walk the book with plain cursors |

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to read |
| `format` | string | *(auto)* | Which format to extract (e.g. `epub`, `pdf`); auto-picks the best (EPUB → Markdown → PDF → TXT/AZW3/MOBI/DOCX/ODT/HTMLZ/FB2/RTF) |
| `maxChars` | number | `8000` | Max characters per excerpt (max 40000) |
| `sentenceAware` | boolean | `true` | Trim excerpt edges to sentence boundaries |
| `structure` | boolean | `false` | Return a chapter map instead of book text |
| `cursor` | string | — | Continuation token from a previous response (pass verbatim) |
| `offset` | number | — | Character position to start from; mutually exclusive with `cursor` |
| `library` | string | *(default)* | Library name or id |

> Ask: *"read the first chapter of book 187"* · *"show me the chapter list for book 187"* (`structure: true`) · *"keep reading"* (pass the returned cursor)

### `calibre_get_figures`

See a book's **figures** — the images its text refers to, identified by an adjacent caption
(`Figure 1-2. …`, `Рис. 3.1. …`). Call it without `indexes` to **list** figures (page, caption,
source) so you can judge relevance before spending image tokens; then pass `indexes` to fetch
up to 3 of them as actual images in the chat. Raw uncaptioned images (covers, decorations,
inline equation art) are hidden unless `include_uncaptioned: true`. Captions that wrap
across lines are read whole, and in PDFs a caption set apart from its number (beside it, or
in a side column below it) is read from the page layout; a figure printed with just its
number (`Рис. 7.2` under a diagram) is listed as *label only*, and a caption cut for length ends in `…`. Indexes count
hidden uncaptioned images too, so the default list can skip numbers.

In MCP Apps hosts (Claude Desktop), a fetch also renders the figures **for you** in an in-chat
viewer — a large reading pane with a margin rail when several figures come back, click (or
Enter) to zoom to 100% and drag to pan, caption and page under each one. A figure that couldn't
be extracted shows as a quiet placard instead of an error, and the listing call renders nothing
at all. Text-only hosts just get the images in the transcript, as before.

Works on EPUB (preferred) and PDF sources. Diagrams drawn as vectors — invisible to image
extraction — are rendered from the page as a cropped band above their caption. Scanned PDFs
honestly report 0 figures (Calibre has no OCR); some print-style publishers use unnumbered
captions, which only `include_uncaptioned` can surface.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book |
| `indexes` | number[] | — | Figure indexes to fetch as images (≤3 per call); omit to list |
| `detail` | `standard` \| `high` | `standard` | Image resolution: ≤1024px / ≤1568px longest side |
| `include_uncaptioned` | boolean | `false` | Also list/fetch images without captions |
| `format` | string | *(auto)* | `epub` or `pdf`; auto-picks EPUB first. Indexes are per-format |
| `library` | string | *(default)* | Library name or id |

Responses are capped at ~2 MB — oversized figures are downscaled, and anything still over the
cap is skipped with a note telling you how to re-fetch it.

**Caveat — first-pass confabulation.** The images do reach the assistant, but models sometimes
describe a figure from prior knowledge of similar diagrams *before* reading the delivered pixels,
then get it right when asked again. Every fetch result therefore ends with a "look at the image
first, name two things you can see" instruction; if a description still doesn't match the
picture, re-ask with that cue, or fetch one figure per call so the image is the last thing in
context. See [Troubleshooting](./TROUBLESHOOTING.md#the-assistant-describes-a-figure-wrongly-on-the-first-try).

> Ask: *"what figures does book 397 have?"* · *"show me figure 2.3 from the JWT Handbook"*

### `calibre_list_categories`

Browse the library's Tag-Browser categories. With no `field`, it lists the categories
themselves (Authors, Tags, Series, Languages, Publisher, custom columns). With a `field`, it
lists that category's values and their book counts, optionally filtered by a regular expression
(`valueFilter`, case-insensitive by default; a leading inline flag like `(?i)` is accepted).
Paginates via `nextCursor`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `field` | string | — | Category to expand (e.g. `tags`, `authors`, `series`); omit to list categories |
| `valueFilter` | string (regex) | — | Filter values by pattern |
| `library` | string | *(default)* | Library name or id |
| `limit` | number | `100` | Values per page (max 200) |
| `cursor` | string | — | Continuation token |

> Ask: *"list my tags"* · *"which authors do I have that match ^Mart?"*

### `calibre_list_libraries`

List the libraries the Content Server exposes (ID and display name) and which one is the default,
plus a quick connectivity check. Other tools take either form as `library`; an unknown name fails
with the list of known libraries.

No parameters.

> Ask: *"list my calibre libraries"*

---

## Resources

`calibre_search`, `calibre_semantic_search`, `calibre_get_book`, `calibre_find_duplicates` and
`calibre_recover_metadata` return `resource_link` blocks. Each one points at a book resource:

| URI template | Body |
|---|---|
| `calibre://book/{libId}/{id}` | Full metadata for one book as fenced JSON |

- `{libId}` is the library **ID** (`My_Books`), not the display name: book ids repeat across
  libraries, so a link names the library it came from. Example: `calibre://book/Other_Books/42`.
  Links always carry the library ID.
- An unknown `{libId}` or an invalid `{id}` is a protocol error (resources throw, tools return);
  the message lists the known library IDs.
- The older `calibre://book/{id}` form no longer exists.

---

## Semantic search

Meaning-based retrieval — the server's headline feature. It finds books and
passages by *meaning*, not keyword overlap, and works cross-lingually (an English query finds
Russian passages and vice versa). It requires a one-time local index; see
[`SEMANTIC-SEARCH.md`](./SEMANTIC-SEARCH.md) for how the pipeline works.

### `calibre_semantic_search`

Ask a topic or definitional question and get ranked results. `scope: library` ranks whole books
by their best-matching passage; `scope: book` ranks passages *within* one book and returns them
with character locations (feed a passage's `charStart` to `calibre_get_content` as `offset` to
re-read it in context). `mode: hybrid` (the default) fuses semantic and keyword matching for
best recall; `mode: vector` is semantic-only; `mode: keyword` is exact keyword matching that
needs no model at query time.

Library-scope hits show a snippet cut around your query's terms, not the head of the matched
passage. Each hit's text label reads `MATCH book <id> @<start>-<end> snippet@<offset>`, and
`structuredContent.results[].snippetStart` carries the same offset. Pass it to
`calibre_get_content` as `offset` to read on from the snippet; `charStart`/`charEnd` still span
the whole passage.

On a library refused for a [case-only id clash](#case-clashing-library-ids) it fails with error
code `library_id_collision` instead of "no index yet".

`target: figures` searches **figure captions** instead of body text — use it when you're after
a diagram, chart, or schema. Hits return the caption, page, the surrounding passage, and a
ready-made `calibre_get_figures` call to fetch the actual image (never the pixels directly).
`target` is orthogonal to `scope`: figure search works library-wide or within one book.

All modes need an index built by `calibre_build_index` first. If you only built a keyword-only
(model-free) index, `keyword` mode works, `vector` errors with guidance, and `hybrid` degrades
to keyword with a note. Figure captions enter the index at build time, so books indexed before
figure support need a `force: true` rebuild before `target: figures` finds them.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `query` | string | *(required)* | What you're looking for, in natural language |
| `scope` | `library` \| `book` | `library` | `library` ranks books; `book` ranks passages within one book |
| `target` | `text` \| `figures` | `text` | `text` searches book text; `figures` searches figure captions |
| `mode` | `hybrid` \| `vector` \| `keyword` | `hybrid` | Retrieval strategy |
| `bookId` | number \| uuid | — | Required when `scope: book` |
| `topK` | number | `10` | How many results to return (max 50) |
| `library` | string | *(default)* | Library name or id |
| `filter` | string | — | Bundle name to scope library-scope searches to (see `calibre_manage_bundles`) |
| `include_excluded` | boolean | `false` | Include books from `-`-named exclusion bundles |

Like `calibre_search`, library-scope calls subtract exclusion-marker bundles by default and
report it (`exclusions applied: […]`). The filter never touches the index — it restricts
candidates at query time, so creating or changing bundles needs no re-index.

Every successful response carries the index generation once — `indexVersion` in
`structuredContent` plus one line in the text. Character offsets and figure pages are valid
only within that generation; store it with any citation you persist (see
[Citation provenance](SEMANTIC-SEARCH.md#citation-provenance-indexversion)).

> Ask: *"which of my books explain consumer-group rebalancing?"* · *"find passages in book 187 about idempotent producers"* (`scope: book`) · *"find a diagram of the JWT signature flow"* (`target: figures`) · *"what do my databases books say about LSM trees?"* (`filter: databases`)

### `calibre_build_index`

Build (or refresh) the local semantic index for a chosen set of books. A selector is
**required** — pick books by `bookId`, a list of `ids`, or a Calibre `query` (there's no
index-everything default). A `query` selects **every** matching book (paged, no cap) — on a
big library a broad query is a long job. A call still working after about 45 seconds returns a
**still running** status (a success, not an error) and the build keeps committing in the
background; re-run the same call to get its result. Only one build runs per library at a time: a
call made while another build is running reports that build's progress instead of starting a
second one. Books already up to date are skipped, so a re-run after an interruption resumes. The first
embedding build downloads the model (~118 MB, one-time), then runs offline. Set `keywordOnly: true` to build a model-free keyword index (zero ML
dependencies); this also happens automatically if the embedding model isn't installed. Re-run
after adding books; use `force: true` to re-index books that haven't changed. An embedding
build treats books indexed without embeddings (keyword-only) as out of date and re-indexes them
without `force`; a keyword-only build never overwrites a book that already has embeddings (it
reports them as `booksPreserved`). Each book's
figure captions (see `calibre_get_figures`) are indexed alongside its text, powering
`calibre_semantic_search` with `target: figures`.

Indexing only ever adds or replaces books, so books you later **remove or merge away** keep
their (now unreachable) passages in the index. Pass `prune: true` to reconcile: it deletes the
index entries for every book that is no longer in the library and reports how many it dropped.

The index build writes only to the server's own local index directory — not to your Calibre
library — so it runs without enabling library writes. Only `enableFts: true` needs them.

**`enableFts: true`** also turns on Calibre's own full-text indexing for the library (the engine
behind `calibre_search` `mode: fts`), through `calibredb fts_index enable`. Calibre indexes in the
background; the call doesn't wait and reports what Calibre says (`0 of 144 books files indexed`).
It changes a library setting, so it needs writes enabled (`CALIBRE_MCP_ENABLE_WRITE`): with writes
off the semantic build still runs and the FTS line says `write_disabled`, with the remedy (enable
writes, or tick FTS in the Calibre GUI: the **FT** button left of the search bar). If FTS is
already on, it's a no-op that says so. A failed enable is reported in the FTS line and doesn't
fail the build. Structured output carries the same as `fts.status`:
`enabled` | `already_enabled` | `write_disabled` | `failed`. Enable-only: there's no status or
reindex action.

#### Case-clashing library ids

Calibre ids are case-sensitive, but on a case-insensitive disk (the macOS default) two libraries
whose ids differ only in letter case, such as `Books` and `books`, would share one index file and
one progress log. The library indexed first owns the index (its id is recorded in the index at
the first build; an older index without that record belongs to the first library that opens it).
The other id is refused on every index path (build, `pnpm reindex`, search, `calibre_ping`) with
error code `library_id_collision`; nothing is written for it. To fix it, rename the refused
library's folder and restart Calibre's Content Server. If an index for the pair existed before,
it may hold the other library's books: rebuild the owner with `force: true`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `bookId` | number \| uuid | — | A single book to index |
| `ids` | array of ids | — | Several books to index |
| `query` | string | — | Index every book matching a Calibre query (no cap) |
| `library` | string | *(default)* | Library name or id |
| `force` | boolean | `false` | Re-index books even if unchanged |
| `keywordOnly` | boolean | `false` | Build a keyword-only index (no embedding model needed) |
| `prune` | boolean | `false` | Also delete index entries for books no longer in the library |

*(At least one of `bookId`, `ids`, or `query` is required.)*

> Ask: *"build the semantic index for my Kafka books"* · *"index books 187 182 571"*

---

## Curation & quality

### `calibre_find_duplicates`

Surface probable duplicate books so you can decide what to merge. `mode: identical` groups by
exact title + authors; `mode: similar` groups fuzzily (any script; edition suffixes like "3rd Edition" /
"3-е издание" are ignored, but different editions, volume subtitles or pubdates ≥ 2 years apart
stay separate); each group carries a **merge-safety score**. `mode: compare` diffs two or more specific books field by field and recommends which to
keep. It never merges anything — that's `calibre_merge_books`. Mixed-language groups are flagged
as likely translations (not true duplicates), and a language difference caps the merge-safety
score with a review warning.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `identical` \| `similar` \| `compare` | `identical` | Grouping strategy, or field-by-field compare |
| `ids` | array of ids | — | Restrict grouping to these books; **required** (2+) for `compare` |
| `query` | string | — | Restrict grouping to books matching a Calibre query |
| `filter` | string | — | Restrict grouping to a bundle (no auto-exclusion: maintenance sees everything) |
| `library` | string | *(default)* | Library name or id |
| `limit` | number | `50` | Groups per page (max 200) |
| `cursor` | string | — | Continuation token |

> Ask: *"find duplicate books in my library"* · *"compare books 12 and 340 — which should I keep?"* (`mode: compare`)

### `calibre_quality_report`

Audit books for metadata problems: missing fields, raw-filename titles (e.g. `795731065.pdf`),
invalid ISBNs, author-sort mismatches, series gaps, and suspect (glued/junk) authors. Defaults to the whole library; narrow
with `ids`, a `query`, or a specific list of `checks`. The raw-filename findings feed straight
into `calibre_recover_metadata`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `checks` | array of `missing_metadata` \| `raw_filename_title` \| `isbn_invalid` \| `author_sort_mismatch` \| `series_gaps` \| `authors_suspect` | *(all)* | Which checks to run |
| `ids` | array of ids | — | Restrict to these books |
| `query` | string | — | Restrict to books matching a Calibre query |
| `filter` | string | — | Restrict to a bundle (no auto-exclusion: maintenance sees everything) |
| `library` | string | *(default)* | Library name or id |
| `limit` | number | `100` | Issues per page (max 500) |
| `cursor` | string | — | Continuation token |

> Ask: *"what's wrong with my library's metadata?"* · *"check my Rust books for invalid ISBNs"*

---

## Metadata enrichment

### `calibre_recover_metadata`

Propose real metadata for a book whose title/authors are missing or a leftover filename. It
picks a lookup key (an existing valid ISBN, an ISBN scraped from the book's text, or the
title + first author) and queries Open Library, then Google Books. **Preview only** — it returns
a proposal plus a ready-to-apply `changes` object and never writes. Apply the proposal with
`calibre_update_book`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to look up |
| `sources` | array of `openlibrary` \| `googlebooks` | *(both, in order)* | Which providers to query |
| `library` | string | *(default)* | Library name or id |

> Ask: *"recover the real title and author for book 512"* · *"look up metadata for that raw-filename book"*

---

## Writes (gated)

The tools below change your library. With writes off, their previews still work and only the
call that would change the library is refused (`write_disabled`); `calibre_update_book` and
`calibre_add_book`, which have no preview, stay hidden — see [Write safety](#write-safety). All of them route through the Calibre Content Server so they
don't conflict with an open Calibre GUI.

### `calibre_extract_isbn`

Scan a book's own text (offline, no network) for a checksum-valid ISBN and set it as the book's
`isbn` identifier. Preview-first: with `apply: false` (the default) it reports what it found and
writes nothing. It merges into existing identifiers, so a DOI/ASIN/etc. is never dropped. For
*online* metadata lookup, use `calibre_recover_metadata` instead.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to scan |
| `apply` | boolean | `false` | Write the ISBN; `false` only reports what was found |
| `library` | string | *(default)* | Library name or id |

> Ask: *"find and set the ISBN for book 512 from its text"* (add "actually apply it" to write)

### `calibre_update_book`

Set metadata fields on one book — title, authors, tags, series, series_index, rating,
publisher, pubdate, languages, comments, identifiers, or any `#custom` column. Omitted fields
are left untouched. Returns the applied before/after diff.

Partial `pubdate` values are normalised to the first day before writing: `"2020"` stores
`2020-01-01`, `"2020-05"` stores `2020-05-01` (Calibre would otherwise fill the missing parts
from today's date). The diff shows the stored date. `identifiers` must be an object
(`{"isbn": "9780132350884"}`); the `"isbn:…"` string form is rejected with `invalid_input`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to update |
| `changes` | object | *(required)* | Field → new value (e.g. `{ "tags": ["rust", "systems"], "rating": 5 }`) |
| `library` | string | *(default)* | Library name or id |

> Ask: *"tag book 187 as kafka and add a 5-star rating"* · *"set the author of book 512 to Donald Knuth"*

**Result.** structuredContent holds `id`, `changed` (`{ field, before, after }` per field that
actually changed) and `noop` (`true` when every value was already current). A timed-out write,
or one whose connection dropped mid-request, may still have committed, so the tool re-reads the
book. When the re-read shows every requested value, the call succeeds, `confirmedByReRead` is
`"timeout"` or `"dropped"`, and the text says so (e.g. `Updated book 187: tags. Confirmed by a
re-read after calibredb timed out.`). If the re-read can't confirm it (some fields landed, others
didn't, or another edit changed them), the result is a `write_unverified` error. Its text says
what the re-read showed: a re-read that failed, or one that shows another edit's value, steers you
to check with `calibre_get_book` before retrying; a timed-out write the re-read shows did not
land says "Retry, or check with `calibre_get_book` first". A transient-failure message names
the real number of retries (`… after 2 retries`).

### `calibre_bulk_update`

Apply the **same** metadata change to a set of books selected by `ids`, a `query`, or a
`filter` (bundle name). A selection is required — there is no all-books default. Preview-first:
it returns the per-book diff without writing unless you pass `preview: false`. Capped at 500
books per call. Pass `changes`, `tags_add`/`tags_remove`, or both; `changes.tags` cannot be
combined with `tags_add`/`tags_remove`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `changes` | object | — | Field → new value applied to every selected book (a list replaces the whole list) |
| `tags_add` | array of strings | — | Tags to add to each book, keeping its other tags; an existing tag keeps the library's spelling |
| `tags_remove` | array of strings | — | Tags to remove from each book (case-insensitive); a missing tag is a no-op |
| `ids` | array of ids | — | Books to change (one of `ids`/`query`/`filter` required; `ids` cannot be combined with `query` or `filter`) |
| `query` | string | — | Select books by a Calibre query |
| `filter` | string | — | Select a bundle's books (no auto-exclusion on writes) |
| `preview` | boolean | `true` | Preview the diff; set `false` to write |
| `library` | string | *(default)* | Library name or id |

**Preview.** Each entry in `books` carries `id`, `title`, `changed` (`{ field, before, after }`),
`tagsAdded` / `tagsRemoved` for a tags merge, and `warnings` when the edit needs a second look.
The same warnings appear as `⚠` lines in the text:
- a list value replaces the whole list, e.g. `tags: 3 → 1 (replaces the list: drops a, b)`
  (never for a `tags_add` / `tags_remove` merge, which keeps the tags it doesn't remove);
- a case-only rename of a tag or author renames it on every book, e.g.
  `tags: python → Python renames it on every book in the library (Calibre keeps one case-insensitive item)`.

**Apply** (`preview: false`). structuredContent holds `matched`, `applied` (ids written),
`failed` (`{ id, error }`) and, when they apply:
- `unchanged`: for a `tags_add` / `tags_remove` call, the books where nothing would change: the
  tag merge AND any `changes` fields sent with it are already current. They get no
  `set_metadata`. A book whose tags are already current but whose other field (e.g. `series`)
  changes is written and listed in `applied`. The tool decides this on a fresh re-read of the
  book (the selection may be stale), and lists skipped books in `unchanged`, not in `applied`. Text: `Already current (nothing
  written): 2, 5.`
- `confirmedByReRead`: `{ id, cause: "dropped" | "timeout" }` for each book whose write timed
  out or lost its connection mid-request but a re-read showed every requested value. The book is
  also in `applied`. Text: `Confirmed by a re-read: 2 (connection dropped), 4 (timed out).` A book
  the re-read can't confirm is in `failed` with a "verify with `calibre_get_book`" steer.
- `notAttempted` and `retryIds`: when a refusal or an unreachable server stops the run partway,
  the result is an error that still lists the committed ids. `retryIds` is the exact set to
  re-run.

> Ask: *"tag every book matching series:SICP as classic — preview first"* then *"apply it"*

### `calibre_add_book`

Import a local ebook file (EPUB/PDF/MOBI/…) into the library. The file must live under an
allowed import root (`CALIBRE_MCP_ADD_ROOTS`) and be reachable by the Calibre server process.
Returns the new book id(s) (`addedIds`).

After the add, a read-only duplicate probe checks each new book against the library, including
other books added in the same call. It flags a book with the same ISBN, or the same work as
`calibre_find_duplicates mode=similar` sees it (titles alone when either book has no authors
yet, as with a raw-filename import). Each flagged book gets an advisory line in the text, e.g.
`⚠ #1270: possible duplicate of #210 (same normalized title) — run calibre_find_duplicates mode=compare ids=[210,1270] to review. Nothing was merged or removed.`,
and an entry in `possibleDuplicates` (`{ id, of, reason: "isbn" | "title" }`). The probe checks
at most 10 new books; the rest are listed in `notProbed` and named in the text. A failed probe
never fails the add: the text says the probe was unavailable, and the cap note still appears.
A filename-slug title (`learning-go-2nd-edition`, no spaces) is read with its `-`/`_`/`.`
separators as spaces, so its edition is recognised.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | *(required)* | Path to the ebook file to import |
| `library` | string | *(default)* | Library name or id |

> Ask: *"add ~/Downloads/rust-book.epub to my library"*

### `calibre_remove_book`

**Destructive (recoverable).** Remove books from the library. Removed books go to Calibre's
Trash and can be restored from the Calibre GUI. Dry-run by default: without `confirm: true` it
lists what *would* be removed and writes nothing. Ids that are not books in the library are
skipped and named (`notFoundIds`, "Not found (skipped)"), in the dry-run and on apply alike; if
none of the ids is a book, the call is a `not_found` error.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `ids` | array of ids | *(required)* | Books to delete |
| `confirm` | boolean | `false` | Must be `true` to actually delete |
| `library` | string | *(default)* | Library name or id |

> Ask: *"what would deleting books 12 and 340 remove?"* then *"confirm the deletion"*

### `calibre_merge_books`

**Destructive.** Merge duplicate records the way Calibre's GUI does: move formats from source
books into a target (the target's copy wins conflicts), merge metadata per Calibre's rules, then
trash the sources. Modes: `merge` (the default) trashes sources after merging; `safe` keeps the
sources; `formatsOnly` moves formats and leaves metadata untouched. Dry-run by default —
without `confirm: true` it prints the full plan (survivor, format moves, metadata changes,
trash list) and writes nothing. Trashed sources stay recoverable from Calibre's trash for about
two weeks. Deletion always happens last, so an interrupted merge never loses data — just re-run
the same call to finish.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `targetId` | number | *(required)* | The surviving record |
| `sourceIds` | array of numbers | *(required)* | Books merged into the target (must exclude `targetId`) |
| `mode` | `merge` \| `safe` \| `formatsOnly` | `merge` | Whether/how sources are trashed |
| `confirm` | boolean | `false` | Must be `true` to execute; otherwise a dry-run plan |
| `library` | string | *(default)* | Library name or id |

> Ask: *"plan a merge of books 340 and 341 into 12"* then *"do it"*

### `calibre_manage_bundles`

Manage **Bundles** — named topical filters over your library, backed by Calibre **saved
searches**. A bundle called `rust` with the expression `tag:rust or title:rust` lets you (and
the assistant) scope work to that slice instead of the whole library. A bundle whose name starts
with `-` (e.g. `-outdated`) is an **exclusion marker**: a set of books to keep out of the way.

`action: list` also shows your **virtual libraries**, marked `read_only`. This tool
never creates or changes a virtual library — bundles it writes are always saved searches, and the result says so (`created_as:
saved_search`). Trying to update or delete a virtual library returns an error pointing you at the
Calibre GUI.

`create` and `update` are preview-first: the first call runs the expression against your library
and reports how many books match — free validation before anything is written. An invalid
expression is reported as a syntax error. A count of `0` is ambiguous: Calibre also returns 0
matches for an unknown field name, so check spelling before confirming. `delete` removes only the
saved search; no books are touched.

With writes off, `list` and every preview work; only a confirmed `create` / `update` / `delete`
is refused with `write_disabled`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `action` | `list` \| `create` \| `update` \| `delete` | *(required)* | What to do |
| `name` | string | — | Bundle name (required for everything but `list`); leading `-` = exclusion marker |
| `expression` | string | — | Calibre search grammar (required for `create`/`update`), e.g. `tag:rust and format:EPUB` |
| `confirm` | boolean | `false` | Must be `true` to write; otherwise a preview |
| `library` | string | *(default)* | Library name or id |

> Ask: *"what bundles do I have?"* · *"make a rust bundle for tag:rust"* then *"confirm it"*

**Using bundles.** Once created, bundles plug into the read tools via their `filter` parameter:
`calibre_search`, `calibre_semantic_search` (library scope), `calibre_bulk_update`,
`calibre_quality_report`, and `calibre_find_duplicates` all accept `filter: "<bundle name>"`.
Discovery searches additionally subtract every `-`-named exclusion bundle by default (opt out
per call with `include_excluded: true`); maintenance/write tools never auto-subtract — quality
and dedupe work is most needed exactly on the noise books. Passing an exclusion marker itself
as the filter (e.g. `filter: "-outdated"`) targets those books and disables the subtraction for
that call. An unknown filter name errors with the list of available bundles. Filtering is
query-time only — bundle changes never require a semantic re-index.

---

## Write safety

Writes are off by default and protected by two independent switches:

1. **The MCP-side gate.** The server changes nothing in the library unless
   `CALIBRE_MCP_ENABLE_WRITE` is set (`1` / `true` / `yes`), or you tick *Enable writes* in the
   Claude Desktop bundle settings. The gate works per call: with it off, the preview-first tools
   below stay listed (announced read-only) and their previews work, while the call that would
   write (`apply: true`, `preview: false`, `confirm: true`) returns `write_disabled`.
   `calibre_update_book` and `calibre_add_book` have no preview, so they stay hidden.
2. **The Calibre-side gate.** The Content Server must permit local writes. The server embedded
   in the Calibre GUI is read-only by default — enable *Sharing over the net → Advanced → allow
   local connections to make changes* and restart the Content Server, or run a standalone
   `calibre-server --enable-local-write`. With only the MCP gate on, the write tools appear but
   Calibre refuses the write and tells you exactly why.

Beyond the gates, destructive and bulk operations are **preview-first** — they show you what
they'll do and change nothing until you explicitly confirm:

| Tool | How to actually execute |
|---|---|
| `calibre_bulk_update` | `preview: false` (and a required `ids`/`query`/`filter` selection) |
| `calibre_remove_book` | `confirm: true` |
| `calibre_merge_books` | `confirm: true` |
| `calibre_extract_isbn` | `apply: true` |
| `calibre_manage_bundles` | `confirm: true` |

`calibre_add_book` only imports files from folders listed in `CALIBRE_MCP_ADD_ROOTS`
(symlink-resolved, so paths can't escape the allowed roots). All writes route through the
Content Server, so they never race an open Calibre GUI.

---

## Labelled lines

Most of a tool's text is Prose: it can be reworded in any release. A few text lines are part of
the public contract instead: a **Labelled line** carries a field of the structured result under a
fixed label and value format, so an assistant (or your script) can rely on finding it in the text
alone. From 1.0 these labels and formats change only in a major release. Where a line mixes both,
only the part named here is contract. The table is generated from the server's registry
(`src/tools/labelled-lines.ts`) and checked by the test suite.

<!-- labelled-lines:start -->
| Tool | Label | Value format | Structured field |
|---|---|---|---|
| every tool (handler and write-gate errors) | `Code` | `Code: <errorCode>` — one of the closed error-code set | `errorCode` |
| every tool (handler and write-gate errors) | `Next` | `Next: <hint>` — omitted when the message already states the hint (the hint text itself is Prose; the label and its presence are contract) | `hint` |
| `calibre_list_libraries` | `id` | `<Name> (id: <libraryId>)[ [default]]` — one line per library | `libraries[].id` |
| `calibre_get_book` | `id` | `id: <id> \| uuid: <uuid>[ \| …]` (fields after the uuid are Prose) | `book.id` |
| `calibre_search` | `cursor` | `… cursor: <nextCursor>` at the end of the line — pass the token verbatim (the words before `cursor:` are Prose) | `nextCursor` |
| `calibre_search` | `annotation` | `annotation <id> · <type> · book <bookId> · <format> · <title>` — mode=annotations, one per hit (the format and title after `book <bookId>` are Prose) | `annotations[].id` |
| `calibre_search` | `note` | `note · <field>: <item>` — mode=notes, one per hit | `notes[].item` |
| `calibre_list_categories` | `cursor` | `… cursor: <nextCursor>` at the end of the line — pass the token verbatim (the words before `cursor:` are Prose) | `nextCursor` |
| `calibre_quality_report` | `cursor` | `… cursor: <nextCursor>` at the end of the line — pass the token verbatim (the words before `cursor:` are Prose) | `nextCursor` |
| `calibre_find_duplicates` | `cursor` | `… cursor: <nextCursor>` at the end of the line — pass the token verbatim (the words before `cursor:` are Prose) | `nextCursor` |
| `calibre_get_content` | `cursor` | `… cursor: <nextCursor>` at the end of the line — pass the token verbatim (the words before `cursor:` are Prose) | `nextCursor` |
| `calibre_build_index` | `Indexed ids` | `Indexed ids: <id>, <id>.` | `bookDetails[].bookId` |
| `calibre_build_index` | `FTS` | `- FTS: write_disabled\|already enabled\|enabled\|failed — …` — only with `enableFts: true` (`already enabled` is `already_enabled`; the words after the dash are Prose) | `fts.status` |
| `calibre_ping` | `calibredb` | `calibredb: <path> (Content Server <url>)` | `calibredbPath` |
| `calibre_ping` | `calibre version` | `calibre version: <x.y[.z]>\|unknown` — from `calibredb --version` | `calibreVersion` |
| `calibre_ping` | `writes` | `writes: ENABLED (…)` or `writes: disabled — <what still works> (…)` — our write gate (the text after the state word is Prose) | `writeEnabled` |
| `calibre_ping` | `calibre writes` | `calibre writes: allowed\|refused — <how to allow writes>\|unknown (<reason>)` (the remedy after `refused` and the reason are Prose) | `calibreWriteAccess` |
| `calibre_ping` | `Semantic search` | `Semantic search: ready\|UNAVAILABLE\|index STALE …` (the state word is contract; the explanation and steering sentence are Prose) | `semantic.available` |
| `calibre_ping` | `index` | on the Semantic search line: `; <libraryId> index v<N>: <B> books / <C> chunks / <F> figures, <V> vectors` or `; <libraryId> index busy — …` | `semantic.libraryId` |
| `calibre_ping` | `Index` | `Index: <entry> · <entry>…[ · … +K more — …]` or `skipped — Calibre unreachable` / `skipped — library busy` / `libraries unavailable` / `(no libraries)` | `indexes` |
| `calibre_ping` | `id` | each Index entry: `<Name> (id: <libraryId>)[ [default]]: <N>/<M\|?> indexed[ (<K> without embeddings)]\|none\|stale index (rebuild)\|busy — …\|not indexable — …\|index unreadable` (at most 20) | `indexes[].id` |
| `calibre_ping` | `log file` | `log file: <path>\|off (stderr only)` | `logFile` |
| `calibre_ping` | `recent errors` | `recent errors: <N>[ (<M> occurrences)]` | `recentErrors` |

Errors the MCP SDK answers before a handler runs carry no `Code:` or `Next:` line: input-validation
failures, and a direct call to `calibre_update_book` or `calibre_add_book` while writes are off.

Tools whose text has no Labelled lines beyond the error lines:

- `calibre_semantic_search` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_get_figures` — text is Prose; no outputSchema (images ride in content blocks)
- `calibre_recover_metadata` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_extract_isbn` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_update_book` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_bulk_update` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_add_book` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_remove_book` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_merge_books` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_manage_bundles` — text is Prose (its fields sit inside sentences or item lines)
- `calibre_board_data` — app-only widget tool — the model never sees its text
- `calibre_open_book` — app-only widget tool — the model never sees its text
<!-- labelled-lines:end -->

---

## A note on the widget-internal tools

<!-- tool-count:appOnly -->2<!-- /tool-count:appOnly --> extra tools exist that aren't meant for the assistant to call; MCP-Apps hosts (like
Claude Desktop) hide them from the model:

- `calibre_board_data` — the in-chat cover board re-fetches its own search data through it.
  It returns nothing your search results don't already contain, so you can ignore it.
- `calibre_open_book` — the widgets' **Open** button. It launches a book in your local
  Calibre viewer via the `calibre://` URL scheme (registered by the Calibre installer).
  It never modifies the library, so it isn't behind the write gate.

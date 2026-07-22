# Tool reference

The calibre-mcp server exposes 17 tools your AI assistant can call to work with your
[Calibre](https://calibre-ebook.com) library. They fall into two scopes:

- **Catalog / library** — search across the whole library, browse categories, curate
  metadata, dedupe, run quality audits, add/remove/merge books.
- **Single book** — read a book's text or chapter map, and search *inside* one book.

The two search tools (`calibre_search`, `calibre_semantic_search`) span both scopes via a
`scope: library | book` parameter — no separate per-book tools.

Everything is read-only unless you turn writes on; see [Write safety](#write-safety) at the
end. Most tools accept a `library` parameter (the library's display name or id, as shown by
`calibre_list_libraries`); leave it unset to use the Content Server's default library.

Book ids: wherever a tool takes `id` / `bookId`, you can pass a numeric database id or a
book uuid — they're interchangeable. The id you get back from a search result is what these
tools expect.

---

## Health check

### `calibre_ping`

Confirms the server can reach your running Calibre Content Server (end to end, via
`calibredb`) and reports semantic-search status — whether the embedding model and its
dependency are present, and how many vectors the index holds. On success it also returns your
library's categories. Use it first when something isn't working, or to answer "why is semantic
search off?".

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
| `mode` | `meta` \| `fts` | `meta` | `meta` = metadata/query-syntax search; `fts` = full-text search |
| `scope` | `library` \| `book` | `library` | `book` searches inside one book (forces full text; needs `bookId`) |
| `bookId` | number \| uuid | — | Required when `scope: book` |
| `library` | string | *(default)* | Library name or id |
| `sort` | `title` \| `authors` \| `pubdate` \| `timestamp` \| `rating` \| `last_modified` | — | Sort field (metadata search) |
| `sortOrder` | `asc` \| `desc` | — | Sort direction |
| `limit` | number | `20` | Results per page (max 50) |
| `cursor` | string | — | Continuation token from a previous response's `nextCursor` |

> Ask: *"find books about Rust"* · *"search my library for author:knuth"* · *"where does book 187 mention rebalancing?"* (`scope: book`)

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

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to read |
| `format` | string | *(auto)* | Which format to extract (e.g. `epub`, `pdf`); auto-picks the best |
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
inline equation art) are hidden unless `include_uncaptioned: true`.

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

List the libraries the Content Server exposes and which one is the default. A good first call
to discover valid library names, and a quick connectivity check.

No parameters.

> Ask: *"list my calibre libraries"*

---

## Semantic search

Meaning-based retrieval — the feature no other Calibre MCP server has. It finds books and
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

All modes need an index built by `calibre_build_index` first. If you only built a keyword-only
(model-free) index, `keyword` mode works, `vector` errors with guidance, and `hybrid` degrades
to keyword with a note.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `query` | string | *(required)* | What you're looking for, in natural language |
| `scope` | `library` \| `book` | `library` | `library` ranks books; `book` ranks passages within one book |
| `mode` | `hybrid` \| `vector` \| `keyword` | `hybrid` | Retrieval strategy |
| `bookId` | number \| uuid | — | Required when `scope: book` |
| `topK` | number | `10` | How many results to return (max 50) |
| `library` | string | *(default)* | Library name or id |

> Ask: *"which of my books explain consumer-group rebalancing?"* · *"find passages in book 187 about idempotent producers"* (`scope: book`)

### `calibre_build_index`

Build (or refresh) the local semantic index for a chosen set of books. A selector is
**required** — pick books by `bookId`, a list of `ids`, or a Calibre `query` (there's no
index-everything default). The first embedding build downloads the model (~118 MB, one-time),
then runs offline. Set `keywordOnly: true` to build a model-free keyword index (zero ML
dependencies); this also happens automatically if the embedding model isn't installed. Re-run
after adding books; use `force: true` to re-index books that haven't changed.

This writes only to the server's own local index directory — not to your Calibre library — so
it's safe to run without enabling library writes.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `bookId` | number \| uuid | — | A single book to index |
| `ids` | array of ids | — | Several books to index |
| `query` | string | — | Index all books matching a Calibre query (capped at 100) |
| `library` | string | *(default)* | Library name or id |
| `force` | boolean | `false` | Re-index books even if unchanged |
| `keywordOnly` | boolean | `false` | Build a keyword-only index (no embedding model needed) |

*(At least one of `bookId`, `ids`, or `query` is required.)*

> Ask: *"build the semantic index for my Kafka books"* · *"index books 187 182 571"*

---

## Curation & quality

### `calibre_find_duplicates`

Surface probable duplicate books so you can decide what to merge. `mode: identical` groups by
exact title + authors; `mode: similar` groups fuzzily; each group carries a **merge-safety
score**. `mode: compare` diffs two or more specific books field by field and recommends which to
keep. It never merges anything — that's `calibre_merge_books`. Mixed-language groups are flagged
as likely translations (not true duplicates), and a language difference caps the merge-safety
score with a review warning.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `identical` \| `similar` \| `compare` | `identical` | Grouping strategy, or field-by-field compare |
| `ids` | array of ids | — | Restrict grouping to these books; **required** (2+) for `compare` |
| `query` | string | — | Restrict grouping to books matching a Calibre query |
| `library` | string | *(default)* | Library name or id |
| `limit` | number | `50` | Groups per page (max 200) |
| `cursor` | string | — | Continuation token |

> Ask: *"find duplicate books in my library"* · *"compare books 12 and 340 — which should I keep?"* (`mode: compare`)

### `calibre_quality_report`

Audit books for metadata problems: missing fields, raw-filename titles (e.g. `795731065.pdf`),
invalid ISBNs, author-sort mismatches, and series gaps. Defaults to the whole library; narrow
with `ids`, a `query`, or a specific list of `checks`. The raw-filename findings feed straight
into `calibre_recover_metadata`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `checks` | array of `missing_metadata` \| `raw_filename_title` \| `isbn_invalid` \| `author_sort_mismatch` \| `series_gaps` | *(all)* | Which checks to run |
| `ids` | array of ids | — | Restrict to these books |
| `query` | string | — | Restrict to books matching a Calibre query |
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

The tools below change your library and are **hidden unless you enable writes** — see
[Write safety](#write-safety). All of them route through the Calibre Content Server so they
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

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `id` (or `bookId`) | number \| uuid | *(required)* | The book to update |
| `changes` | object | *(required)* | Field → new value (e.g. `{ "tags": ["rust", "systems"], "rating": 5 }`) |
| `library` | string | *(default)* | Library name or id |

> Ask: *"tag book 187 as kafka and add a 5-star rating"* · *"set the author of book 512 to Donald Knuth"*

### `calibre_bulk_update`

Apply the **same** metadata change to a set of books selected by `ids` or a `query`. A selection
is required — there is no all-books default. Preview-first: it returns the per-book diff without
writing unless you pass `preview: false`. Capped at 500 books per call.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `changes` | object | *(required)* | Field → new value applied to every selected book |
| `ids` | array of ids | — | Books to change (one of `ids`/`query` required) |
| `query` | string | — | Select books by a Calibre query |
| `preview` | boolean | `true` | Preview the diff; set `false` to write |
| `library` | string | *(default)* | Library name or id |

> Ask: *"tag every book matching series:SICP as classic — preview first"* then *"apply it"*

### `calibre_add_book`

Import a local ebook file (EPUB/PDF/MOBI/…) into the library. The file must live under an
allowed import root (`CALIBRE_MCP_ADD_ROOTS`) and be reachable by the Calibre server process.
Returns the new book id(s).

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | *(required)* | Path to the ebook file to import |
| `library` | string | *(default)* | Library name or id |

> Ask: *"add ~/Downloads/rust-book.epub to my library"*

### `calibre_remove_book`

**Destructive (recoverable).** Remove books from the library. Removed books go to Calibre's
Trash and can be restored from the Calibre GUI. Dry-run by default: without `confirm: true` it
lists what *would* be removed and writes nothing.

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

---

## Write safety

Write tools are off by default and protected by two independent switches:

1. **The MCP-side gate.** Write tools aren't even registered unless
   `CALIBRE_MCP_ENABLE_WRITE` is set (`1` / `true` / `yes`), or you tick *Enable writes* in the
   Claude Desktop bundle settings.
2. **The Calibre-side gate.** The Content Server must permit local writes. The server embedded
   in the Calibre GUI is read-only by default — enable *Sharing over the net → Advanced → allow
   local connections to make changes* and restart the Content Server, or run a standalone
   `calibre-server --enable-local-write`. With only the MCP gate on, the write tools appear but
   Calibre refuses the write and tells you exactly why.

Beyond the gates, destructive and bulk operations are **preview-first** — they show you what
they'll do and change nothing until you explicitly confirm:

| Tool | How to actually execute |
|---|---|
| `calibre_bulk_update` | `preview: false` (and a required `ids`/`query` selection) |
| `calibre_remove_book` | `confirm: true` |
| `calibre_merge_books` | `confirm: true` |
| `calibre_extract_isbn` | `apply: true` |

`calibre_add_book` only imports files from folders listed in `CALIBRE_MCP_ADD_ROOTS`
(symlink-resolved, so paths can't escape the allowed roots). All writes route through the
Content Server, so they never race an open Calibre GUI.

---

## A note on the widget-internal tools

Two extra tools exist that aren't meant for the assistant to call; MCP-Apps hosts (like
Claude Desktop) hide them from the model:

- `calibre_board_data` — the in-chat cover board re-fetches its own search data through it.
  It returns nothing your search results don't already contain, so you can ignore it.
- `calibre_open_book` — the widgets' **Open** button. It launches a book in your local
  Calibre viewer via the `calibre://` URL scheme (registered by the Calibre installer).
  It never modifies the library, so it isn't behind the write gate.

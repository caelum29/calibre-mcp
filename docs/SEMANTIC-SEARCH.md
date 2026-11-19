# How semantic search works

`calibre_semantic_search` finds books and passages by **meaning**, not just keywords.
Ask *"which of my books explain consumer-group rebalancing?"* and it ranks the books —
or the exact passages inside one book — that actually discuss the concept, even when
the wording differs or the book is in another language.

Everything runs **locally**: the embedding model, the index, and every query. No book
text ever leaves your machine.

## The two scopes

One tool, two scopes (`scope` parameter):

- **`scope: library`** (default) — ranks *books* across your whole library. "Which
  books cover X?"
- **`scope: book`** (+ `bookId`) — ranks *passages* inside a single book, with their
  location, so you can jump straight to the relevant section with
  `calibre_get_content`. "Where does this book explain X?"

## The three modes

- **`hybrid`** (default) — combines semantic (vector) matching with exact keyword
  matching. Best recall: semantic catches paraphrases and cross-lingual matches,
  keyword catches exact terms, identifiers, and code tokens.
- **`vector`** — semantic-only.
- **`keyword`** — exact full-text search over the index, no ML model involved. Works
  even with a keyword-only index (see below).

## Building the index

Semantic search needs a local index, built once per book with `calibre_build_index`:

1. **Extract** the book's text. EPUBs are parsed natively; PDFs use the best
   extractor available on your machine (`pdftotext` from poppler, then PyMuPDF, then
   Calibre's `ebook-convert` as the last resort). Scanned/image-only PDFs yield no
   text — there is no OCR. Markdown (`MD`/`MARKDOWN`), `TXT`/`TXTZ`, AZW3, MOBI,
   DOCX, ODT, HTMLZ, FB2 and RTF are extracted too; when a book has several formats the
   best-structured one wins (EPUB → Markdown → PDF → the rest).
   The extracted text is then **normalised** once (ligatures and full-width forms folded,
   superscripts and subscripts kept, control characters dropped, Unicode spaces made plain,
   soft hyphens removed, line-end hyphenation joined when the next line starts lowercase;
   page breaks and headings kept). Chunks, embeddings, keyword stems, snippets, chapter
   maps and `calibre_get_content` all read this one text, so their offsets agree.
2. **Chunk** the text into ~460-token passages, split along headings
   where possible, then blank lines, lines, sentence ends (Unicode sentence segmentation,
   so `e.g.` or `Fig. 3` does not end a passage) and spaces. Each chunk keeps its location (page / chapter position) and is
   prefixed with the book title, author, and heading path so the embedding carries
   context.
3. **Embed** each chunk with `multilingual-e5-small` — a compact multilingual model
   (~118 MB, downloaded once on first use, then cached offline). Vectors are stored
   in a local SQLite file alongside a keyword (FTS5) index with English **and**
   Russian stemming.

Select which books to index with `bookId`, `ids`, or a metadata `query`; re-run after
adding books (unchanged books are skipped), and pass `force: true` to rebuild.

The index lives in a per-user data directory
(macOS: `~/Library/Application Support/calibre-mcp/index`; Linux:
`~/.local/share/calibre-mcp/index`; Windows: `%APPDATA%\calibre-mcp\index`) —
override with `CALIBRE_MCP_INDEX_DIR`. Your Calibre library is never modified.

### Removed and merged books

When `calibre_remove_book` or `calibre_merge_books` removes books, it also drops them from the
index once the removal is confirmed, so semantic search stops returning them. This is
best-effort: if another process holds the index at that moment, the removal still succeeds and
its result says the index was not updated.

Books removed or merged in the Calibre GUI are caught at search time. Before answering,
`calibre_semantic_search` asks Calibre, in one request, which of its hit books still exist, and
leaves out the ones that don't, for text and figure results alike. The search can then return
fewer than `topK` hits (dropped hits are not backfilled). It also drops those books from the index (best-effort, the same way as
above), so the next search doesn't run into them again. A `scope: book` search on a book that
is gone answers `not_found`.

The check never holds up a search: if Calibre doesn't answer within 1.5 s, or the answer can't
be trusted, the hits come back unchecked. `calibre_build_index` with `prune: true` still drops
every index entry whose book is gone, including books no search has hit yet.

`calibre_ping` counts only books the library still holds as indexed. When it can't check that in
time, it shows the raw count marked `(count not checked against the library)`.

### Without the ML model

The embedding model comes from the optional `@huggingface/transformers` package
(not included in the Claude Desktop `.mcpb` bundle). When it's absent,
`calibre_build_index` automatically builds a **keyword-only** index — `mode: keyword`
search works with zero ML dependencies; `hybrid` degrades to keyword and `vector`
explains what's missing. Install the package and run `calibre_build_index` again
to upgrade to full semantic search — books indexed without embeddings count as out of
date, so no `force` is needed. A keyword-only build never replaces a book's existing
embeddings, and `calibre_ping` reports how many books are indexed without them.

A keyword-only index you asked for (`keywordOnly: true`) while the model is installed needs no
install: rebuild without `keywordOnly` (`force: true`). The build result's `semanticAvailable`
reports whether the model is usable on the server, so it stays `true` in that case; install
steps appear only when the model is really missing.

## Answering a query

```
your query
 ├─ semantic half: embed the query → cosine similarity against every chunk vector
 ├─ keyword half:  stemmed full-text match (BM25), English + Russian aware
 ├─ fuse both rankings (reciprocal-rank fusion — no fragile score mixing)
 ├─ rerank the top candidates with a cross-encoder (optional, see below)
 └─ return ranked books (library scope) or located passages (book scope)
```

The keyword half matches query words by their stems, so `templates` finds `template`. Code
identifiers that hold `+`, `#`, `.` or `-` (`C++`, `C#`, `Node.js`, `utf-8`) also match in
their exact form, including at the end of a sentence (`… written in C++.`); without that, `C++`
would only be searched as the letter `c`.

A repeated word counts once, and a word that appears in more than half of a library's passages
(`the`, `and`, `use`, …) is left out of the keyword match: it says almost nothing about which
passage fits and costs the most time to look up. A one-word query, words in `"quotes"`, and the
rarest word of a query made only of such words are always kept. Whether a non-English function
word is left out depends on the library's language mix: in one mostly English library of
416,737 passages the most common Russian word, `в`, sits in 15.6% of them and stays in; in a
library of 50,963 passages with much Russian text, `в` (62.1%), `на`, `не` and `и` (53–56%)
are above half and are left out.

Two refinements worth knowing about:

- **Reranking.** If the optional reranker model is present (`bge-reranker-v2-m3`,
  ~576 MB, downloaded on first index build), the top ~30 fused candidates are
  re-scored by a cross-encoder that reads the query and passage *together* — a
  noticeably sharper final ordering. In library scope a book among the keyword
  half's top five whose best keyword passage differs from its best semantic passage
  sends both passages; the book shows whichever scores higher. The cross-encoder
  still reads at most 30 passages per search, so the top 25–30 books are re-scored.
  Without the model, results keep the fused order. Disable with
  `CALIBRE_MCP_RERANK=off`. Reranking takes seconds of CPU, so rerank calls run one
  at a time in arrival order; when more than two are already
  waiting, a new search skips the rerank (fused order + a "reranker busy" note) rather
  than waiting past the client's request timeout.
- **Front and back matter.** At index time every chunk is labelled front matter (before the
  first chapter), body text, or back matter: an index page, a bibliography or a
  copyright/advertisement page (an index page is recognised in the last 15% of the book; a
  bibliography there too, or at any position under a bibliography heading; a copyright/ads page
  also in the first 10%). Index pages, copyright/ads pages, front matter
  without prose, and front matter that holds a table of contents (even with praise quotes or a
  foreword around it) are *strong*: they never use one of the reranker's 30 passages and come
  after the reranked hits. A bibliography and front matter with prose but no contents list (a
  preface) are *weak*: they are reranked like body text. In library scope a book is
  shown through its best body passage; a book that matches only in front or back matter still
  appears, after every book with a body match. In book scope a weak passage keeps its rerank
  position, so a preface that answers the question can come first; strong passages follow the
  body passages. Without a rerank (keyword mode, rerank off or unavailable), every front/back
  matter hit follows the body hits. Nothing is dropped: such hits are labelled `[front matter]`,
  `[back matter: index]`, `[back matter: bibliography]` or `[back matter: copyright/ads]`, and
  the header notes how many were placed after body matches. Books indexed before this change
  keep only their front-matter labels until they are re-indexed or backfilled.

## Figure search

`target: figures` runs the same pipeline over a separate corpus: **figure captions**.
At index time every captioned figure (see `calibre_get_figures`) is stored with its
caption embedding and its position in the book text, so "find a diagram of X" ranks
captions directly instead of hoping a text chunk mentions the figure. Hits carry the
caption, page, the surrounding passage (via the caption's position), and a ready-made
`calibre_get_figures` call — the image itself is fetched only when you ask for it.
The text-search confidence floor doesn't apply to captions (short strings score on a
different scale); a caption-specific floor will be enabled once calibrated.

## Citation provenance (`indexVersion`)

Every location a search returns — `charStart`/`charEnd` on passages and book hits,
`charOffset` and `page` on figure hits — is relative to the **extraction + chunking
generation** that built the index. That generation is the index's `indexVersion`, and
each successful `calibre_semantic_search` response carries it once: as `indexVersion`
in `structuredContent` and as one line under the header in the text.

`indexVersion` changes **exactly when stored offsets can move** — a pipeline change that
shifts chunk boundaries or extracted text bumps it and forces a full rebuild. Additive
changes (a new column, a new flag) don't bump it, and stored offsets stay valid.

If you persist citations (a study tool, a tutor app, notes that say "book 412,
chars 84210–85030"), store the `indexVersion` alongside them. When a later response
reports a different `indexVersion`, treat old offsets as stale and re-locate the
passage (e.g. search for it again). `calibre_ping` shows the current generation too,
and flags an index **stale** when it was built by a different model or generation than
the running server — search and builds refuse such an index until you delete its file (with
`-wal`/`-shm`; the error names the path) and rebuild with `calibre_build_index force=true`. Cross-generation stable anchors are out of scope for now.

**Index version 5** moved every offset into the normalised text (see *Building the index*):
offsets saved from a version-4 index point into the raw extraction and no longer match. After
upgrading, `calibre_ping` reports each version-4 index as `stale index — delete …`, semantic
search answers `index_incompatible`, and nothing is served from it in the meantime. The old file
is refused on every open, the build's included, so `force=true` alone cannot replace it: first
delete the library's index file `<index dir>/<library id>.sqlite` together with its `-wal` and `-shm` files (ping and the error name the exact path), then run `calibre_build_index force=true`
(a full re-index — hours for a library of about a thousand books). Metadata and Calibre full-text search (`calibre_search`) keep working meanwhile.

## Multilingual

The model is multilingual by design: English and Russian retrieval are verified, and
**cross-lingual queries work** — an English query finds relevant passages in a
Russian book and vice versa. The keyword half stems both languages, so
`книга/книги/книгу` match each other too.

## Limitations

- **Scanned PDFs** (image-only, no text layer) can't be indexed — no OCR.
- Indexing is CPU-bound: a few seconds per book on Apple Silicon; large libraries
  take a while on the first pass (later passes skip unchanged books).
- **Figure search doesn't reach every figure.** A caption is linked to the book text by
  matching it back into the extracted text; when a publisher's EPUB conversion doesn't
  reproduce the caption line, that figure is left out of the figure corpus — it is never
  linked to the *wrong* passage, just absent. Measured at ~97% of captioned figures on a
  790-book library, with the gaps confined to EPUBs (PDFs linked fully).
- **Front-matter demotion depends on chapter detection.** The boundary is the first
  chapter heading. For EPUBs, where the title page, copyright, praise and contents are
  themselves headings, it is the first `Chapter 1` / `1 Title` / `Part I` heading. Failing
  that, it is the end of the leading run of short and named front-matter sections (preface,
  acknowledgments, about the author…). Measured on a 773-book library, it covers ~95% of
  EPUBs and ~58% of PDFs. Books with no headings, or whose first chapter sits past 20% of
  the text, get no demotion. An `Introduction` that precedes `Chapter 1` counts as front
  matter. PDFs with publisher bookmarks use the outline's first
  non-front-matter entry as the boundary (the same chapter map `calibre_get_content`
  `structure: true` shows); a book-title bookmark right before the front-matter entries
  counts as front matter too. Books indexed before these changes pick them up on re-index.
- **Extraction improves between releases, but only for books indexed afterwards.** Text
  extraction, figure linkage, and front-matter detection all run at index time, so upgrading
  the server does not retroactively improve an existing index. Rebuild with `force: true`
  (whole library, or just the books you care about) after an upgrade whose notes mention
  extraction or figures.
- Retrieval is book-level or passage-level; exact PDF page mapping depends on the
  extractor's quality for that file.
- **Two libraries whose ids differ only in letter case** (`books` / `Books`) can't both be
  indexed: on a case-insensitive disk they would share one index file. The one indexed first
  keeps the index; the other is refused until its folder is renamed (see
  [Troubleshooting](TROUBLESHOOTING.md)).
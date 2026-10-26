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
2. **Chunk** the text into ~460-token passages with overlap, split along headings
   where possible. Each chunk keeps its location (page / chapter position) and is
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

### Without the ML model

The embedding model comes from the optional `@huggingface/transformers` package
(not included in the Claude Desktop `.mcpb` bundle). When it's absent,
`calibre_build_index` automatically builds a **keyword-only** index — `mode: keyword`
search works with zero ML dependencies; `hybrid` degrades to keyword and `vector`
explains what's missing. Install the package and run `calibre_build_index` again
to upgrade to full semantic search — books indexed without embeddings count as out of
date, so no `force` is needed. A keyword-only build never replaces a book's existing
embeddings, and `calibre_ping` reports how many books are indexed without them.

## Answering a query

```
your query
 ├─ semantic half: embed the query → cosine similarity against every chunk vector
 ├─ keyword half:  stemmed full-text match (BM25), English + Russian aware
 ├─ fuse both rankings (reciprocal-rank fusion — no fragile score mixing)
 ├─ rerank the top candidates with a cross-encoder (optional, see below)
 └─ return ranked books (library scope) or located passages (book scope)
```

Two refinements worth knowing about:

- **Reranking.** If the optional reranker model is present (`bge-reranker-v2-m3`,
  ~576 MB, downloaded on first index build), the top ~30 fused candidates are
  re-scored by a cross-encoder that reads the query and passage *together* — a
  noticeably sharper final ordering. Without the model, results keep the fused
  order. Disable with `CALIBRE_MCP_RERANK=off`. Reranking takes seconds of CPU, so
  rerank calls run one at a time in arrival order; when more than two are already
  waiting, a new search skips the rerank (fused order + a "reranker busy" note) rather
  than waiting past the client's request timeout.
- **Front-matter demotion.** In book scope, chunks from front matter (table of
  contents, praise quotes, forewords) are keyword-dense but rarely what you want, so
  they are demoted below body-text matches and labeled `[front matter]` — never
  dropped.

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
the running server — search refuses such an index until `calibre_build_index force=true`
rebuilds it. Cross-generation stable anchors are out of scope for now.

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
  `structure: true` shows); books indexed before that change pick it up on re-index.
- **Extraction improves between releases, but only for books indexed afterwards.** Text
  extraction, figure linkage, and front-matter detection all run at index time, so upgrading
  the server does not retroactively improve an existing index. Rebuild with `force: true`
  (whole library, or just the books you care about) after an upgrade whose notes mention
  extraction or figures.
- Retrieval is book-level or passage-level; exact PDF page mapping depends on the
  extractor's quality for that file.
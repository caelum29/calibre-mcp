# Troubleshooting

Symptom-first guide to the failures you're most likely to hit. Configuration variables
mentioned here are documented in the [README's Configuration section](../README.md#%EF%B8%8F-configuration).

**Start with `calibre_ping`.** It checks the whole chain — Content Server reachability,
`calibredb`, library resolution, and semantic-search status (model present? how many vectors
indexed?) — and its output usually names the broken link directly. Just ask: *"is calibre
reachable?"*

---

## Connection & setup

### "Calibre unreachable" / connection refused

The Content Server isn't running, or the server URL is wrong.

- In Calibre: **Connect/share → Start Content server**. To have it start automatically:
  *Preferences → Sharing over the net → Run server automatically when calibre starts*.
- Non-default host/port? Set `CALIBRE_MCP_SERVER_URL` (default `http://localhost:8080`).

### `calibredb` not found

The server shells out to `calibredb` and looks in the standard install locations, then
`PATH`. If Calibre is installed somewhere unusual, set `CALIBRE_MCP_CALIBREDB_PATH` to the
binary — on macOS typically `/Applications/calibre.app/Contents/MacOS/calibredb`.

### Library not found (404)

Pass the library's **display name or ID exactly as shown by `calibre_list_libraries`**.
When in doubt, leave `library` unset and the server uses the Content Server's default
library. (Internally the server resolves display names to library IDs for you; a 404 with
an explicit `library` value usually means a typo or a library the Content Server doesn't
serve.)

---

## Search

### Full-text search (`mode: fts`) returns nothing or errors

Calibre's own FTS index isn't enabled for the library. In Calibre:
**Preferences → Searching → Full text search**, enable it, and let indexing finish — it can
take a while on large libraries. Metadata search (`mode: meta`) and semantic search are
unaffected.

### In-book keyword hits all land in the table of contents

Expected: Calibre's in-book full-text hits are unranked, and front matter is keyword-dense.
For a topic or definitional question inside a book, use `calibre_semantic_search` with
`scope: book` — it ranks passages and demotes front matter.

### Semantic search: "embedding model unavailable"

The model comes from `@huggingface/transformers`, an *optional* dependency that the Claude
Desktop `.mcpb` bundle deliberately excludes. Install it for your setup:

- **Claude Desktop (.mcpb extension):** run `npm install @huggingface/transformers` inside
  the extension directory (Settings → Extensions → Advanced shows the path, typically
  `~/Library/Application Support/Claude/Claude Extensions/<id>`), or reinstall the extension.
- **npx / global npm:** reinstall *without* `--omit=optional` — e.g.
  `npm install -g calibre-mcp`, or simply rerun the npx command.
- **Dev checkout:** `pnpm add @huggingface/transformers`.

Then **restart the MCP server** — this is mandatory, not a nicety. Node caches the failed
package lookup for the whole process lifetime, so installing while the server runs never
takes effect. In Claude Desktop: toggle the extension off/on, or restart the app.

Don't want the model at all? Build a keyword-only index
(`calibre_build_index` with `keywordOnly: true`) and search with `mode: keyword` — zero ML
dependencies.

### Semantic search: "no index for this library"

Semantic search only sees books you've indexed. Run `calibre_build_index` with a `bookId`,
`ids`, or a Calibre `query` selecting the books, then search again. Re-run it after adding
books (unchanged books are skipped).

### First semantic search is extremely slow

Two one-time downloads can land on the first use: the embedding model (~118 MB) and the
cross-encoder reranker (~576 MB). `calibre_build_index` pre-downloads both — so if you
skipped straight to searching on a fresh machine, the first hybrid/vector query pays for it.
After that everything runs offline. Reranking itself also costs seconds of CPU per query;
`CALIBRE_MCP_RERANK=off` disables it (faster, noticeably less precise ranking).

### A search hit points at a book that no longer exists

`calibre_get_book` / `calibre_get_content` 404 on an id that semantic search just returned:
the book was removed (or merged away) after it was indexed, and indexing never deletes on its
own. Run `calibre_build_index` with `prune: true` (any selector — the prune runs on the whole
index) to drop the stale entries; it reports how many books and chunks it removed.

### Semantic results flagged "low confidence"

The best match scored below the confidence floor (`CALIBRE_MCP_SEMANTIC_FLOOR`,
default `0.78`) — the library probably doesn't cover the topic. The results are still shown,
just flagged; treat them as "closest we have", not an answer.

---

## Reading content

### A PDF extracts to empty text

It's a scanned/image-only PDF — no text layer. Calibre has no OCR and neither does this
server; such books can't be read or semantically indexed. (For best extraction of normal
PDFs, install poppler's `pdftotext` or Python with PyMuPDF — the server picks the best
backend available and falls back to Calibre's `ebook-convert`.) For a non-PDF format the same
message names that format instead: an EPUB/AZW3 with no extractable text is usually DRM'd or
built entirely from page images.

### "Download stalled — no data for 120s"

The Content Server stopped sending mid-transfer. The clock measures **silence**, not total
time, so a legitimately huge file (a 180 MB PDF takes minutes from cold disk) is not what
trips it. Just retry — the second attempt reads a warm page cache and is much faster. If it
keeps stalling, check whether the Calibre GUI is busy converting or rebuilding something.

### "Book too large — skipped"

`calibre_get_content` and `calibre_build_index` cap the download at
`CALIBRE_MCP_MAX_BOOK_BYTES` (default 256 MB). Note the cap applies to what the **Content
Server serves**, which can be much heavier than the file on disk (an 8 MB PDF served as
70 MB is real). Raise the cap if a book you care about gets skipped.

### "Invalid cursor"

Content cursors are opaque continuation tokens bound to one book and format — pass them back
**verbatim**, and don't reuse a cursor across books, formats, or after switching parameters.
On this error, just restart the read (plain call, or `structure: true` to grab a chapter map
and jump from there). `cursor` and `offset` are mutually exclusive — pass one or the other.

---

### The assistant describes a figure wrongly on the first try

**Symptom:** you ask for a figure, the image renders (in the viewer or the transcript), but the
first description doesn't match it — a plausible textbook diagram gets described instead of the
one on screen. Asking again ("look at the image — what does it actually show?") gives the right
answer.

**Cause:** first-pass confabulation — the model answers a figure question from prior knowledge
of similar diagrams without reading the delivered pixels. It is a model behaviour, not an
extraction failure: the bytes are there. `calibre_get_figures` already appends a "look at the
image first, name two things you can see" instruction to every fetch result, which fixes most
cases but not all.

**Fix:** re-ask with an explicit grounding cue ("name two labels visible in the figure, then
explain it"), or fetch one figure per call so the image is the last thing in context. If the
description is *empty* rather than wrong (or the viewer shows a "not extracted" placard), that
is a real extraction problem — see the PDF and vector-figure notes in `docs/TOOLS.md`.

## Writes

### Write tools don't appear at all

The master gate is off. Set `CALIBRE_MCP_ENABLE_WRITE=1` (or tick *Enable writes* in the
Desktop extension settings) and restart the server. This is deliberate — the server is
read-only by default.

### "Calibre refused the write" / Forbidden / 401 / 403

The MCP gate is on but the **Calibre side** doesn't allow local writes. Either:

- GUI Content Server: *Preferences → Sharing over the net → Advanced → allow local
  connections to make changes* (un-tick "ask for username/password" or configure a user),
  then **restart the Content Server**; or
- standalone server: run `calibre-server --enable-local-write`.

### "Nothing happened" after a preview

Preview-first is working as intended: `calibre_bulk_update` needs `preview: false`,
`calibre_remove_book` and `calibre_merge_books` need `confirm: true`, and
`calibre_extract_isbn` needs `apply: true` before anything is written. Say "apply it" /
"confirm it" and the assistant will re-run with the flag set.

### `calibre_add_book`: "path not allowed"

Import paths are whitelisted. The file must live under one of the roots in
`CALIBRE_MCP_ADD_ROOTS` (default: `~/Documents` and `~/Downloads`), checked after resolving
symlinks. Move the file there or extend the variable (path-delimiter separated list).

### A write timed out — did it happen?

Possibly yes: writes routed through the Content Server commit **server-side before the CLI
replies**, so a timeout doesn't mean failure. The server re-reads the book to verify and
tells you which case you're in; if it couldn't confirm, check with `calibre_get_book`
**before retrying** — especially for non-idempotent changes.

### A merge was interrupted midway

Safe by design: `calibre_merge_books` deletes sources **last**, so an interrupted merge
never loses data. The result says `incomplete` — re-run the exact same call and it finishes
the remaining steps.

---

## Environment quirks

- **Calibre GUI open at the same time** — fine, by design: reads go through the Content
  Server and writes are routed through it too, so nothing races the GUI's library lock.
  What you should *not* do is point other tools (raw `calibredb` without a server URL,
  SQLite browsers) at the library while the GUI runs.
- **Books added moments ago don't show up in semantic search** — the semantic index is
  yours to refresh: run `calibre_build_index` for the new books.
- **Changes made in the GUI don't show in an open cover-board widget** — the widget shows
  the results as of the search; re-run the search for fresh data.

Still stuck? Open an issue with the `calibre_ping` output:
<https://github.com/caelum29/calibre-mcp/issues>

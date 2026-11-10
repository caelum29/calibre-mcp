# Calibre MCP Server

Ubiquitous language for the calibre-mcp server — an MCP server exposing a Calibre
ebook library (catalog + single-book content) to AI agents.

## Language

### Library filtering

**Saved search**:
A Calibre-native named, reusable search expression stored in library preferences. Composable: one saved search can reference another via `search:"=Name"`. Has a safe live write path (routed `calibredb`), so it is the storage mechanism for Bundles and Exclusion markers.

**Virtual library**:
A Calibre-native named filter that scopes the entire GUI view (tag browser, counts) to a subset of books. Read-only for the server: usable as a Bundle, never created or edited by tools.
_Avoid_: VL write, virtual library management

**Bundle**:
A named topical filter — backed by a saved search or virtual library — that an agent selects to scope a search to a themed subset of the library (e.g. a "Rust" query runs inside the "Rust" bundle).
_Avoid_: collection, shelf

**Exclusion marker**:
A saved search whose name starts with `-` (e.g. `-outdated`, `-noise`). All exclusion markers are automatically subtracted from every discovery search (metadata, full-text and semantic search, and the cover board) unless the caller explicitly opts out; maintenance and write tools see the whole library. Adding a new marker takes effect immediately, without configuration.
_Avoid_: noise filter (as a term; fine as a description)

### Search ranking

**Rerank near-tie**:
Two search candidates whose cross-encoder score gap is smaller than the padding-composition shift of batched inference (0.1–0.6 logits) — under batching, their order depended on which passages shared the batch, not on the pair itself. Solo scoring dissolved the category: scores are now pair-deterministic, so any gap is a stable preference.
_Avoid_: tie (alone, when noise-band equality is meant)

**Solo scoring**:
Scoring each (query, passage) rerank pair in its own model forward (batch=1). Removes padding-neighbor dependence — the score is a pure function of the pair, so result order is deterministic under pool-composition changes. Costs ~6% latency vs batched-16 on CPU.

### Book images

**Embedded image**:
Any raster object physically stored inside a book file (PDF image object, EPUB image file). Includes covers, chapter openers, decorations, transparency masks.
_Avoid_: picture, graphic

**Figure**:
An embedded image the book's text refers to, identified by an adjacent caption (`Figure N-N.`, `Fig. N`, `Рис. N.N`, `Рисунок N`). The only image unit the server exposes to agents. `Table`/`Listing` captions are deliberately excluded — they usually label text, not raster images, and would create false caption↔image pairings.
_Avoid_: image (when the captioned unit is meant), illustration

**Caption**:
The text line anchoring a Figure (e.g. `Figure 1-1. The fundamental mental model…`, `Figure 1-1: …`, `Рис. 1.1 …`). Returned in list results so the agent can judge relevance before spending tokens on pixels.

**Vector figure**:
A Figure drawn as PDF vector commands rather than stored as a raster object — invisible to raster extraction (`pdfimages`). Served via Page render.

**Page render**:
The fallback that rasterizes the PDF page (or the vertical band above the caption) when a caption has no matching raster image. Results are labeled `source: "page-render"`.

**Caption-anchoring**:
The filter that separates Figures from other embedded images: an image qualifies only if a caption is matched to it (same PDF page, in-order; adjacent element in EPUB HTML). Uncaptioned images are excluded by default.
_Avoid_: junk filter, size filter

**Figure index**:
The stable per-(book, format) ordinal of a Figure, assigned in document order deterministically, so list results, fetch calls, and inline markers all name the same Figure.

**Inline image marker**:
A placeholder injected into extracted book text where a Figure sits (`[image #12: page 47, "caption"]`), letting the agent discover Figures while reading. Page-accurate for PDF, position-accurate for EPUB.
_Avoid_: image tag

### Public contract

**Public contract**:
The parts of the server that semantic versioning protects from 1.0 on: tool names, their inputs, their declared output fields, the Labelled lines of text results, the Stable settings, the set of error codes, the write gate with preview-first writes, and the minimum Node version. Removing or changing any of them is a breaking change; adding to them is not.
_Avoid_: API, interface

**Stable setting**:
A configuration setting whose name and meaning belong to the Public contract.

**Tuning setting**:
A configuration setting tied to the current search models (score floors, the rerank switch, the index lock timeout). Outside the Public contract: its meaning or default can change in a minor release, with a changelog note.

**Labelled line**:
A line of a tool's text result that carries one declared output field under a fixed label (the cursor line, a book id, the error code). The label and the value format belong to the Public contract.

**Prose**:
Free wording in a tool's text result or description: hints, steering sentences, notes. Outside the Public contract, so it can be reworded in any release.
_Avoid_: message format

**Channel parity**:
The guarantee that every output field a model must act on appears both in a tool's text result and in its structured result, because some clients show the model only one of the two.

**Write gate**:
The setting (`CALIBRE_MCP_ENABLE_WRITE`) that decides whether the server may change the library. It works per call: with the gate off a Write call is refused, while calls that only preview still run.
_Avoid_: read-only mode (as a term)

**Write call**:
A tool call that would change the library, as opposed to a preview or dry-run of the same tool (`confirm: true`, `apply: true`, `preview: false`).

**Annotation**:
A highlight or bookmark a reader made inside a book, stored by Calibre with the book.
_Avoid_: note (a Note is a different thing)

**Note**:
A text Calibre keeps for an item such as an author, a series or a tag. Not attached to a book.

# Calibre MCP Server

Ubiquitous language for the calibre-mcp server — an MCP server exposing a Calibre
ebook library (catalog + single-book content) to AI agents.

## Language

### Library filtering

**Saved search**:
A Calibre-native named, reusable search expression stored in library preferences. Composable: one saved search can reference another via `search:"=Name"`. Has a safe live write path (routed `calibredb`), so it is the storage mechanism for Bundles and Exclusion markers.

**Virtual library**:
A Calibre-native named filter that scopes the entire GUI view (tag browser, counts) to a subset of books. Read-only for the server — no write API exists; usable as a Bundle, never created or edited by tools.
_Avoid_: VL write, virtual library management

**Bundle**:
A named topical filter — backed by a saved search or virtual library — that an agent selects to scope a search to a themed subset of the library (e.g. a "Rust" query runs inside the "Rust" bundle).
_Avoid_: collection, shelf

**Exclusion marker**:
A saved search whose name starts with `-` (e.g. `-outdated`, `-noise`). All exclusion markers are automatically subtracted from every search unless the caller explicitly opts out. Adding a new marker takes effect immediately, without configuration.
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
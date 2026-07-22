# Calibre MCP Server

Ubiquitous language for the calibre-mcp server — an MCP server exposing a Calibre
ebook library (catalog + single-book content) to AI agents.

## Language

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
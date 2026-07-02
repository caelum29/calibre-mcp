# 📚 calibre-mcp

[![npm version](https://img.shields.io/npm/v/calibre-mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/calibre-mcp)
[![npm downloads](https://img.shields.io/npm/dm/calibre-mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/calibre-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.caelum29%2Fcalibre--mcp-6E56CF?logo=anthropic)](https://registry.modelcontextprotocol.io)
[![CI](https://github.com/caelum29/calibre-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/caelum29/calibre-mcp/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/calibre-mcp?logo=node.js&color=339933)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> **The most capable Calibre MCP server in existence** — connect Claude (or any MCP client)
> to your [Calibre](https://calibre-ebook.com) ebook library and search it by *meaning*, not
> just keywords.

Ask your AI assistant *“which of my books explain consumer-group rebalancing?”* and get the
exact chapter — across 800+ books or inside one. Curate metadata, dedupe, and safely edit
your library, all through natural language.

## ✨ Highlights

- **16 tools** covering the full surface: search, read content, browse categories, curate,
  and (opt-in) write — update metadata, bulk-edit, import, delete.
- **Semantic search** — meaning-based, hybrid vector + keyword retrieval over your whole
  library *or inside a single book*. Multilingual (English + Russian verified,
  cross-lingual queries work). No other Calibre MCP server has this.
- **Curation tools** — find duplicates with merge-safety scoring, audit metadata quality,
  and recover real metadata for books with raw filenames (`795731065.pdf` →
  *Fundamentals of Software Engineering*) via Open Library / Google Books.
- **Safe by default** — read-only unless you explicitly enable writes; destructive
  operations preview first and require confirmation; all writes route through the
  Content Server so they never race the Calibre GUI.

## 📋 Requirements

- **Calibre** with the **Content Server running** (in Calibre: *Connect/share → Start
  Content server*). Tested against Calibre 9.x; any recent version should work.
- **Node.js ≥ 22.5** for the npm/npx install (not needed for the Claude Desktop
  one-click bundle — Desktop ships its own runtime).
- Optional, for best PDF text extraction: poppler's `pdftotext`
  (`brew install poppler`) or Python 3 with PyMuPDF (`pip install pymupdf`). Without
  them the server falls back to Calibre's `ebook-convert`.

## 🚀 Quick start

### Claude Code

```sh
claude mcp add calibre -- npx -y calibre-mcp
```

### Claude Desktop (one-click)

Download the `.mcpb` bundle from the
[latest release](https://github.com/caelum29/calibre-mcp/releases/latest) and open it —
Claude Desktop installs it and prompts for settings (server URL, library, writes on/off).
No terminal needed.

> The bundle ships without the optional embeddings dependency to stay small, so the two
> semantic-search tools report themselves unavailable. Metadata and full-text search work
> fully. For semantic search, use the npx install below instead.

### Claude Desktop (JSON config)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "calibre": {
      "command": "npx",
      "args": ["-y", "calibre-mcp"]
    }
  }
}
```

### Cowork

Configure the server in Claude Desktop (either method above) — Desktop bridges local MCP
servers into Cowork automatically. No extra setup.

### First contact

Ask Claude something like *“list my calibre libraries”* or *“find books about Rust”*.
The server auto-detects your default library; if the Content Server isn’t reachable it
logs an actionable hint to stderr.

## ✍️ Enabling writes

Write tools (`calibre_update_book`, `calibre_bulk_update`, `calibre_add_book`,
`calibre_remove_book`) are **hidden by default**. Two independent switches must be on:

1. **The MCP-side gate** — set `CALIBRE_MCP_ENABLE_WRITE=1` (or tick *Enable writes* in
   the Desktop bundle settings). Without it the write tools aren’t even registered.
2. **The Calibre-side gate** — the Content Server must run with `--enable-local-write`.
   **The server embedded in the Calibre GUI is always read-only**; you have to run a
   standalone server instead:

   ```sh
   # quit the Calibre GUI first (it holds the library lock), then:
   calibre-server --enable-local-write --port 8080 "/path/to/Calibre Library"
   ```

With only the first switch on, write tools appear but Calibre refuses the write — the
error message tells you exactly that. Reads work fine against the GUI-embedded server.

Safety behavior: `calibre_bulk_update` requires an explicit book selection (`ids` or
`query` — there is no “all books” default) and previews changes until you pass
`preview: false`. `calibre_remove_book` is a dry-run until you pass `confirm: true`;
deletion removes records *and* files, permanently. `calibre_add_book` only imports files
from whitelisted folders (`CALIBRE_MCP_ADD_ROOTS`).

## 🔎 Semantic search

Meaning-based search is **opt-in** and needs two things:

1. **The embeddings dependency** — `@huggingface/transformers` is an
   `optionalDependencies` entry, so a normal `npx calibre-mcp` / `npm install` gets it
   automatically. (Only the MCPB bundle excludes it.)
2. **An index** — ask Claude to run `calibre_build_index` for the books you care about
   (by ids or a Calibre query). The first build downloads the embedding model
   (`multilingual-e5-small`, ~118 MB, one-time) into the index directory; after that
   everything runs offline. Indexing runs at roughly 100 chunks/sec on Apple Silicon.

Then `calibre_semantic_search` answers queries like *“which of my books explain consumer
group rebalancing?”* — across the library (`scope: library`, ranks books) or within one
book (`scope: book`, returns located passages). Retrieval is **hybrid** by default:
vector cosine + stemmed keyword FTS, fused with reciprocal rank fusion. Queries in one
language find passages in another (EN⇄RU verified).

**No embeddings? Keyword search still works.** `mode: keyword` uses no model *at query
time*, but it needs an index. If the embedding model isn’t installed (the default MCPB
bundle ships without it), build a **keyword-only** index — `calibre_build_index` with
`keywordOnly: true`, or it happens automatically when the model is absent — and search with
`mode: keyword`. That path has zero ML dependencies. `mode: vector` then errors actionably
and `mode: hybrid` degrades to keyword (with a note); rebuild with the model installed
(`force: true`) to add semantic ranking.

## 🧰 Tools

| Tool | Access | What it does |
|---|---|---|
| `calibre_search` | read | Find books by title/author/ISBN/tag or Calibre query syntax (`mode: meta`), or full text (`mode: fts`); `scope: book` searches inside one book |
| `calibre_get_book` | read | Full metadata, formats, and cover link for one book (id or uuid) |
| `calibre_get_content` | read | Read a book’s text as capped excerpts; walk the whole book via cursor |
| `calibre_list_categories` | read | Browse tags, authors, series, publishers, custom columns with counts |
| `calibre_list_libraries` | read | List the libraries the Content Server exposes (+ which is default) |
| `calibre_semantic_search` | read | Meaning-based search; `mode: hybrid\|vector\|keyword`, library- or book-scoped |
| `calibre_build_index` | read* | Build/refresh the local semantic index for selected books (writes only a local index file); `keywordOnly: true` builds a model-free keyword index |
| `calibre_find_duplicates` | read | Duplicate groups with merge-safety scores; `mode: compare` diffs two books |
| `calibre_quality_report` | read | Audit: missing metadata, raw-filename titles, invalid ISBNs, author-sort issues, series gaps |
| `calibre_recover_metadata` | read | Propose real metadata via Open Library → Google Books; **preview-only**, apply with `calibre_update_book` |
| `calibre_extract_isbn` | **write** | Scan a book’s own text for a valid ISBN and set its `isbn` identifier; preview-first, apply with `apply: true` |
| `calibre_update_book` | **write** | Set metadata fields on one book (incl. `#custom` columns); returns the applied diff |
| `calibre_bulk_update` | **write** | Same change across a set of books; selection required, preview-first |
| `calibre_add_book` | **write** | Import a local ebook file (path-whitelisted) |
| `calibre_remove_book` | **write, destructive** | Permanently delete books (records + files); dry-run unless confirmed |
| `calibre_ping` | read | Health check: is Calibre reachable end-to-end? |

## ⚙️ Configuration

Everything is optional — with a running Content Server on the default port, zero config
works. Environment variables (the Desktop bundle exposes the same settings as UI fields):

| Variable | Default | Purpose |
|---|---|---|
| `CALIBRE_MCP_SERVER_URL` | `http://localhost:8080` | Calibre Content Server base URL |
| `CALIBRE_MCP_LIBRARY` | *auto-detect* | Library name; empty = the server’s default library |
| `CALIBRE_MCP_ENABLE_WRITE` | off | Master write gate (`1`/`true`/`yes`) |
| `CALIBRE_MCP_CALIBREDB_PATH` | *auto-discover* | `calibredb` binary; found via standard install paths, then `PATH` |
| `CALIBRE_MCP_INDEX_DIR` | platform data dir¹ | Semantic index + embedding-model cache |
| `CALIBRE_MCP_SEMANTIC_FLOOR` | `0.78` | Cosine score below which semantic results are flagged low-confidence |
| `CALIBRE_MCP_ADD_ROOTS` | `~/Documents`, `~/Downloads` | Folders `calibre_add_book` may import from (path-delimiter separated) |

¹ macOS `~/Library/Application Support/calibre-mcp/index`, Windows
`%APPDATA%\calibre-mcp\index`, Linux `$XDG_DATA_HOME/calibre-mcp/index`.

## 🩺 Troubleshooting

- **“Calibre unreachable” / connection refused** — the Content Server isn’t running.
  In Calibre: *Connect/share → Start Content server*, or point
  `CALIBRE_MCP_SERVER_URL` at the right host/port.
- **Write refused / “Forbidden”** — the Content Server wasn’t started with
  `--enable-local-write`. See [Enabling writes](#enabling-writes); the GUI-embedded
  server can’t do it.
- **Full-text search returns nothing / errors** — Calibre’s FTS index isn’t enabled for
  the library. In Calibre: *Preferences → Searching → Full text search*, enable it, and
  let indexing finish (it can take a while on large libraries).
- **“embedding model unavailable”** — the optional `@huggingface/transformers` package
  isn’t installed (expected with the MCPB bundle). Use the npx install, or
  `npm install @huggingface/transformers` next to the server. To search without it, build a
  keyword-only index (`calibre_build_index keywordOnly=true`) and use `mode: keyword`.
- **`calibredb` not found** — install Calibre, or set `CALIBRE_MCP_CALIBREDB_PATH` to
  the binary (macOS: `/Applications/calibre.app/Contents/MacOS/calibredb`).
- **A PDF extracts to empty text** — it’s a scanned/image PDF; Calibre has no OCR, and
  neither do we.
- **Library not found (404)** — pass the library’s *display name* or *ID* as shown by
  `calibre_list_libraries`; when in doubt, leave the library unset and let the server
  pick its default.

## 🛠️ Development

```sh
pnpm install
pnpm build        # tsc → dist/
pnpm test         # vitest (unit; no network, no model download)
pnpm test:model   # gated embedding-model integration tests (~118 MB download)
pnpm inspect      # MCP Inspector against the built server
pnpm pack:mcpb    # build the Claude Desktop .mcpb bundle
```

The codebase is Clean Architecture: tool handlers, Calibre clients, and the semantic
core are SDK-free; only `src/server.ts` touches the MCP SDK. Design and research notes
live in [`docs/`](./docs).

Questions, ideas, and setups welcome in
[**Discussions**](https://github.com/caelum29/calibre-mcp/discussions); bug reports and PRs
in [Issues](https://github.com/caelum29/calibre-mcp/issues).

## 📄 License

[MIT](./LICENSE) © 2026 Artem Sorochynskyi

# TOOLS.md — Final tool surface (scope of record)

> **Status:** Tool-list LOCKED 2026-06-27 (Artem confirmed recommendations); **amended 2026-06-27**
> to add per-book *scope* to the search tools (Artem). Supersedes the RESEARCH.md §5 catalog as the
> *build* list. RESEARCH §5 = exploration; this = what we ship.
> Reconciles RESEARCH.md §5 + CAPABILITIES.md §1–4 into ≤~20 task/intent tools per DESIGN.md §2 / §9.1.
>
> **Two surfaces (the macro goal).** Every tool targets either the **catalog** (whole-library:
> search, list, update, bulk, add/remove, dedupe, quality, enrich) or a **single book** (get,
> content extraction, in-book keyword + semantic search). The search tools span both via a `scope`
> param. This catalog-vs-book duality is the build's organizing principle.

## Decisions applied (from the discussion)

1. **`convert` + `export` → LATER.** Low value for our corpus, CPU-heavy, PDF input poor.
2. **`compare_books` → a mode of `calibre_find_duplicates`**, not a separate tool.
3. **`recover_metadata` split:** it is **read/preview only**; applying recovered fields goes through
   `calibre_update_book` (clean read/write separation, no hidden writes).
4. **`quality_report` stays folded** (audit + missing-scout + reading-level) — one tool, but the
   description must name all three modes so routing stays sharp. Revisit if eval shows confusion.
5. **Semantic model = multilingual from day 1** (`paraphrase-multilingual-MiniLM`). Library is ~half
   RU; not worth shipping English-only then re-indexing. (Still measure latency on M-series — §Open.)
6. **PDF extractor = graceful-degrade.** Prefer external PyMuPDF/pdftotext; fall back to Calibre
   (`ebook-convert`, lower quality) when absent. Not a hard dependency.
7. **Per-book search is v1** (Artem, 2026-06-27). The goal wants semantic + keyword search "across
   the whole library **or** a single book." Both search tools take `scope: library|book` + `bookId?`
   — **no new tools** (stays at 14, cliff-safe). Book-scoped semantic reuses the sub-book chunk index
   (`{book_id, location}` payload, DESIGN §6), so cost is marginal. This promotes the *book-scoped*
   slice of the LATER `rag_retrieve` into v1; library-wide chunk-level RAG stays LATER.

**Net: 14 tools in v1** (6-tool headroom under the ~20 cliff; per-book scope added as params, not tools).

---

## v1 — BUILD NOW (14 tools)

Conventions: all namespaced `calibre_*`. Inputs Zod-coerced (`z.coerce.number`,
`z.preprocess(JSON.parse,…)`, id unions; never `z.coerce.boolean("false")`). Return-not-throw
`isError`. Large result sets → `resource_link[]` + `nextCursor`. Writes gated behind
`CALIBRE_MCP_WRITE`; write tools **disabled** (not rejected) when off.

### Read / search (5)

| # | Tool | R/W | Access path | Input (sketch) | Output |
|---|---|---|---|---|---|
| 1 | `calibre_search` | R | `/ajax/search` → `/cdb list\|search\|fts_search` (book scope → `fts_search --restrict-to ids:{bookId}`) | `query`, `mode?: enum(meta\|fts)`, `scope?: enum(library\|book)=library`, `bookId?` (req. when `scope=book`), `library?`, `sort?`, `cursor?`, `limit?` | library: `resource_link[]` + `nextCursor`; book: in-book snippet hits |
| 2 | `calibre_get_book` | R | `/ajax/book/{id}` | `id` (union num\|uuid), `library?` | full metadata + formats + cover link |
| 3 | `calibre_get_content` | R | EPUB `--explode-book`/`ebook-convert`; PDF PyMuPDF→Calibre fallback | `id`, `range?`/`chapter?`, `maxChars?`, `sentenceAware?`, `cursor?` | capped text excerpt (instructional-fenced) + `nextCursor` to walk the **whole book** chunk-by-chunk (full text also available as a `calibre://book/{id}` resource) |
| 4 | `calibre_list_categories` | R | `/ajax/categories` + `/cdb custom_columns` | `field?`, `valueFilter?` (regex), `library?` | values+counts / schema / stats |
| 5 | `calibre_list_libraries` | R | `/ajax/library-info` | — | `{library_map, default}` |

### Semantic — differentiator (2)

| # | Tool | R/W | Access path | Input | Output |
|---|---|---|---|---|---|
| 6 | `calibre_semantic_search` | R | local SQLite BLOB index + cosine (book scope → filter chunks by `book_id`) | `query`, `scope?: enum(library\|book)=library`, `bookId?` (req. when `scope=book`), `topK?`, `library?` | library: ranked book `resource_link[]` (+ score); book: ranked in-book passage hits (+ score + location) |
| 7 | `calibre_build_index` | W (index file) | transformers.js → SQLite; `/cdb fts_index` | `library?`, `force?`, `enableFts?` | progress + counts |

### Curation / quality — ported algorithms, clean-room (2)

| # | Tool | R/W | Access path | Input | Output |
|---|---|---|---|---|---|
| 8 | `calibre_find_duplicates` | R | `/ajax` reads + TS algo | `mode?: enum(identical\|similar\|binary\|compare)`, `ids?` (for compare) | groups + merge-safety score |
| 9 | `calibre_quality_report` | R | `/ajax` reads + TS algo | `checks?: enum[]`, `library?`, `cursor?` | issues: rule audit · missing-meta · reading-level/pages |

### Enrichment — raw-filename fix (1)

| # | Tool | R/W | Access path | Input | Output |
|---|---|---|---|---|---|
| 10 | `calibre_recover_metadata` | R (preview) | `ebook-meta` read · OpenLibrary→GoogleBooks→`fetch-ebook-metadata` | `id`/`path`, `sources?` | **proposed** fields + confidence (apply via #11) |

### Write — hardened + gated (4)

| # | Tool | R/W | Access path | Input | Output |
|---|---|---|---|---|---|
| 11 | `calibre_update_book` | W | `calibredb --with-library URL` / `/cdb set-fields` | `id`, `changes` (coerced, incl. `#custom`) | applied diff |
| 12 | `calibre_bulk_update` | W | same | `query`/`ids` (**required, no all-books default**), `changes`, `preview?=true` | preview or applied diff |
| 13 | `calibre_add_book` | W | `/cdb add` / calibredb | `path` (whitelisted), `metadata?`, `autoMerge?` | new id(s) |
| 14 | `calibre_remove_book` | W | `/cdb remove` | `ids`, `formatsOnly?`, `confirm` (required) | removed ids |

---

## LATER — deferred, with adopt-trigger

| Deferred | Why now-no | Adopt when |
|---|---|---|
| `calibre_convert_book` | low value, CPU-heavy, PDF input poor | a real conversion need appears |
| `calibre_export_book` | low value for our read-mostly use | bulk extraction/migration need |
| `rag_retrieve` — **library-wide** chunk-level (rank passages across *all* books) | book-scoped chunk retrieval now ships in v1 (`semantic_search scope=book`); cross-book passage ranking/dedup is the heavy part left | after v1 ships + extraction quality proven |
| FTS **location** resolution (PDF page / EPUB spine) | Calibre can't; we'd compute it — expensive | if "jump to page" demand is real |
| `genre_classification` (NN) | nicety, low priority | never, unless asked |
| `ebook-polish` in-place metadata embed | survives re-import but out of metadata-scope; in-place writes risky | preview-first polish pipeline designed |
| MCP **prompts** (cleanup/merge) | not core surface | after core tools stable |
| `generate_claude_config` / `tool_help` introspection | onboarding sugar | packaging/distribution phase |
| MCP-UI / structured widgets | new primitive, not load-bearing | host support + clear UX win |
| direct `/cdb/set-fields` HTTP write client | optimization; calibredb-url is correct now | when subprocess latency hurts |

---

## Open params (decide during implementation, not blocking the list)

- **RU model latency** on M-series — measure `paraphrase-multilingual-MiniLM` cold-start + per-book
  embed; if unacceptable, evaluate a smaller multilingual or quantization.
- **PDF extractor presence** — detect PyMuPDF/pdftotext at startup; log the chosen path to stderr.
- **`compare` mode shape** — confirm `find_duplicates(mode:compare, ids:[a,b])` ergonomics vs a
  dedicated verb once we see real agent usage.
- **Book-scoped result shape** — confirm in-book hits return enough location info (chapter/offset/
  page where available) to be actionable, and how `get_content`'s `cursor` granularity pairs with them.
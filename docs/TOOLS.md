# TOOLS.md — Final tool surface (scope of record)

> **Status:** Tool-list LOCKED 2026-06-27 (Artem confirmed recommendations); **amended 2026-06-27**
> to add per-book *scope* to the search tools (Artem). Supersedes the RESEARCH.md §5 catalog as the
> *build* list. RESEARCH §5 = exploration; this = what we ship.
> Reconciles RESEARCH.md §5 + CAPABILITIES.md §1–4 into ≤~20 task/intent tools per DESIGN.md §2 / §9.1.
>
> **✅ v1 BUILD COMPLETE (2026-07-01).** All 14 tools built, tested, and merged to `main`; the write
> path is live-verified. Per-increment build log + live-verification notes live in `CLAUDE.md` §Status
> (increments 1–7). The tables below are annotated with what actually shipped vs what deferred to LATER.
>
> **➕ Post-v1 (2026-07-02): `calibre_extract_isbn` (#15).** The kiwidude Extract-ISBN capability — scan a
> book's own text for a valid ISBN and stamp it into `identifiers:isbn` (gated write, preview-first,
> merges into existing identifiers). Reuses the `scanForIsbn` text-scan shared with `recover_metadata`.
> **Now 15 tools** (still cliff-safe under ~20).
>
> **➕ v0.4.0 (2026-07-18): MCP Apps UI layer (D-017).** `calibre_search`/`calibre_semantic_search`
> results render as an in-chat **cover board** and `calibre_get_book` as a **book card** on MCP Apps
> hosts (always-attach `_meta.ui`, issue #24); non-Apps hosts see the exact same text +
> `resource_link[]` output. `calibre_get_book` gains `include_cover?` (default false — opt-in
> `ImageContent` when the model must see the cover) and its `structuredContent` gains
> `serverUrl`/`libraryId` (widget URL plumbing). One widget-internal tool, **`calibre_board_data`
> (#16)**, carries `_meta.ui.visibility ["app"]` — hosts that honor MCP Apps hide it from the model,
> so the **model-facing surface stays 15 tools** (+ `calibre_ping`); it only serves the board's
> data re-pull (Claude Desktop strips `structuredContent` from the tool-result notification).
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
5. **Semantic model = multilingual from day 1** (`multilingual-e5-small`; swapped from
   `paraphrase-multilingual-MiniLM` on 2026-06-28). Library is ~half RU; not worth shipping
   English-only then re-indexing. e5-small is same 384-dim/footprint but has a 512-token window
   (vs MiniLM's 128, which truncates most technical paragraphs) and a verified RU retrieval score;
   requires `query:`/`passage:` prefixes. See `docs/SEMANTIC-SEARCH.md`. (Still measure latency — §Open.)
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
`CALIBRE_MCP_ENABLE_WRITE`; write tools **disabled** (not rejected) when off.

### Read / search (5)

| # | Tool | R/W | Access path | Input (sketch) | Output |
|---|---|---|---|---|---|
| 1 | `calibre_search` | R | `/ajax/search` → `/cdb list\|search\|fts_search` (book scope → `fts_search --restrict-to ids:{bookId}`) | `query`, `mode?: enum(meta\|fts)`, `scope?: enum(library\|book)=library`, `bookId?` (req. when `scope=book`), `library?`, `sort?`, `cursor?`, `limit?` | library: `resource_link[]` + `nextCursor`; book: in-book snippet hits (short, unranked — for definitional/topic queries the description + an in-band tip steer to `calibre_semantic_search scope=book`) |
| 2 | `calibre_get_book` | R | `/ajax/book/{id}` (+ `/get/thumb` when `include_cover`) | `id` (union num\|uuid), `library?`, `include_cover?=false` | full metadata + formats + cover link (+ `ImageContent` cover opt-in); renders as a book card on Apps hosts (D-017) |
| 3 | `calibre_get_content` | R | EPUB `--explode-book`/`ebook-convert`; PDF PyMuPDF→Calibre fallback | `id`, `range?`/`chapter?`, `maxChars?`, `sentenceAware?`, `cursor?`, `offset?` (char position, for search-passage jumps — #28) | capped text excerpt (instructional-fenced) + `nextCursor` to walk the **whole book** chunk-by-chunk (full text also available as a `calibre://book/{id}` resource) |
| 4 | `calibre_list_categories` | R | `/ajax/categories` + `/cdb custom_columns` | `field?`, `valueFilter?` (regex, case-insensitive; leading `(?i)`-style inline flags accepted), `library?` | values+counts / schema / stats |
| 5 | `calibre_list_libraries` | R | `/ajax/library-info` | — | `{library_map, default}` |

### Semantic — differentiator (2)

| # | Tool | R/W | Access path | Input | Output |
|---|---|---|---|---|---|
| 6 | `calibre_semantic_search` | R | local SQLite BLOB index + cosine (book scope → filter chunks by `book_id`) | `query`, `scope?: enum(library\|book)=library`, `bookId?` (req. when `scope=book`), `topK?`, `library?` | library: ranked book `resource_link[]` (+ score); book: ranked in-book passage hits (+ score + location); front-matter chunks (TOC/praise/foreword, flagged at index time) are stable-partitioned below body matches (D-016) |
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

### Write — hardened + gated (6)

All route through `calibredb --with-library <serverUrl>/#<libId>` and **must resolve the library
**ID** (not the display name) first — the display form 404s (locked pattern, CLAUDE.md §Status). Gated
by `CALIBRE_MCP_ENABLE_WRITE`; disabled (not rejected) when off; server needs `--enable-local-write`.
**Destructive/bulk confirmation is in-band** (`preview`/`confirm` params) — handlers stay SDK-free, so
true MCP `elicitation/create` is deferred to LATER (DESIGN §4).

| # | Tool | R/W | Access path (shipped) | Input (shipped) | Output |
|---|---|---|---|---|---|
| 11 | `calibre_update_book` | W | `calibredb set_metadata` via server URL | `id`, `changes` (coerced, incl. `#custom`), `library?` | applied diff + no-op flag |
| 12 | `calibre_bulk_update` | W | `set_metadata` looped per id (cap `MAX_BULK=500`) | `changes`, `ids?`/`query?` (**one required, no all-books default**), `preview?=true`, `library?` | preview diff (no write) or applied/failed ids |
| 13 | `calibre_add_book` | W | `calibredb add <path>` via server URL | `path` (whitelisted to `config.addRoots`), `library?` | new id(s) |
| 14 | `calibre_remove_book` | W | `calibredb remove <ids>` via server URL | `ids` (required), `confirm?=false` (dry-run unless true), `library?` | dry-run list or removed ids |
| 15 | `calibre_extract_isbn` | W | scan book text (reuses `scanForIsbn`) → `set_metadata identifiers:isbn` via server URL | `id`, `apply?=false` (preview unless true), `library?` | found ISBN + current + `changed`; merges into existing identifiers |
| 16 | `calibre_merge_books` | W | `/get` download → `add_format --dont-replace` → one `set_metadata` → `remove` (delete ALWAYS last), all via server URL (spec #50) | `targetId`, `sourceIds` (must exclude target), `mode?=merge` (`merge\|safe\|formatsOnly`), `confirm?=false` (dry-run plan unless true), `library?` | dry-run plan (survivor, format dispositions, metadata diff, trash list) or step ledger; `incomplete` + re-run steer when partially committed (#33) |

> **Deferred write sub-features (LATER, additive):** `add_book` `metadata?`/`autoMerge?`/cover +
> `add --duplicates`; `remove_book` `formatsOnly?` (remove a format, keep the record) + trash-vs-permanent
> flag; `bulk_update` `/cdb` HTTP batch (vs the per-id loop); real MCP elicitation for destructive writes.

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

## Open params — RESOLVED during implementation

- **RU model latency** on M-series — ✅ measured: `multilingual-e5-small` cold-start ~66s (one-time HF
  download, then cached + offline), per-book embed ~4.6s (book 658, 102 chunks). Recall verified
  cross-lingual (EN query → RU section at cosine 0.872). Kept e5-small; the `gte-multilingual-base`
  escape hatch stays documented in `docs/SEMANTIC-SEARCH.md` §1 but wasn't needed.
- **PDF extractor presence** — ✅ startup backend detection (pdftotext > PyMuPDF bridge > ebook-convert),
  logged to stderr. `poppler`'s `pdftotext` installed → preferred, verified live.
- **`compare` mode shape** — ✅ shipped as `find_duplicates(mode:compare, ids:[…≥2])` → field-by-field
  diff + `keep` recommendation. Fine in practice; no dedicated verb needed. Diffed fields include
  `languages` (#51) — a differing language means a *translation*, so it caps `mergeSafety` at 0.3
  and emits a REVIEW warning instead of reading as a clean duplicate.
- **Book-scoped result shape** — ✅ in-book hits return char-located passages (`{book_id, location}`).
  PDF page / EPUB spine locations remain LATER (Calibre can't supply them; we'd compute).
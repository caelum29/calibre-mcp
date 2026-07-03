# EXTRA-MCP-ANALYSIS — 17 field servers, what to borrow

**Date:** 2026-07-03. **Method:** 17 GitHub repos (zips in `extra/`) analyzed by 17 parallel agents,
one per repo, each judging *deltas* against our shipped 15-tool surface (v0.1.5). Extracted sources
lived in the session scratchpad; raw per-repo reports were spot-checked against the code (file paths
verified for the top claims: Xpresi `tools/{epub,diagnose}.py`, sandraschi `fts_location_resolver.py`,
book-stack `policy.py`, lyceum `url-to-epub.ts`/`epub-inject.ts`, CAS_NLP `genre_classifier.py`,
FaceDeer `library_logic.py`).

**License legend:** ✅ permissive (MIT/Apache/BSD — code reuse OK) · ⚠️ permissive-declared but no
LICENSE file (treat idea-level) · 🚫 GPL or no license (algorithm/idea only, per CLAUDE.md clean-room rules).

---

## 1. Comparison table

**Sources = local zips in [`extra/`](../extra/).** To pull examples from one:
`unzip -o extra/<zip> -d /tmp/<name>` — all file paths cited in this doc are relative to the archive
root (zips contain a single `<name>-main/`-style top folder).

| Source zip | Actual project | Stack | Calibre interface | Tools | License | Verdict |
|---|---|---|---|---|---|---|
| [`calibre-mcp-master.zip`](../extra/calibre-mcp-master.zip) | **Xpresi/calibre-mcp** v0.2.0 | Python, mcp[cli] | SQLite ro reads + calibredb writes (+direct-SQLite bulk) | ~48 | MIT ✅ | **strong** |
| [`calibremcp-master.zip`](../extra/calibremcp-master.zip) | **sandraschi/calibremcp** v1.8.6 | Python, FastMCP, LanceDB | direct SQLite + calibredb + LanceDB RAG | 21 portmanteau (+beta) | MIT ⚠️ (no file) | **strong** |
| [`calibre_full_mcp_server-main.zip`](../extra/calibre_full_mcp_server-main.zip) | **FaceDeer** (already studied) | Python, FastMCP | `calibre-debug` worker (internal `new_api`) | ≤18 gated | MIT ✅ | **strong** |
| [`book-stack-mcp-main.zip`](../extra/book-stack-mcp-main.zip) | book-stack-mcp | Python 3.12, FastMCP | SQLite (Calibre-Web `app.db`+`metadata.db`) + LazyLibrarian/AA/OpenLibrary | 35 | MIT ✅ | **strong** (adjacent domain) |
| [`lyceum-main.zip`](../extra/lyceum-main.zip) | Lyceum — self-hosted library app w/ MCP | TS/Node 24, SDK 1.27, HTTP+OAuth | own SQLite; Calibre only as import source | 28 | BSD-3 ✅ | **strong** (delivery/ingestion) |
| [`CAS_NLP_Module3_Calibre_Project-main.zip`](../extra/CAS_NLP_Module3_Calibre_Project-main.zip) | alexchilton course project | Python, fastmcp | calibredb + SQLite ro + fetch-ebook-metadata | 24 | Apache-2.0 ✅ | **strong** (genre ML) |
| [`calibre-manager-mcp-main.zip`](../extra/calibre-manager-mcp-main.zip) | Erick Navarro | TS, SDK 1.12 | calibredb/ebook-convert/fetch-ebook-metadata CLIs | 17 | MIT ✅ | minor |
| [`access-calibre-main.zip`](../extra/access-calibre-main.zip) | kybernetikos | JS (CJS), SDK 1.25 | Content Server HTTP only, read-only | 10 + 1 prompt | MIT ✅ | minor |
| [`mcp-neolibrarian-main.zip`](../extra/mcp-neolibrarian-main.zip) | pshap | Python 3.12, FastMCP | direct SQLite (metadata + FTS db) + calibredb fts | 18 + 2 resources | MIT ✅ | minor |
| [`calibre-library-mcp-main.zip`](../extra/calibre-library-mcp-main.zip) | (remote homelab) | Python, FastMCP | **SSH→docker exec→SQLite ro** | 7 | MIT ✅ | minor |
| [`calibre-web-mcp-main.zip`](../extra/calibre-web-mcp-main.zip) | acato — targets **Calibre-Web** | Python, FastMCP 2 | OPDS reads + CW HTML/CSRF writes | 10 | Apache-2.0 ✅ | minor |
| [`calibre_mcp_server-main.zip`](../extra/calibre_mcp_server-main.zip) | ajtudela v1.2.0 | Python, FastMCP 2.12 | direct SQLite, read-only | 10 | Apache-2.0 ✅ | minor |
| [`calibre-rag-mcp-nodejs-master.zip`](../extra/calibre-rag-mcp-nodejs-master.zip) | (Windows RAG experiment) | Node, **no SDK** (hand-rolled JSON-RPC) | calibredb + filesystem | 7 (1 stub) | Apache ⚠️ (no file) | minor |
| [`converter-mcp-main.zip`](../extra/converter-mcp-main.zip) | Gabriele Zigurella — file converter | Python, FastMCP | ebook-convert/ebook-meta CLIs only (no library) | 3 | MIT ✅ | minor |
| [`calibre-mcp-server-main.zip`](../extra/calibre-mcp-server-main.zip) | iain247 | Python 3.12, mcp SDK, HTTP/SSE | calibredb + direct EPUB zip reads | 6 | 🚫 none | minor |
| [`mcp-server-main.zip`](../extra/mcp-server-main.zip) | Miguel0888 — German research agent + GUI plugin | Python, fastmcp | direct SQLite ro | 2 | 🚫 GPL-3.0 | minor |
| [`calibre-mcp-main.zip`](../extra/calibre-mcp-main.zip) | nicolas-moreira — **name collision**: Rust AI-agent memory server, zero Calibre relation | Rust, rmcp | n/a | 14 | MIT | **nothing new** |

Field patterns worth noting: **10 of 16 real Calibre servers read `metadata.db` via direct SQLite** — the
GUI-race path we rejected; several mitigate with `file:...?mode=ro` (a trick worth knowing), Xpresi even
re-registers Calibre's `title_sort()`/`uuid4()` trigger functions for direct writes (clever, still the race —
do NOT copy). Most servers have the exact `-32602` string-args vulnerability we hardened against; only two
defend: lyceum uses **our identical Zod-coerce pattern**, Xpresi widens the JSON Schema itself
(`anyOf:[{type},{type:"string"}]` on every prop — an alternative defense worth remembering). Our
Content-Server-reads + `calibredb --with-library URL` writes remains the safest architecture in the field,
and nobody else has hybrid retrieval (RRF/stemming/multilingual) — our headline is uncontested.

---

## 2. Ideas to borrow — ranked

Each idea names its source project — find the matching zip link in the §1 table; the cited file paths
(e.g. `tools/epub.py`, `src/client.js:296`) are inside that archive.

### Tier 1 — high value, fits the roadmap now

1. **FTS/semantic hit → reader location resolver (PDF page + EPUB spine)** — *our deferred item, now with
   4 working references.* sandraschi `utils/fts_location_resolver.py` (162 lines: PyMuPDF `page.search_for`
   → 1-based page; ebooklib spine href/order; retries with first ~50 chars when the full phrase fails on PDF
   line breaks; emits `ebook-viewer --open-at "search:<phrase>"` hints) ⚠️ idea-level. EPUB spine/TOC parse
   also in access-calibre (`src/client.js:296-346`, OPF→NCX/Nav, MIT ✅), iain247 (`server.py:80-119`,
   NCX→OPF fallback, 🚫), Xpresi `tools/epub.py` (navMap-scoped, MIT ✅). → Extends `calibre_get_content`,
   `calibre_search scope=book`, semantic chunk payloads.

2. **Library integrity checks for `calibre_quality_report`** — two independent sources, both MIT ✅,
   read-only, no GUI race:
   - Xpresi `tools/diagnose.py`: `find_ghost_books` (DB rows whose files are missing), `find_orphan_files`
     (files with no DB record), `find_orphan_links`/`find_orphaned_metadata` (dangling FK rows),
     `verify_file_integrity` (case-aware).
   - calibre-library-mcp (`server.py:174-186`): **FTS index-health** from `books_text.err_msg` /
     `files_with_text` / `text_size` — flags books Calibre *tried* to index but failed (scanned PDFs, DRM).
     The "which books have no searchable text" gap.

3. **Convert + export tools (promote from LATER — recipes are ready)** — calibre-manager-mcp MIT ✅:
   `convert_book` = `ebook-convert` → temp → `calibredb add_format` back onto the *same* book, source-format
   preference `epub>azw3>mobi>fb2>pdf` (`index.ts:274-306`); `export_books` = `calibredb export --to-dir
   --single-dir` (`index.ts:308-325`). converter-mcp MIT ✅ adds the full `ebook-convert` arg builder
   (PDF paper-size/margins/fonts, title/author override, `ebook.py:167`) + disk-space precheck + collision
   auto-rename. Xpresi adds `embed_metadata` (`calibredb embed_metadata` — stamp DB metadata into the file)
   and lyceum `epub-inject.ts` (BSD ✅) handles both OPF2/OPF3 cover conventions for in-file stamping.

4. **`fetch-ebook-metadata` + `ebook-meta` engines for `calibre_recover_metadata`** — *our own deferred
   item, twice-validated.* calibre-manager-mcp (`index.ts:369-407`, MIT ✅): `fetch-ebook-metadata --opf`
   + `--cover`, applied via `calibredb set_metadata <id> file.opf` — adds Calibre's own multi-source
   aggregator (Amazon/Goodreads/Google → ASIN coverage we lack) + cover download. converter-mcp
   (`ebook.py:207`, MIT ✅): `ebook-meta <file>` parse — offline, no network. Keep our preview-first contract.

5. **Faceting + schema introspection + search-grammar help (FaceDeer, MIT ✅)** — three model-facing
   capabilities we lack:
   - `get_field_values` (`{value: count}` for any field incl. `#custom`, regex filter + pagination) — fold
     into `calibre_list_categories` as a mode, powers agent-built facets.
   - `get_library_schema` (datatype/description/allowed_values per column, custom-column descriptions as
     agent hints) + their **schema-driven datatype validation table** (rating clamp, series `"Name [2]"` →
     name+`_index` w/ conflict detection, ternary bool) to strengthen `update_book`/`bulk_update`.
   - `src/skills/*.md` — 6 search-grammar docs served as MCP resources. MIT-copyable; a cheap
     query-accuracy lever (`field:true/false`, identifier extended syntax, series-index relational ops).

### Tier 2 — real differentiators to consider (new capabilities)

6. **ML genre classification** (CAS_NLP `genre_classifier.py` + `tools/genre_classification.py`,
   Apache ✅ but no trained model shipped) — multi-label transformer over title+description, predict /
   batch / predict-and-tag (preview→apply) + confidence. **Nobody in the field has this**; fits our
   preview-first write pattern and the ≤20-tool budget as one `calibre_classify_genre`. Cost: we'd need a
   multilingual model — treat as idea+architecture.

7. **Author-variant clustering + "keep this copy because X"** (Xpresi MIT ✅) — `find_author_variants`
   (normalize-group + surname-prefix index so initials only compare within a bucket, confidence 0.5–0.95)
   and `suggest_dedup_resolution` (keep scorer: `format>cover>comments>size>recency` with human-readable
   reasons). Plus `find_compilation_coverage` — matching individual titles against omnibus TOCs, so
   merge-safety won't recommend deleting a book that lives inside a compilation. → Extends
   `calibre_find_duplicates` / `quality_report`.

8. **Confirm-token gating + operational hardening** (book-stack-mcp `policy.py`, MIT ✅) — destructive
   tools return a plan + single-use, TTL'd, **payload-fingerprint-bound** `confirm_token`; execute on the
   second call. Threshold-driven (gate only ≥N items). Plus per-tool hourly caps (runaway-agent circuit
   breaker) and a global `--dry-run` ring buffer with a `dryrun_log` tool. A cleaner MCP-native middle path
   than our `preview`/`confirm` bools — the elicitation stand-in we deferred.

9. **`scope=collection` for semantic search** (calibre-rag-mcp-nodejs "projects", ⚠️ idea) — user-curated
   book-ID sets as named, isolated index scopes ("reading list / research bundle"). A third scope beyond
   our `library|book`; cheap on top of our store. Same repo validates **structure-aware chunk boundaries**
   (break on chapter/section headers, don't split LaTeX/tables, `has_formulas`/`has_tables` chunk flags) for
   our deferred token-chunking work.

10. **Viewer integration** (sandraschi, idea) — `open_book` shelling `ebook-viewer`, with
    `--open-at "search:<phrase>"` so a semantic/FTS hit is one click from the reader. Cheap, high demo
    value, pairs with #1.

11. **MCP prompts** — we expose zero. sandraschi ships ~15 (`reading_recommendations`, `metadata_cleanup`,
    `duplicate_detection`…), access-calibre ships `analyze_book` (guided multi-tool investigation). Write
    3–4 of our own mapping to existing tools (metadata cleanup, dedupe sweep, recover raw filenames) —
    near-zero cost, discoverability win.

### Tier 3 — small wins & patterns

- **Cover handling**: fetch via `/get/cover/{id}/{lib}` (access-calibre MIT ✅); `set_cover` from URL (lyceum BSD ✅).
- **Accent/diacritic folding that preserves ñ/ç** (ajtudela `_normalize_text`, Apache ✅, ~40 lines) — for
  `find_duplicates`/`quality_report` keys and `recover_metadata` title matching.
- **`sort=random` + `sample: beginning|end|middle|overview`** modes (neolibrarian MIT ✅) — discovery +
  "representative sample for summarization" on existing tools, no new tools.
- **Multi-snippet-with-context output shape** for in-book keyword hits (neolibrarian) — several located
  matches per book; our FTS5 already has the positions. FaceDeer's **multi-term proximity window ranker**
  (`logic/text_search.py`, MIT ✅) is the non-FTS variant.
- **`ctx.report_progress`** (converter-mcp pattern) — wire into `calibre_build_index` for long embedding runs.
- **Clobber-guard on partial edits** (calibre-web-mcp, Apache ✅) — re-read siblings, refuse blank writes;
  we already do this for identifiers, adopt as an explicit rule.
- **Error-message enrichment** (calibre-manager-mcp `calibre.ts:76-99`, MIT ✅) — classify ENOENT/timeout/
  `another calibre is running` into actionable hints.
- **Live-lock stdout filter** (rag-nodejs) — strip calibredb's "Another calibre program is running" warning.
- **`library_stats`** (top-N authors, by-decade histogram) + `recent_additions` (book-stack) — light analytics.
- **Cross-language keyword expansion EN↔RU** for the keyword half of hybrid search (Miguel0888 🚫 GPL —
  idea only): LLM/dictionary translation of technical terms; embeddings already cross-lingual, stemmed FTS is not.
- **Reading-status (Reading/Finished/DNF/TBR) + author-follow/new-release watch** (book-stack MIT ✅) —
  genuinely new domain; ours would live in a tag/custom-column + index-dir sidecar. Niche — only if Artem wants it.
- **`create_book_from_url`** (lyceum BSD ✅ — `defuddle` article → hand-built EPUB2 with the
  mimetype-first-zip-entry gotcha solved, SSRF guard included) and **signed-URL browser-upload offload** —
  delivery/ingestion ideas if we ever go beyond local paths.
- **OCR fallback for scanned PDFs** (rag-nodejs: Tesseract when extraction <50 chars; sandraschi:
  GOT-OCR2.0/FineReader provider abstraction) — the one extraction class we lack entirely; heavy deps →
  LATER, behind the extractor backend chain.
- **README notes**: Windows Store-Python breaks GUI-spawned MCP children (calibre-web-mcp); npm **namespace
  collision** — `nicolas-moreira/calibre-mcp` (Rust memory server) shares our name; watch discoverability.

---

## 3. Already covered / nothing new

- **Our core is uncontested**: no server in the field has hybrid retrieval (vector+FTS5+RRF), multilingual
  embeddings, RU stemming, merge-safety-scored dedupe, preview-first metadata recovery, or ISBN text-scan
  with identifier-merge. Semantic search elsewhere is metadata-only pickles (CAS_NLP), single-vector
  LanceDB (sandraschi), or English-only MiniLM (rag-nodejs).
- **Write safety**: nobody else combines env-gating + Zod coercion + libId resolution + preview-first +
  path whitelist. Several servers write ungated with no coercion.
- **calibre-mcp-main (nicolas-moreira)** — name collision, different domain entirely; nothing applicable.
- **Deliberate non-goals confirmed**: direct-SQLite data paths (10 servers), Calibre-Web shelf surfaces
  (calibre-web-mcp, book-stack), acquisition/download tooling (book-stack aa.*/LazyLibrarian — legally
  dubious for AA), remote HTTP transports (multiple; our stdio-only decision stands, patterns noted in
  DISTRIBUTION-adjacent ideas above).

---

## 4. Suggested next-increment shortlist

If picking one increment from this analysis (all ≤20-tool safe — modes/params, not new tools, except the
convert/export pair and prompts):

1. `quality_report` += ghost-books / orphan-files / FTS-index-health checks (Tier 1 #2) — read-only, quick.
2. FTS→location resolver (PDF page + EPUB spine) into `get_content`/`search`/semantic payloads (Tier 1 #1).
3. `calibre_convert_book` + `calibre_export_books` from the ready MIT recipes (Tier 1 #3) → 17 tools.
4. `recover_metadata` += `fetch-ebook-metadata`/`ebook-meta` engines + cover (Tier 1 #4).
5. `list_categories` += field-value faceting; ship search-grammar MCP resources (Tier 1 #5).

---

## 5. Appendix — full tool inventories per server

### Xpresi/calibre-mcp (`calibre-mcp-master.zip`) — ~48 tools
Handlers in `src/calibre_mcp/tools/{query,diagnose,write,bulk,report,epub,analyze}.py`; registered in `server.py`.
- **Query (read):** `get_server_info`, `library_stats`, `search_books`, `get_book_details`, `raw_sql_query` (arbitrary SELECT), `list_authors`, `list_series`, `list_tags`, `list_publishers`, `get_epub_toc`
- **Diagnose (read):** `find_duplicate_books` (exact/isbn/fuzzy), `find_author_variants`, `find_series_issues`, `find_uppercase_items`, `find_missing_metadata`, `find_orphan_links`, `find_orphan_files`, `find_ghost_books`, `find_orphaned_metadata`, `verify_file_integrity`, `check_library`
- **Write:** `remove_books`, `set_book_metadata`, `bulk_set_metadata`, `merge_authors`, `rename_author`, `normalize_uppercase`, `fix_series_numbers`, `fix_author_sort`, `fix_book_paths`, `cleanup_orphan_links`, `fetch_metadata` (OpenLibrary/GoogleBooks), `embed_metadata`, `backup_database`, `backup_metadata_opf`, `vacuum_database`
- **Reporting:** `generate_report`, `compare_snapshots`, `export_catalog`, `fts_index`, `fts_search`
- **Workflow composites:** `analyze_author`, `find_compilation_coverage`, `suggest_dedup_resolution`, `next_author_to_process`, `regenerate_pending_worklist` (last two are the author's personal Spanish-worklist tools)
- No MCP resources/prompts. Every destructive tool defaults `dry_run=true`.

### sandraschi/calibremcp (`calibremcp-master.zip`) — 21 portmanteau tools (+beta) + ~15 prompts
Each tool takes an `operation`/`action` param (their "portmanteau" consolidation pattern).
- `query_books` (search/list/by_author/by_series), `manage_libraries` (list/switch/stats/discover), `calibre_metadata_search` (LanceDB metadata RAG), `search_fulltext` (FTS5 + **`resolve_locations`** → PDF page / EPUB spine), `calibre_metadata_index_build`, `calibre_rag` (chunk-level RAG), `rag_index_build`, `rag_retrieve`, `manage_books` (add/get/details/update/delete), `manage_metadata` (update/organize_tags/show), `manage_authors`, `manage_series`, `manage_tags` (incl. merge), `manage_comments`, `manage_publishers`, `manage_viewer` (**open/close in system viewer**, open_random), `manage_files` (read/write/**convert**), `manage_analysis` (library health), `manage_library_operations` (series fixes/merges), `export_books`, `calibre_metadata_export_json`, `calibre_ocr` (FineReader / GOT-OCR2.0), `show_book_prefab_card` + `show_libraries_prefab_card` (**MCP Apps rich cards**)
- **Beta** (`CALIBRE_BETA_TOOLS=true`): `manage_import` (Gutenberg/arXiv/Anna's Archive), `manage_descriptions`, `manage_user_comments`, `manage_extended_metadata`, `manage_times`, `manage_content_sync`, `manage_ai_operations` (Ollama), `manage_bulk_operations`, `agentic_calibre_workflow`, reading-analytics, smart-collections, social-features
- **MCP prompts (~15, `prompts.py`):** `reading_recommendations`, `metadata_cleanup`, `duplicate_detection`, `format_conversion`, `japanese_books`, `it_books`, `unread_priority`, etc.

### FaceDeer/calibre_full_mcp_server (`calibre_full_mcp_server-main.zip`) — up to 18 tools, permission-gated
- **Always on:** `search_books`, `get_book_details`, `get_book_content`, `search_book_content`, `fts_search`, `get_library_schema`, `get_field_values`
- **If `write`:** `update_book`, `bulk_update_metadata` · **`convert`:** `convert_book` · **`delete`:** `delete_book` · **`import`:** `list_importable_files`, `add_book` · **`export`:** `list_exportable_files`, `export_book`
- **Fallback tools** (when `expose_resources_via_tools=true`): `list_libraries`, `list_help_topics`, `get_help_topic`
- **MCP resources:** `calibre://libraries`, `calibre://help/list`, `calibre://help/{topic}` — serving the 6 search-grammar docs from `src/skills/*.md`

### book-stack-mcp (`book-stack-mcp-main.zip`) — 35 tools in 6 dotted namespaces
- **`calibre.*` (17):** `search_library`, `list_shelves`, `create_shelf`, `add_book_to_shelf`, `remove_book_from_shelf`, `list_shelf_contents`, `kobo_sync_status`, `set_shelf_kobo_sync`, `find_book_in_shelves`, `recent_library_additions`, `library_stats`, `rename_shelf`, `delete_shelf`, `delete_book_from_library`, `clear_shelf`, `merge_shelves`, `bulk_add_to_shelf`
- **`lazylibrarian.*` (5):** `search_books`, `download_book`, `status`, `queue`, `list_all_books`
- **`aa.*` (2):** `discover`, `direct_download`
- **`reading.*` (2):** `set_reading_status`, `reading_status` (Reading/Finished/DNF/TBR)
- **`follow.*` (4):** `follow_author`, `unfollow_author`, `list_followed_authors`, `author_works`
- **`stack.*` (5):** `dryrun_log`, `report_issue`, `health`, `find_anywhere`, `queue_status_all`
- No resources/prompts; rich server `instructions` field instead.

### lyceum (`lyceum-main.zip`) — 28 tools (all in `src/mcp.ts`)
`list_books`, `get_book` (w/ injected `reading_progress`), `search_books`, `list_authors`, `list_tags`, `list_series`, `list_books_by_series`, `list_books_by_author`, `get_download_link` (signed URL, 5-min TTL), `get_upload_link`, `get_add_format_link`, `get_view_link`, `set_metadata`, `mark_read`, `set_cover` (from URL), `remove_book`, `remove_format`, `convert_book`, `fetch_metadata` (Google Books), `get_opds_settings`, `set_opds_settings`, `get_kosync_settings`, `set_kosync_settings`, `add_device`, `verify_device`, `list_devices`, `remove_device`, `send_to_device`, `create_book_from_url` (article→EPUB→library), `send_url_to_device`. No resources/prompts.

### CAS_NLP / alexchilton (`CAS_NLP_Module3_Calibre_Project-main.zip`) — 24 tools
- **calibredb verbs:** `calibre_list_books`, `calibre_add_book`, `calibre_remove_book`, `calibre_set_book_metadata`, `calibre_convert_book`, `calibre_search_library`, `calibre_bulk_update_comments`
- **Read/analyze:** `calibre_get_book_details`, `calibre_find_duplicates`, `calibre_semantic_search`, `calibre_sql` (raw read-only SQL w/ schema-crib docstring)
- **ISBN:** `calibre_isbn_extract_from_text`, `calibre_isbn_extract_from_file`, `calibre_isbn_validate`, `calibre_isbn_find_books`, `calibre_isbn_get_book_isbn`
- **Enrichment:** `calibre_fetch_metadata_by_identifier`, `calibre_fetch_metadata_by_title`, `calibre_enrich_book_metadata`, `calibre_apply_metadata_updates`, `calibre_find_books_needing_enrichment`, `calibre_batch_enrich_books`
- **Genre ML:** `calibre_predict_genre`, `calibre_batch_predict_genres`, `calibre_predict_and_tag_genre`
- No real resources/prompts (`mcp_prompts_resource.py` is unrelated tutorial boilerplate).

### calibre-manager-mcp / Erick Navarro (`calibre-manager-mcp-main.zip`) — 17 tools
`health_check`, `search_books`, `get_book_metadata`, `list_categories`, `library_stats`, `set_metadata`, `add_tags`, `remove_tags`, `rename_tag` (library-wide), `bulk_set_metadata`, `add_book` (+`--automerge`), `remove_books` (confirm + `--permanent`), `convert_book` (→`add_format` back onto same book), `export_books` (`--to-dir --single-dir`), `find_duplicates`, `find_books_missing_metadata`, `fetch_online_metadata` (`fetch-ebook-metadata --opf` + cover). No resources/prompts.

### access-calibre / kybernetikos (`access-calibre-main.zip`) — 10 tools + 1 prompt
`list_libraries`, `search_books` (across all libraries), `list_books`, `list_chapters` (EPUB spine + TOC titles), `get_chapter_content` (HTML, windowed), `get_chapter_content_markdown`, `render_chapter_page` (→PNG for vision models), `get_book_cover`, `search_in_book` (literal substring, dual HTML/Markdown offsets), `get_epub_file` (any in-container asset). **Prompt:** `analyze_book` (guided multi-tool investigation). No resources.

### mcp-neolibrarian / pshap (`mcp-neolibrarian-main.zip`) — 18 tools + 2 resources
`ping`, `get_total_books`, `search_by_author`, `search_by_title`, `get_book_details`, `get_book_formats`, `get_book_content` (format-priority TXT>EPUB>PDF>MOBI), `get_book_sample` (**beginning/end/middle/overview**), `analyze_book_content` (task-typed: summary/themes/characters/quotes), `search_content` (in-book substring, chapter-aware), `search_library` (calibredb fts_search), `search_multiple_books` (≤100 ids), `unified_search` (faceted + fuzzy + sort), `get_books_batch` (≤100 ids), `get_random_books`, `full_text_search`, `full_text_search_book` (direct-SQLite over `full-text-search.db` w/ context windows), `get_full_text_search_stats`. **Resources:** `calibre://stats`, `calibre://book/{book_id}/details`. No prompts.

### calibre-library-mcp (`calibre-library-mcp-main.zip`) — 7 tools
`calibre_search_books`, `calibre_recent_books`, `calibre_book_details`, `calibre_search_text` (snippets from Calibre's FTS db), `calibre_index_summary` (per-format `files_with_text`/`err_msg` stats), `calibre_index_status` (`calibredb fts_index status`), `calibre_run_index_maintenance`. No resources/prompts.

### calibre-web-mcp / acato (`calibre-web-mcp-main.zip`) — 10 tools
Reads: `list_shelves`, `get_shelf_contents`, `search_books`, `get_book_details`, `list_books_missing` (cover/format/tags audit). Writes (shelf-scoped): `create_shelf`, `delete_shelf`, `add_book_to_shelf`, `remove_book_from_shelf`, `set_shelf_public`. No resources/prompts. (README claims 11; source has 10.)

### calibre_mcp_server / ajtudela (`calibre_mcp_server-main.zip`) — 10 tools, all read-only
`search_books_by_title`, `search_authors_by_name`, `get_books_by_author`, `get_books_by_author_id`, `get_books_by_series`, `get_books_by_tag`, `search_books_by_tag_pattern`, `get_book_details` (incl. custom columns), `get_library_stats`, `get_all_tags`. No resources/prompts.

### calibre-rag-mcp-nodejs (`calibre-rag-mcp-nodejs-master.zip`) — 7 tools
`search` (metadata → `epub://` URLs), `fetch` (**unimplemented stub**), `list_projects`, `create_project`, `add_books_to_project` (extract→chunk→embed), `search_project_context`, `get_project_info`. `resources/list` and `prompts/list` hardcoded to `[]`.

### converter-mcp / Gabriele Zigurella (`converter-mcp-main.zip`) — 3 tools
`convert_file` (universal, routed by extension: ebook/video/audio/image), `list_supported_formats`, `get_conversion_info`. No resources/prompts; queue/progress infra exists but unwired.

### calibre-mcp-server / iain247 (`calibre-mcp-server-main.zip`) — 6 tools
`list_all`, `search` (calibredb `--search`), `fts` (`calibredb fts_search`), `book`, `search_book` (regex in-EPUB, ±200-char snippets), `read` (EPUB chapter by number / list chapters). No resources/prompts.

### mcp-server / Miguel0888 (`mcp-server-main.zip`) — 2 tools
`calibre_fulltext_search` (LIKE over title/ISBN/comments — not real content FTS), `calibre_get_excerpt` (by ISBN, from the `comments` field). No resources/prompts. (Plus a Calibre GUI plugin with a client-side multi-round research agent — see §2 Tier 3.)

### calibre-mcp / nicolas-moreira (`calibre-mcp-main.zip`) — 14 tools, **not Calibre-related**
AI-agent memory server: `start`, `remember`, `recall`, `who`, `calibrate`, `anti_pattern`, `session_health`, `letter`, `flush`, `spawn_gene`, `evolve`, `genes`, `dispatch`, `ack`, `agents`. Listed only for completeness.

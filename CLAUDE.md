# CLAUDE.md — Calibre MCP Server

<!-- Project memory for the calibre-mcp build. Goal, constraints, and the evidence base
     a design/implementation session needs before writing any code. -->

## Macro goal

Build **the most capable Calibre MCP server in existence** — a single, reliable
TypeScript server that replaces the current two-server hack (`FaceDeer/calibre_full_mcp_server`
for reads + `shell-command-mcp`/`calibredb` for writes) running in Claude Desktop today.

It must:
1. **Match the full tool surface of every known Calibre MCP server** (feature parity baseline).
2. **Add semantic search** — the headline differentiator no existing TS server has.
3. **Fix the write path** that breaks in Cowork (`MCP error -32602`, args-as-strings).

**Two surfaces (Artem's framing).** The server works at two scopes: the **catalog/library**
(update the library, book metadata, tags, bulk ops, dedupe, enrich) and a **single book** (extract
content — whole book or a chunk — and keyword/semantic search *within* one book). Semantic search
spans both: **across the whole library OR one book separately** — a `scope: library|book` param, not
extra tools (see `docs/TOOLS.md`).

In one line: every useful tool the field has *plus* meaning-based search (library- *and* book-scoped)
*plus* safe, hardened writes.

## Target environment (ground-truth, do not re-derive)

- Calibre **9.10**, macOS Apple Silicon (macOS 26 beta), Node **v24**.
- Library: **~801 books** in `Programming Books` (default) + a `Reaserch Books` lib, under `~/Documents/Books/`.
- Mostly **PDF/EPUB, technical, EN + RU**. Many have raw filenames (`795731065`, `top.dvi`, `B0CZS7H23N.pdf`) → metadata recovery matters.
- Calibre **GUI is normally running** + Content Server live on `:8080`.
- Clients: Claude Desktop, Claude Code CLI, Cowork. Transport: **stdio**.

## Hard constraints / gotchas (these killed earlier attempts)

- **GUI-concurrency lock is real (reproduced).** With the app open, direct `calibredb`/SQLite/DB-API
  access is refused or dangerous. Safe live paths: Content Server HTTP (reads) or `calibredb`
  routed *through* the server URL. Treat the DB as **read-mostly**; never race the GUI on writes.
  **Write path RESOLVED** (`docs/CAPABILITIES.md` §2): route writes through the running server — shell
  `calibredb --with-library http://localhost:8080/#Lib` (it speaks `/cdb/cmd` for us), the server
  permitting writes via `--enable-local-write`; a direct `/cdb/set-fields` HTTP client is a LATER opt.
- **`-32602` serialization bug** (our Cowork failure) is client-side, confirmed, unfixed. Defense =
  **Zod coercion** on every input: `z.coerce.number()`, `z.preprocess(JSON.parse, …)` for arrays/objects,
  unions for ids. **Never** `z.coerce.boolean()` on `"false"`.
- **stdout is sacred** on stdio — all logs to **stderr**. One stray `console.log` corrupts the stream.
- **FTS is book-level only** (no PDF page / EPUB spine location) and **not enabled** on this library yet.
  Calibre has **no OCR**; PDF is the worst conversion/extraction input.
- **Writes gated by default** — read-only unless an explicit env flag + per-tool `annotations` allow it.

## Tech stack (decided in research, confirm in design)

- **`@modelcontextprotocol/sdk` 1.29.0** (protocol `2025-11-25`), `registerTool` + `outputSchema`/`structuredContent`.
  Do **not** wait for SDK v2 (alpha); isolate the SDK behind a thin layer to de-risk migration.
- **Zod** for input schemas (with the coercion layer above).
- **Semantic search:** `@huggingface/transformers` 4.2.0, **in-memory brute-force cosine** persisted as
  SQLite BLOBs, mean-pool+normalize. EN+RU → model **LOCKED to `multilingual-e5-small`** (was
  `paraphrase-multilingual-MiniLM`; swapped 2026-06-28 — same 384-dim/footprint but 512-token window vs
  128 and a verified RU retrieval benchmark; needs `query:`/`passage:` prefixes). Full pipeline
  (extraction, chunking, hybrid retrieval) in **`docs/SEMANTIC-SEARCH.md`**; latency left to measure.
  Sub-book chunks carry a `{book_id, location}` payload → also powers per-book semantic search (`scope=book`).
- **Clean Architecture:** keep tool logic (schemas, handlers, embedding/DB code) free of SDK types.
- Package via **npx** + **MCPB** bundle for Claude Desktop.

## Tool surface to build

Baseline = the **capability surface** of FaceDeer (full read/write/convert/import/export +
per-library permission model) — **18 = a capability target, not a tool-count target**. See
`docs/RESEARCH.md` §5.0 for the verified inventory and the coverage table.

**Tool-count target: keep the model-facing surface ≤ ~20 task/intent tools.** Field + research
evidence (`docs/DESIGN.md` §9.1): selection accuracy degrades as the number of *confusable* tools per
query grows (OpenAI's "<20" is a soft heuristic; the measured degradation zone is ~30–50 similar
tools — we must stay under it). So **don't 1:1-mirror calibredb subcommands as tools**; fold related
operations into fewer **task/intent** tools (e.g. one `calibre_recover_metadata` doing
ISBN→OpenLibrary→GoogleBooks internally, not three chainable tools). Cheap evidence-backed wins:
**namespacing**, **tool consolidation**, lean tool-def token budgets, sharp **descriptions** (the
10x selection lever). At ≤20 we do **not** need RAG-over-tools / MCP-Zero machinery internally.

**Differentiators to add on top (our niche — no existing TS server combines these):**
- `semantic_search` + embeddings index build/refresh
- `metadata_enrichment` (Open Library / Google Books) — for raw-filename books
- `isbn_tools` (extract/validate ISBN from book text)
- `find_duplicates` / `compare_books` (with merge-safety scoring)
- `missing_book_scout` / `quality_report`
- **preview-first** bulk operations (FaceDeer's `bulk_update_metadata` defaults to ALL books — unsafe)
- serialization-hardened `update_book` / `bulk_update_metadata`

> **Consolidated & LOCKED in `docs/TOOLS.md`** (14 v1 tools — this list is the *capability rationale*, not
> the build list). Name mapping: `metadata_enrichment`+`isbn_tools` → `calibre_recover_metadata`;
> `compare_books` → a mode of `calibre_find_duplicates`; `missing_book_scout` → folded into
> `calibre_quality_report`; bulk → `calibre_bulk_update` (required `ids`/`query`, no all-books
> default). Per-book keyword + semantic search added via a `scope` param (no new tools).

## Reusable code (licensing)

**Decision (2026-06-27): our server is MIT/Apache (permissive), clean-room.** Operating rules:
- ✅ Call Calibre as a *program* (shell `calibredb`, Content Server HTTP, `ebook-convert`,
  `fetch-ebook-metadata`) — mere use, GPL does not propagate. This is our primary interface.
- ✅ Read Calibre/plugin GPL source to *understand the contract* (`/cdb/cmd` arg shapes in
  `src/calibre/db/cli/cmd_*.py`, encoding in `utils/serialize.py`, query grammar in `db/search.py`,
  `check_isbn`/`author_to_author_sort` in `ebooks/metadata/`).
- ✅ Reimplement algorithms *independently* from the manual / observed behavior / well-known formulas
  (ISBN checksum, Flesch/Fog, SHA dedupe). **Do NOT line-by-line translate GPL code** (Calibre or
  kiwidude/JimmXinu plugins — all GPL-3.0) into TS; that would force our server to be GPL.
- ✅ Copy freely from permissive sources only (below).

- **calibre_tools** (alexchilton, Apache-2.0) — semantic search (MPS), ISBN, dedupe algorithms.
- **mekk.calibre** (BSD, dormant 2017) — `calibre_guess_and_add_isbn`, `calibre_report_duplicates` algorithms (idea/algorithm only, pre-FTS5).
- **FaceDeer** (MIT) — permission model + write type-normalization; **NOT calibredb-based** (it uses a `calibre-debug` internal-API worker).
- **ajtudela / trieloff** (Apache-2.0) — clean validation pattern; macOS `calibredb` timeout handling.
- **sandraschi / chepetime** — **idea-only** (no license): portmanteau tools, FTS location resolution, RAG, TS structure.

## Project artifacts

- `docs/RESEARCH.md` — the foundation report (6 sections: capability inventory, MCP best practices, server comparison, §5 tool catalog + §5.0 FaceDeer coverage, open questions). §5/§6 superseded downstream (see below).
- `docs/CAPABILITIES.md` — deep capability + Content-Server-API analysis; **resolves the write path/auth, PDF-extraction, and `/ajax` stability questions** and maps GPL plugins → port-the-algorithm differentiators.
- `docs/local-groundtruth.md` — firsthand probes of this machine's Calibre (CLI subcommands, GUI lock, Content Server `/ajax/` shapes).
- `docs/calibredb_help.txt` — full `calibredb` v9.10 CLI dump.
- Decision docs (see **Status**): `docs/DESIGN.md`, `docs/TOOLS.md` (build list of record), `docs/DISTRIBUTION.md`, `docs/INTERACTIVITY.md`.

## Working rules

- English for all code, comments, docs (per global policy). Respond to Artem casually, concise, in markdown.
- **Cite first-party sources; flag anything unconfirmed** — don't trust memory for versions/APIs/tool lists.
- `docs/RESEARCH.md` §6 open questions are mostly **resolved** (write path/auth, PDF extraction, `/ajax`
  stability → `docs/CAPABILITIES.md`; RU model → `docs/TOOLS.md` #5). Two remain for **implementation time**:
  the exact `-32602` failure point and transformers.js cache/cold-start. Resolve those during the slice.

## Status

- ✅ **Research phase complete** (`docs/RESEARCH.md`).
- ✅ **Capability + API analysis complete** (`docs/CAPABILITIES.md`) — resolved the write path
  (`/cdb/cmd` HTTP + `--enable-local-write`, or `calibredb --with-library URL`), PDF-extraction
  (PyMuPDF primary), `/ajax` stability tiers, and plugin reuse (port GPL algorithms, don't wrap).
- ✅ **Design decisions captured** (`docs/DESIGN.md`) — ideas from *The MCP Standard* (Sekar) folded in:
  capability model, namespaced routing-policy descriptions, ResourceLink + pagination, return-not-throw
  `isError` contract, disable-write-tools + elicitation, injection fencing + execFile-array calls,
  semantic-search architecture.
- ✅ **Final tool list LOCKED** (`docs/TOOLS.md`) — 14 v1 tools + LATER-deferred set (convert/export/
  library-wide-rag/etc.). **Amended 2026-06-27:** per-book keyword + semantic search added via a
  `scope: library|book` param (no new tools) so search serves both the catalog and single-book surfaces.
- ✅ **Distribution LOCKED** (`docs/DISTRIBUTION.md`) — local-run package; npm + MCPB + Registry
  (`io.github.caelum29/calibre-mcp`); stdio-only (Cowork via Desktop bridge); embeddings opt-in.
- 🔬 **Interactivity researched** (`docs/INTERACTIVITY.md`) — MCP Apps (SEP-1865) in-chat widgets; §9.3
  gate now OPEN (Claude Desktop renders them). Cover board = strongest early candidate; **v1-vs-LATER OPEN**.
- ✅ **Scaffold slice complete** (2026-06-28) — Clean-Arch skeleton + cross-cutting primitives
  (`src/tools/{coerce,result,cursor,resource-link,registry,define,types}.ts`), Content Server HTTP
  read client (`src/calibre/{http,content-server,lib-id}.ts`), domain types (`src/domain/`), and the
  first vertical slice: `calibre_list_libraries` + `calibre_search` (meta/library) + `calibre_get_book`
  + the `calibre://book/{id}` resource. Write-gate (`reg.disable()`) wired but no write tool yet.
  Typecheck/tests green (32 tests); verified end-to-end against the live Content Server.
  **Correction folded in:** SDK 1.29.0 `CallToolResult` has no top-level `nextCursor` → cursors ride
  in `structuredContent` (`docs/DESIGN.md` §2 amended; `src/tools/cursor.ts`).
- ✅ **Increment 2 complete** (2026-06-28, branch `feat/get-content-categories-write`, 5 staged commits) —
  three new tools + the FTS/book search branches. **94 tests green.**
  - `calibre_get_content` (#3) — capped, fenced excerpts walkable via a `ContentCursor`
    (`src/tools/content-{chunk,cursor}.ts`). Extraction subsystem `src/calibre/extract.ts`: startup
    backend detection (pdftotext > PyMuPDF bridge `scripts/pymupdf_extract.py` > ebook-convert; logged
    to stderr), download→convert→**cache** (`os.tmpdir`, sha256 key, LRU) — page-2 cache hit ~26ms live.
  - `calibre_list_categories` (#4) — `/ajax/categories` + `categoryItemsByUrl` (hex node url verbatim);
    `matchCategory` synonym resolver; valueFilter regex (client-side filter+paginate).
  - `calibre_update_book` (#11, **first `write:true`**) — `calibredb set_metadata` via the server URL;
    field allowlist (+`#custom`), applied diff + no-op, write-refusal→actionable message
    (`src/calibre/metadata-fields.ts`). Live-verified the gate: ABSENT when `CALIBRE_MCP_ENABLE_WRITE`
    off, PRESENT when on.
  - `calibre_search` — `mode=fts` (library, grouped resource_links + fenced snippets) and `scope=book`
    (in-book FTS, forces fts) wired; `client.ftsSearch` + pure `buildFtsArgs`/`parseFtsResults`.
  - Infra: `http.downloadToFile`, `client.calibredb` now throws `CalibreCliError` (carries stdout+stderr),
    `ToolDeps.extractor`. **Probe-locked mappers:** fts JSON `{book_id,format,title,authors}` with an
    `Integration status` stdout prefix; set_metadata refusal = exit 1 + `Forbidden` (stderr).
- ⏭️ **Pending live verification (needs Artem's setup):** `brew install poppler` and/or `pip install pymupdf`
  (PDF text — **poppler `pdftotext` now installed → preferred PDF backend, verified live**; PyMuPDF
  optional); **enable FTS indexing** via the Calibre GUI (Preferences → Searching → Full text search) —
  the CLI `calibredb … fts_index enable` route is itself a *write* and is **Forbidden** without local-write,
  so use the GUI toggle; Content Server **--enable-local-write** (write round-trip — currently refused as expected).
- ✅ **Increment 3 complete** (2026-07-01, branch `feat/semantic-search`) — **the headline
  differentiator**: vector-only semantic search, de-risk slice. **127 tests green** (+3 gated model
  tests); **verified live** end-to-end against the Content Server.
  - New SDK-free core `src/semantic/`: `model.ts` (locked constants — model, 384-dim, prefixes,
    `INDEX_VERSION`), `vector.ts` (Float32-LE BLOB encode/decode **honoring `byteOffset`**, L2-norm,
    cosine `dot`, `topK`), `embedder.ts` (`TransformersEmbedder` — **lazy dynamic-import** of the
    optional `@huggingface/transformers`, `query:`/`passage:` prefixes baked in, mean-pool+normalize,
    coded `EMBEDDER_UNAVAILABLE`), `chunk.ts` (char-based overlapping chunker, exact offset recovery,
    surrogate-safe, `lengthFn` seam for the deferred token-based upgrade), `store.ts`
    (`SqliteIndexStore` on **`node:sqlite`** — zero native deps for npx/MCPB; per-library db under a
    persistent data dir; meta-mismatch guard; atomic `replaceBook`; brute-force cosine).
  - `calibre_semantic_search` (#6, R) — `scope=library` ranks books (resource_links + score),
    `scope=book` ranks passages (fenced, char-located); empty-index & not-indexed → actionable errors;
    `lowConfidence` when top cosine < `config.semanticFloor` (0.78).
  - `calibre_build_index` (#7, **W**) — selector **required** (`bookId|ids|query`; full-library
    deferred); reuses `extractor.getText` cache → `chunkForEmbedding` → `[title › authors]` context
    prepend (embedded text only; stored body stays raw so offsets match `calibre_get_content`) →
    `embedder.embedPassages` → `store.replaceBook`; per-book failures collected, not fatal; `force`
    re-indexes; `enableFts` accepted but **no-op + note** in v1.
  - Wiring: `ToolDeps.{embedder,index}` (both lazy — no model load / no db file for read-only
    sessions); `config.{indexDir,semanticFloor}`; `engines.node` → `>=22.5`; `test:model` script.
  - **Live-verified:** transformers.js cold-start ~66s (one-time HF download, then cached & offline);
    book 658 → 102 chunks in 4.6s offline; `"memory safety and ownership"` → the exact Ownership
    section at cosine **0.872**; cross-lingual RU proven by the gated model test.
  - **Deferred to next increment (all additive, no re-embed):** FTS5 + RU Snowball pre-stem + RRF
    hybrid fusion; token-based chunking; PDF page / EPUB spine locations; worker-thread parallelism;
    full-library build; reranking; `sqlite-vec` fast path.
- ⏭️ **Next tools:** semantic hybrid fusion (FTS+RRF) as increment 4, then
  `calibre_find_duplicates`/`calibre_quality_report`/`calibre_recover_metadata`, then `calibre_bulk_update`
  (destructive → elicitation).

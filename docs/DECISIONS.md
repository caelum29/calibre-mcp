# DECISIONS — Calibre MCP locked choices

<!-- Registry of dated decisions that must not be re-litigated, plus a consolidated Deferred/LATER
     registry. Split out of CLAUDE.md (token diet, 2026-07-06). Narrative history lives in
     docs/JOURNAL.md; invariants that constrain the next edit live in CLAUDE.md. Entry shape:
     `D-NNN | date | decision | why (1 line) | source`. -->

## Locked decisions

D-001 | 2026-06-28 | **Embedding model LOCKED to `multilingual-e5-small`** (384-dim, needs `query:`/`passage:` prefixes). | Swapped from `paraphrase-multilingual-MiniLM` — same 384-dim/footprint but 512-token window (vs 128) and a verified RU retrieval benchmark. | Tech stack; JOURNAL § Increment 3.

D-002 | 2026-07-01 | **`INDEX_VERSION` = 2; a mismatched (v1) index is refused → rebuild** (`store.ts` meta-mismatch guard). | v2 added the `body_stem` column + `chunk_fts` FTS5 vtable for hybrid keyword search; old vector-only indexes can't answer the keyword half. | JOURNAL § Increment 4.

D-003 | 2026-07-01 | **Writes use in-band `preview`/`confirm` params, NOT MCP `elicitation/create`.** | Real elicitation would leak the SDK into `ToolDeps`, violating the SDK-free-handlers invariant; DESIGN §4 preview-first is honored via params instead. Real elicitation deferred (see registry). | JOURNAL § Increment 7 (Design Q1).

D-004 | 2026-06-27 | **Server is MIT/Apache (permissive), clean-room.** Call Calibre as a program + read GPL source only to understand the contract; reimplement algorithms independently; copy only from permissive sources. | Line-by-line translating GPL (Calibre / kiwidude / JimmXinu plugins, all GPL-3.0) into TS would force the server to be GPL. Full ✅/❌ operating rules live in CLAUDE.md. | Licensing.

D-005 | 2026-06-27 (amended) | **Tool list LOCKED at 14 v1 tools, now 15** (`calibre_extract_isbn` added 2026-07-02). Per-book keyword + semantic search added via a `scope: library\|book` param, not new tools. | Keep the model-facing surface ≤ ~20 task/intent tools (cliff-safe); `docs/TOOLS.md` is the build list of record. | `docs/TOOLS.md`; JOURNAL § "Final tool list LOCKED" + § extract_isbn.

D-006 | 2026-07-02 | **Distribution recipe:** bump version in `package.json`+`manifest.json`+`server.json` → CHANGELOG → tag `v*` → push. Release CI: version guard → `npm publish --provenance` (OIDC Trusted Publishing, **zero secrets**) → `pack:mcpb` → GitHub release upload → `mcp-publisher github-oidc` registry publish. | Proven end-to-end (v0.1.1). OIDC gotchas, all hit live: classic automation tokens can't publish (npm 2025 hardening); setup-node `registry-url` writes an empty `_authToken` that overrides OIDC (PUT→404); runner npm must be ≥11.5.1; npmjs trusted-publisher entry must name the exact repo + the workflow filename only, empty environment. | JOURNAL § Increment 8.

D-007 | 2026-07-05 | **Registry shape (§8 #3 / D3):** rail = git-convention on GitHub surfaced as a Claude Code plugin marketplace (one repo + `.claude-plugin/marketplace.json`); index = single curated regenerated file; submission = PR → CI legal-gate in a reusable workflow → merge = listing; private half = zero overhead (skill dir drops into `~/.claude/skills/`). | GitHub's own DMCA process IS the §512 safe-harbor story (no server, no registered agent). Amendments: `contribution_frac` must be gate-recomputed from measured overlap (never trusted from the manifest); paraphrase-substitution needs a semantic-coverage outlier flag the shingle check can't see. | `docs/PRODUCT-DECISIONS.md` D3; JOURNAL § "§8 #3 RESOLVED".

D-008 | 2026-07-01 | **Write path RESOLVED — the libId-resolve pattern is mandatory for ALL `calibredb` calls.** `calibredb --with-library` needs the library **ID** (`Programming_Books`), not the display name (`Programming Books`, which 404s); resolve display→libId via `content.resolveLibraryId` first, pass it as `calibredb` `opts.library`. | The earlier "refused as expected" was this libId-404, not a local-write refusal. This is an invariant, restated in CLAUDE.md. | JOURNAL § "Write path VERIFIED live".

D-009 | 2026-07-05 | **Book→Agent-Skill "distill" is skill-only (0 new MCP tools).** Adds one `structure` param to `calibre_get_content` + one pure module (`chapters.ts`) + companion skills; no INDEX_VERSION bump, no store change, no new deps. | Resolved idea 08 B2+; keeps the tool count at 15. | `docs/prompts/ideas/08-…-DECISION.md`; JOURNAL § Increment "distill".

D-010 | 2026-06-27 | **Semantic search stack:** `@huggingface/transformers` 4.2.0, in-memory brute-force cosine persisted as SQLite BLOBs (`node:sqlite`, zero native deps), mean-pool+normalize; hybrid = vector-top-50 + FTS5-top-50 fused by RRF (k=60, no score normalization); Node-side Snowball pre-stemming (`snowball-stemmers`). | Full pipeline in `docs/SEMANTIC-SEARCH.md`. | Tech stack; JOURNAL § Increments 3–4.

## Verbatim source blocks (lifted out of CLAUDE.md, kept here losslessly)

### Tech stack — semantic model paragraph (was CLAUDE.md "Tech stack")

- **Semantic search:** `@huggingface/transformers` 4.2.0, **in-memory brute-force cosine** persisted as
  SQLite BLOBs, mean-pool+normalize. EN+RU → model **LOCKED to `multilingual-e5-small`** (was
  `paraphrase-multilingual-MiniLM`; swapped 2026-06-28 — same 384-dim/footprint but 512-token window vs
  128 and a verified RU retrieval benchmark; needs `query:`/`passage:` prefixes). Full pipeline
  (extraction, chunking, hybrid retrieval) in **`docs/SEMANTIC-SEARCH.md`**; latency left to measure.
  Sub-book chunks carry a `{book_id, location}` payload → also powers per-book semantic search (`scope=book`).

### Tool surface — differentiators + LOCKED tool list (was CLAUDE.md "Tool surface to build")

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

### Licensing — permissive-source attribution list (was CLAUDE.md "Reusable code (licensing)")

- **calibre_tools** (alexchilton, Apache-2.0) — semantic search (MPS), ISBN, dedupe algorithms.
- **mekk.calibre** (BSD, dormant 2017) — `calibre_guess_and_add_isbn`, `calibre_report_duplicates` algorithms (idea/algorithm only, pre-FTS5).
- **FaceDeer** (MIT) — permission model + write type-normalization; **NOT calibredb-based** (it uses a `calibre-debug` internal-API worker).
- **ajtudela / trieloff** (Apache-2.0) — clean validation pattern; macOS `calibredb` timeout handling.
- **sandraschi / chepetime** — **idea-only** (no license): portmanteau tools, FTS location resolution, RAG, TS structure.

## Deferred / LATER registry

Consolidated from the scattered "Deferred (additive)" notes across the build. One line each + source.

**Semantic / index (all additive, no re-embed unless noted):**
- Token-based chunking (currently char-based; `lengthFn` seam ready) — JOURNAL § Increments 3–4.
- PDF page / EPUB spine **locations** on chunks (idea 02 `epub-spine.ts`, behind the detector seam) — Increments 3–4, distill §4.5.
- Worker-thread parallelism for embedding — Increments 3–4.
- Full-library build (`calibre_build_index` selector currently required) — Increments 3–4.
- Reranking — Increments 3–4.
- `sqlite-vec` fast path — Increments 3–4.
- `enableFts` param on `calibre_build_index` (accepted but **no-op + note**) — Increments 3–4.

**Curation / enrich:**
- `binary` (SHA) mode of `calibre_find_duplicates` (deferred + note) — Increment 5.
- `readability` (Flesch/Fog) in `calibre_quality_report` (deferred + note) — Increment 5.
- `fetch-ebook-metadata` / `ebook-meta` CLI engines, cover download, batch/bulk recover, Amazon/ASIN — Increment 6.

**Writes:**
- Real MCP `elicitation/create` (blocked by the SDK-free-handlers invariant; see D-003) — Increment 7.
- `/cdb` HTTP batch for `calibre_bulk_update` (currently loops `set_metadata` per id) — Increment 7.
- `calibre_add_book` `--duplicates` / cover — Increment 7.
- `calibre_remove_book` trash-vs-permanent flag — Increment 7.
- A direct `/cdb/set-fields` HTTP write client (currently route via `calibredb --with-library URL`) — CLAUDE.md hard constraints.

**ISBN / extract:**
- Configurable ISBN-13 prefixes (a `CALIBRE_MCP_ISBN_PREFIXES` env was built then reverted as YAGNI; kept as an internal `prefixes` function seam) — JOURNAL § extract_isbn.
- Full spine/page middle sweep (we scan front+tail slices + a labeled-only whole-text middle sweep, not the plugin's per-file walk) — JOURNAL § extract_isbn.

**Distill / skills:**
- TS port of `discovery_tax` for CI — distill §4.5.
- Chapter labels on search hits (rides idea 02 `loc_*`) — distill §4.5.
- "Distill this shelf" batch UX — distill §4.5.
- EPUB spine mode (idea 02 Phase 2) — distill §4.5.
- Configurable extra chapter-word languages — distill §4.5.
- TS manifest emitter; chapter-file layer for very large topics — topic-aggregate skill.

**Interactivity:**
- MCP Apps (SEP-1865) in-chat widgets; cover board is the strongest candidate — **v1-vs-LATER OPEN** — `docs/INTERACTIVITY.md`.

**Known design smell (flagged 2026-07-05, deferred):**
- `calibre_extract_isbn` is `write:true`, so the WHOLE tool — including its `apply=false` preview, which writes nothing — is `.disable()`d in read-only sessions (the write-gate is per-tool, not per-mode). A distill run with writes off therefore can't even *discover* an ISBN from a book's text. Future refinement: split preview-availability from write-availability (a read-safe preview surfaced even when the write gate is off); same shape would help other preview-first write tools. Related bigger lever: real MCP elicitation (D-003, deferred).
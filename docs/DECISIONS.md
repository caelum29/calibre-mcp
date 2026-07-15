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

D-011 | 2026-07-08 | **Cross-encoder reranker LOCKED to `onnx-community/bge-reranker-v2-m3-ONNX` (q8; verified revision recorded as a constant but NOT pinned at load — transformers.js 4.2.0's tokenizer existence probe drops the revision option, so a pinned cache misses and offline loads fail), always-ON for hybrid/vector — no new npm dependency, no new tool param.** Runs through the already-optional `@huggingface/transformers` (`AutoModelForSequenceClassification`, same lazy-load/`RERANKER_UNAVAILABLE` seam as the embedder, cached under `<indexDir>/models`); search fuses/ranks as before, reranks a ~30-candidate pool of (query, chunk body) pairs, emits topK by sigmoid score. Keyword mode / keyword-only indexes skip it; unavailable/erroring reranker degrades to the fused order with an advisory note. `structuredContent` gains `reranked`/`maxRerank`; low-confidence keeps two separate signals (cosine floor on the cosine half, sigmoid < 0.3 ≈ weak on the reranker). **Extended 2026-07-09 — ASK-ARTEM resolved (Artem): always-on CONFIRMED, hardened three ways.** (a) Hard pool cap: exactly the top-`RERANK_POOL`(30) fused candidates are cross-encoded even at topK=50; the remaining fused-order tail is appended after the reranked head, labeled without rerank scores (closes the poolK `max(topK, 30)` latency hole — 50 pairs ≈ 17–25 s warm). (b) Build-time pre-download: `calibre_build_index` best-effort `reranker.warmup()` on embedding builds so the one-time ~576 MB download lands inside the build, not the first search (failure = stderr log + build note, never fatal; keyword-only builds skip it). (c) `CALIBRE_MCP_RERANK` env escape hatch (off/false/0 disables; default ON; env, NOT a tool param) — disabled searches keep the fused order with a note naming the var. Pool-16 / 256-token pair truncation stays LATER pending a bigger eval corpus. | Field consensus: the rerank stage is the single largest precision lever in a hybrid pipeline (+15–40% Hit@1); bge-reranker-v2-m3 is multilingual (EN+RU) and ~Cohere-API quality on BEIR, ONNX q8 on CPU. Measured (not the prompt's guesses): 568M params, ~576 MB q8 download, ~0.35–0.5 s/pair warm on Apple Silicon ⇒ ~10–15 s per full 30-pool. Optional-model stance keeps read-only installs clean and the tool surface at 15. | `docs/prompts/semantic/03-cross-encoder-reranker.md` (local); JOURNAL § reranker + § decisions digest 2026-07-09; eval reports `test/eval/retrieval/reports/2026-07-08-*-pre-reranker*` vs `*-reranker*`.

D-012 | 2026-07-08 | **Embedding model REAFFIRMED as `multilingual-e5-small` after a measured bake-off vs EmbeddingGemma-300M (768 + 256-MRL) and bge-m3; no swap, INDEX_VERSION stays 3.** Thresholds were declared and committed BEFORE running. Candidates crushed the vector half (overall nDCG@10 0.89→0.98, RU-involved 0.84→**1.00**, Hit@1 0.75→0.95) yet **hybrid RU-involved stayed IDENTICAL (0.6302) across all four models** — unweighted RRF lets the keyword half (0 on cross-lingual by construction) pin the fused order, so the default-mode RU gap is a FUSION problem, not an embedder problem; both candidates also failed EN non-regression (`exact-identifier` hybrid −0.031) and CPU throughput (~3 vs 9.7 chunks/s, < ⅓ gate), and Gemma fails the license gate (use-restricted; policy: only MIT/Apache may trigger a swap — whether Gemma terms are acceptable for a *user-downloaded optional model* stays ASK-ARTEM). The embedder is now parameterized over a cited `CANDIDATES` table (`model.ts` `ACTIVE_MODEL` code switch; per-model prefixes/pooling/dtype incl. Gemma's baked-in `sentence_embedding` graph path — its ONNX bakes pooling+projection in, pipeline mean-pooling would be silently wrong — and MRL truncate-renormalize, measured free at 256-dim); the store's `model_id`/`dim` meta keys refuse cross-model indexes even at the same INDEX_VERSION. `nomic-embed-text-v2-moe` (the prompt's Apache-2.0 favorite for our RU gap) proved UNRUNNABLE: no ONNX export on the Hub and transformers.js 4.2.0 registers `nomic_bert` but not the MoE variant. Side-finding: candidate cosine scales sit entirely below the e5-calibrated `semanticFloor` 0.78 while separating negatives BETTER — any future swap must recalibrate the floor per model. | Fresh 2025-26 models don't move the metric that matters (hybrid RU) but cost 3× CPU + bigger indexes; the cheap RU lever is weighted-RRF tuning (06 seam) with the reranker ON. | `docs/prompts/semantic/05-embedding-model-eval-swap.md` (local); report `test/eval/retrieval/reports/2026-07-08-model-bakeoff.md` + raw `…-eb21ff9-bakeoff-*`; JOURNAL § model bake-off.

D-013 | 2026-07-09 | **License posture for OPTIONAL runtime models RESOLVED (Artem, overriding the permissive-only default): use-restricted, user-downloaded models (Gemma-class terms) are ACCEPTABLE for this project; core npm dependencies stay MIT/permissive (D-004 unchanged for code).** `multilingual-e5-small` still ships as the default embedder — D-012's bake-off stands, there is no quality win to claim — but `embeddinggemma-300m` 256-MRL (1 KB/vector, 326 MB download) becomes a legitimate future option if index size ever matters. Resolves D-012's ASK-ARTEM and `docs/prompts/semantic/INDEX.md` flag 05. Homes: engineering/licensing calls live HERE (D-004/D-013); product/legal deep-dives live in `docs/PRODUCT-DECISIONS.md` (cross-referenced there). | The model is downloaded by the USER at runtime from HF (like the reranker), never bundled or redistributed by us — the use-restriction burden attaches to the user's use, not to the MIT-licensed package. | This session (2026-07-09); D-012; `docs/PRODUCT-DECISIONS.md` § Cross-references.

D-014 | 2026-07-09 | **Do NOT convert read tools into MCP resources (F3 / second half of OQ-7a). Keep all reads as tools; expose exactly ONE resource — `calibre://book/{id}` — purely as the `readResource` target that `resource_link[]` results point at.** The sourced "Rule 5 — Tools = operations, Resources = data" (DESIGN §2, line 72) is honored only at that single seam; it does NOT extend to re-shaping `calibre_get_content` / `calibre_get_book` / `calibre_search` etc. into resource templates. | Client-ecosystem reality beats the sourced rule here: host support for resources is materially weaker than for tools (Claude Desktop does not do progressive resource discovery the way it drives tool calls), and converting reads to resources would forfeit our two hardest-won contracts — `structuredContent` (outputSchema) and the return-not-throw `isError` steering. One resource as the resource_link target is the correct balance: full ResourceLink context-window win, zero loss of tool semantics. Recorded to close the question — do not re-litigate. | This session (2026-07-09); DESIGN §2 (ResourceLink pattern, lines 60–73), §5/§6; Artem's F3 framing.

D-015 | 2026-07-12 | **Book-download size cap is CONFIGURABLE, default 256 MB (`CALIBRE_MCP_MAX_BOOK_BYTES`); size it against the SERVED payload, not the file on disk.** The cap was a hardcoded 64 MB in the HTTP layer (`http.ts`) that `indexBook` never overrode, so oversized books failed extraction with "Book file exceeds the size limit" and were silently absent from the semantic index. `Config.maxBookBytes` now supplies the default and `Extractor` passes it (an explicit per-call `args.maxBytes` still wins); the `http.ts` literal remains only as a last-resort floor for direct callers. | Surfaced by the first full-library index build (2026-07-12): **28 of 795 books (3.5%) were dropped by the 64 MB cap** — the largest fixable failure bucket, well ahead of the 16 genuinely-unindexable no-OCR scans. The trap is that the Content Server does **not** serve the on-disk file: an 8.4 MB PDF on disk (book 748, Rust 2nd ed.) is served as 70 MB, so a cap that looks generous against `calibredb`'s `size` field still drops books. Sizing must therefore follow the served payload; 256 MB clears the library's heaviest served book (~191 MB) with headroom. Also note `calibredb list --fields size` is NOT a reliable proxy for what extraction will download. | This session (2026-07-12); full-library build `progress.jsonl` failure triage; `src/config.ts`, `src/calibre/extract.ts`, `src/calibre/http.ts`.

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
- ~~Reranking~~ — SHIPPED 2026-07-08 (D-011, cross-encoder rerank stage).
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

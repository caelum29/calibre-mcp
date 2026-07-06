# JOURNAL — Calibre MCP build history

<!-- Append-only chronological archive of the project's Status log, moved verbatim from CLAUDE.md
     (token-diet split, 2026-07-06). CLAUDE.md holds only the invariants a fresh session needs before
     touching code; this file holds the session archaeology. One H2 per increment/event, in original
     order. Contradictions between an earlier bullet and a later one are preserved on purpose — the
     later dated bullet is the current truth (e.g. the "Pending live verification" block below is
     superseded by the "Write path VERIFIED live" and Distribution bullets). Locked decisions are
     indexed in docs/DECISIONS.md. -->

## Pre-implementation open questions (both since resolved in later increments)

<!-- Moved verbatim from the old CLAUDE.md "Working rules" section. Both were resolved during the
     build (write path/auth, PDF extraction, /ajax, RU model → CAPABILITIES/TOOLS; the -32602 point
     and transformers cold-start → Increments 2–3). Kept here for provenance, not carried into CLAUDE.md. -->

- `docs/RESEARCH.md` §6 open questions are mostly **resolved** (write path/auth, PDF extraction, `/ajax`
  stability → `docs/CAPABILITIES.md`; RU model → `docs/TOOLS.md` #5). Two remain for **implementation time**:
  the exact `-32602` failure point and transformers.js cache/cold-start. Resolve those during the slice.

# Status archive (moved verbatim from CLAUDE.md)


## Research phase complete

- ✅ **Research phase complete** (`docs/RESEARCH.md`).

## Capability + API analysis complete

- ✅ **Capability + API analysis complete** (`docs/CAPABILITIES.md`) — resolved the write path
  (`/cdb/cmd` HTTP + `--enable-local-write`, or `calibredb --with-library URL`), PDF-extraction
  (PyMuPDF primary), `/ajax` stability tiers, and plugin reuse (port GPL algorithms, don't wrap).

## Design decisions captured

- ✅ **Design decisions captured** (`docs/DESIGN.md`) — ideas from *The MCP Standard* (Sekar) folded in:
  capability model, namespaced routing-policy descriptions, ResourceLink + pagination, return-not-throw
  `isError` contract, disable-write-tools + elicitation, injection fencing + execFile-array calls,
  semantic-search architecture.

## Final tool list LOCKED

- ✅ **Final tool list LOCKED** (`docs/TOOLS.md`) — 14 v1 tools + LATER-deferred set (convert/export/
  library-wide-rag/etc.). **Amended 2026-06-27:** per-book keyword + semantic search added via a
  `scope: library|book` param (no new tools) so search serves both the catalog and single-book surfaces.

## Distribution LOCKED

- ✅ **Distribution LOCKED** (`docs/DISTRIBUTION.md`) — local-run package; npm + MCPB + Registry
  (`io.github.caelum29/calibre-mcp`); stdio-only (Cowork via Desktop bridge); embeddings opt-in.

## Interactivity researched

- 🔬 **Interactivity researched** (`docs/INTERACTIVITY.md`) — MCP Apps (SEP-1865) in-chat widgets; §9.3
  gate now OPEN (Claude Desktop renders them). Cover board = strongest early candidate; **v1-vs-LATER OPEN**.

## Scaffold slice complete

- ✅ **Scaffold slice complete** (2026-06-28) — Clean-Arch skeleton + cross-cutting primitives
  (`src/tools/{coerce,result,cursor,resource-link,registry,define,types}.ts`), Content Server HTTP
  read client (`src/calibre/{http,content-server,lib-id}.ts`), domain types (`src/domain/`), and the
  first vertical slice: `calibre_list_libraries` + `calibre_search` (meta/library) + `calibre_get_book`
  + the `calibre://book/{id}` resource. Write-gate (`reg.disable()`) wired but no write tool yet.
  Typecheck/tests green (32 tests); verified end-to-end against the live Content Server.
  **Correction folded in:** SDK 1.29.0 `CallToolResult` has no top-level `nextCursor` → cursors ride
  in `structuredContent` (`docs/DESIGN.md` §2 amended; `src/tools/cursor.ts`).

## Increment 2 complete

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

## Pending live verification (needs Artem's setup):

- ⏭️ **Pending live verification (needs Artem's setup):** `brew install poppler` and/or `pip install pymupdf`
  (PDF text — **poppler `pdftotext` now installed → preferred PDF backend, verified live**; PyMuPDF
  optional); **enable FTS indexing** via the Calibre GUI (Preferences → Searching → Full text search) —
  the CLI `calibredb … fts_index enable` route is itself a *write* and is **Forbidden** without local-write,
  so use the GUI toggle; Content Server **--enable-local-write** (write round-trip — RESOLVED: the earlier
  "refusal" was the libId-404 bug; the write path is verified live, see the 2026-07-01 bullet below).

## Increment 3 complete

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

## Increment 4 complete

- ✅ **Increment 4 complete** (2026-07-01, branch `feat/hybrid-search`, PR #1 merged first) —
  **hybrid retrieval (FTS5 keyword half + RRF fusion)**, additive to the v3 vector schema (the
  `chunks.body` column was kept for exactly this — **no re-embed**). **147 tests green** (+20);
  verified live on books 889 (EN) + 187 (RU).
  - New SDK-free pure modules: `src/semantic/stem.ts` (Node-side pre-stemming — per-token script
    detect → Snowball `russian`/`english` via **`snowball-stemmers`** ISC pure-JS, ё→е normalize,
    code/identifiers left raw; identical transform on ingest + query) and `src/semantic/fusion.ts`
    (RRF, k=60, 1-based ranks, **no score normalization** — sidesteps cosine-[0,1] vs bm25-negative).
  - `store.ts` (**INDEX_VERSION 1→2**, so v1 indexes are refused → rebuild): added a `body_stem`
    column + `chunk_fts` FTS5 external-content vtable (`tokenize='unicode61 remove_diacritics 2
    tokenchars ''-_+#.'''`) + AFTER INSERT/DELETE/UPDATE sync triggers; `searchLibraryFts` (best
    chunk per book) / `searchBookFts`; bm25 kept **negative** (order by `rank`, never ABS). node:sqlite
    **ships FTS5** (verified). Pre-stem happens at insert so the trigger populates FTS automatically.
  - `calibre_semantic_search` gained `mode: hybrid|vector|keyword` (default **hybrid**), both scopes,
    **no new tools**. hybrid RRF-fuses vector-top-50 + fts-top-50; `keyword` needs **no model** (the
    embedder-unavailable fallback — error message points to it); confidence signal (`maxScore`/floor)
    comes from the cosine half only.
  - **Live-verified:** rebuilt 889+187 (3062 chunks, 84s, 0 failures); RU keyword `"потребители"`
    matched `"потребителя"` (different case, shared stem `потребител`) — the pre-stemming payoff;
    EN→RU vector `"consumer group rebalancing"` → RU `ConsumerRebalanceListener` still cross-lingual.
  - **Still deferred:** token-based chunking; PDF page / EPUB spine locations; worker parallelism;
    full-library build; reranking; `sqlite-vec`; `enableFts` on `calibre_build_index` (still no-op+note).

## Increment 5 complete

- ✅ **Increment 5 complete** (2026-07-01, branch `feat/curation-tools`, PR #3 merged) — the
  **curation read pair**, clean-room TS reimplementations of the GPL Find-Duplicates / Quality-Check
  *algorithms* (reimplemented from documented behavior, not ported). READ-only, no network. **188 tests
  green**; live-verified against `Programming_Books` (~801 books).
  - New pure domain `src/domain/curation/`: `normalize.ts` (`identicalKey`/`similarKey` grouping keys,
    `authorToAuthorSort` heuristic), `duplicates.ts` (`findDuplicateGroups`, `mergeSafety` ∈ [0,1] —
    conflicting-ISBN/language/format deductions, `compareBooks` + `keep` recommendation), `quality.ts`
    (5 rules: `missing_metadata`, `raw_filename_title`, `isbn_invalid`, `author_sort_mismatch`,
    `series_gaps`; `isbn.ts` checksum validators reused). Shared `src/tools/select-books.ts`
    (`selectBooks` — ids/query → Book[], `MAX_BOOKS`=2000 cap, empty-query = all books).
  - `calibre_find_duplicates` (#8, R) — `mode=identical|similar|compare`; grouped resource_links +
    fenced snippets + `mergeSafety`; `compare` needs ≥2 ids → field diff; `binary` (SHA) deferred+note.
  - `calibre_quality_report` (#9, R) — per-check counts + paginated fenced issue lines; `readability`
    (Flesch/Fog) deferred+note. Both `readOnlyHint+openWorldHint`, no write flag.
  - **Live-verified:** quality_report flagged **320 issues** (missing_metadata 204, author_sort_mismatch
    111, raw_filename_title 5 — caught `795731065`, `442955403`); find_duplicates `similar` found 22 real
    groups (edition/subtitle variants). author_sort_mismatch is chatty (heuristic, info-severity — safe).

## Increment 6 complete

- ✅ **Increment 6 complete** (2026-07-01, branch `feat/recover-metadata`, PR #4 merged) — the
  **raw-filename fix**. `calibre_recover_metadata` (#10, R) proposes real metadata for missing/raw-filename
  books via Open Library → Google Books; **READ/preview-only** — returns a ready-to-apply `changes` object
  for `calibre_update_book`, never writes. **210 tests green** (+22); live-verified.
  - New pure domain `src/domain/enrich/`: `extract-isbn.ts` (clean-room scraper — labeled + bare runs,
    checksum-filtered via `curation/isbn.ts`), `filename-guess.ts` (`looksLikeRawFilename`/`isUsableTitle`),
    `proposal.ts` (`buildProposal` — fills only **missing/weak** fields, never clobbers, emits only
    update_book-allowlisted keys). Isolated providers `src/enrich/`: neutral `fetchJson` (NOT the CS-branded
    `getJson`) + `openlibrary.ts`/`googlebooks.ts`, **return-not-throw** so a dead/rate-limited provider
    degrades to the next. `ToolDeps.providers?` seam (defaulted in-handler, injectable for tests).
  - Lookup chain: existing valid ISBN → ISBN scraped from book text (first 20k chars via `extractor`) →
    usable title (+first author) → else graceful "nothing to look up".
  - **Live-verified:** book **584** `"442955403"` → scraped ISBN `9789388511773` → OL →
    *Fundamentals of Software Engineering* (title/authors/publisher/isbn); graceful refusals on #116/#658;
    OL title-search live; **Google Books hit HTTP 429 (daily quota)** → caught → degrades to OL (return-not-throw
    validated live). Fixed a real bug: GB term separator was a literal `+` (→`%2B`), now a space.
  - **Deferred (additive):** `fetch-ebook-metadata`/`ebook-meta` CLI engines, cover download, batch/bulk
    recover, Amazon/ASIN.

## v1 status: 11 of 14 tools built + merged to `main`.

- 🎯 **v1 status: 11 of 14 tools built + merged to `main`.** Remaining = the 3 gated **write** tools:
  `calibre_bulk_update` (#12, `ids`/`query` required, `preview=true` default → elicitation for destructive),
  `calibre_add_book` (#13, path whitelist), `calibre_remove_book` (#14, `confirm` required).

## Write path VERIFIED live

- ✅ **Write path VERIFIED live** (2026-07-01) — the last v1 unknown resolved. Ran a standalone
  `calibre-server --enable-local-write --port 8080 "…/Programming Books"` (standalone is one way; it still
  serves both libs via calibre's known-library config). **Correction (2026-07-03, confirmed by Artem):** the
  GUI-embedded server *can* also allow local writes — enable **Preferences → Sharing over the net → Advanced
  → "Allow un-authenticated local connections to make changes to the library"** and restart the CS from the
  GUI (documented in README's *Enabling writes*). Earlier "GUI is always read-only" was the default-config
  behavior, not a hard limit. Proved `calibre_update_book` end-to-end: a reversible marker-tag write (persisted on
  read-back, reverted clean) **and** applied a real `calibre_recover_metadata` proposal — book 584
  `"442955403"` → *Fundamentals of Software Engineering* / authors / BPB Publications / isbn 9789388511773.
  The `-32602` argv-array defense held (spaces, `authors` `&`-join, `identifiers:isbn:…` all clean).
  - **Root-cause bug fixed (was the real blocker, NOT a Forbidden):** `calibredb --with-library` needs the
    library **ID** (`Programming_Books`), not the display name (`Programming Books`) — the display form 404s
    (`Not Found`). `calibre_update_book` now resolves display→libId via `content.resolveLibraryId` before the
    calibredb call. **This is the required pattern for all write tools** — resolve the libId, pass it as
    `calibredb` `opts.library`. (Earlier "refused as expected" was likely this 404, not a local-write refusal.)

## Increment 7 complete — v1 CODE COMPLETE

- ✅ **Increment 7 complete — v1 CODE COMPLETE** (2026-07-01, branch `feat/write-tools`) — the **3
  remaining gated write tools**, finishing the 14-tool v1 surface. **232 tests green** (+22); typecheck
  clean. Live write-verification was pending at the time (needs local writes enabled — standalone
  `--enable-local-write` server, or the GUI Advanced toggle per the 2026-07-03 correction above).
  - **Design Q1 resolved → in-band `preview`/`confirm` params** (NOT MCP elicitation): handlers stay
    SDK-free (locked constraint), so real `elicitation/create` would leak the SDK into `ToolDeps` →
    deferred as LATER. DESIGN §4's preview-first rule is honored via params. Q2 → loop `set_metadata`
    per id + hard cap (HTTP batch LATER). All three follow the **libId-resolve pattern**.
  - `calibre_bulk_update` (#12, **W**) — same `changes` across a book SET; `ids`/`query` **required**
    (no all-books default); `preview:true` default computes the per-book diff via `previewBookChanges`
    (new pure builder in `metadata-fields.ts`) + `selectBooks` and writes nothing; `preview:false`
    loops `calibredb set_metadata` per id (cap `MAX_BULK`=500; refuses `capped`/over-cap selections),
    per-book failures collected not fatal.
  - `calibre_add_book` (#13, **W**) — `calibredb add <path>`; **path whitelist** (`src/tools/add-path.ts`
    `validateAddPath` — `realpathSync` boundary check, rejects `..`/symlink-escape/dir/missing) against
    `config.addRoots` (env `CALIBRE_MCP_ADD_ROOTS`, default `~/Documents/Books` + `~/Downloads`); parses
    `Added book ids:` from stdout.
  - `calibre_remove_book` (#14, **W**, DESTRUCTIVE) — `calibredb remove <ids>`; `confirm:true` required
    else a **dry-run** listing what would be deleted (records + files, permanent); comma-joined id argv.
  - Shared refactors: `bookFieldValue`+`previewBookChanges` extracted to `metadata-fields.ts`;
    write-refusal classifier lifted to `src/tools/write-refusal.ts` (`isWriteRefused`/`WRITE_REFUSED_MESSAGE`,
    reused by all four write tools). `registry.test.ts` write list now = the 4 gated write tools.
  - **Deferred (additive):** real MCP elicitation; `/cdb` HTTP batch for bulk; `add --duplicates`/cover;
    `remove` trash-vs-permanent flag.

## v1 status: 14 of 14 tools built

- 🎯 **v1 status: 14 of 14 tools built** (`feat/write-tools` since merged and shipped in v0.1.0).
  Write tools live-verification (bulk preview→apply + revert, add→remove round-trip) still pending —
  needs local writes enabled (standalone `--enable-local-write` server or the GUI Advanced toggle);
  `calibre_update_book` itself IS live-verified (write-path bullet above).

## Increment 8 complete — DISTRIBUTION

- ✅ **Increment 8 complete — DISTRIBUTION** (2026-07-02, branch `feat/distribution`) — the
  community-release increment: npm + MCPB packaging + README. **249 tests green** (+5 files).
  - **De-Artem-ified** (the DISTRIBUTION "what public changes" list): `CALIBRE_MCP_LIBRARY` default
    now **empty = auto-detect** (`resolveLibraryId()` returns the server's `default_library` from
    `/ajax/library-info`, cached `#defaultLibId`); **cross-platform calibredb discovery**
    (`src/calibre/discover.ts` — darwin/win32/linux well-known paths → PATH fallback; explicit env
    wins even if nonexistent; missing binary = use-time `CalibreNotFoundError` with install hint,
    never a boot crash); FTS paths + `calibre_ping` now **resolve libId first** (read-path twin of
    71531d2 — display-name fragments 404); `envStr()` treats empty/whitespace env as unset (**MCPB
    substitutes `""` for blank optional fields** — also guards `Number("")`→floor-0); version
    single-sourced from package.json (`src/version.ts`, works from src/dist/tarball/MCPB layouts);
    onboarding stderr probe (Content Server reachable? libraries? default?); `addRoots` default
    broadened to `~/Documents` + `~/Downloads`; extract.ts win32 `.exe` + bare-PATH ebook-convert.
  - **npm (v0.1.0):** repository/keywords/author/`mcpName io.github.caelum29/calibre-mcp` (Registry
    pre-wiring), `prepublishOnly` build+test, MIT LICENSE file, **`files` now ships
    `scripts/pymupdf_extract.py`** (real bug: `extract.ts` resolves it `../../scripts/` from dist →
    was silently missing from the published package). Verified: `npm pack --dry-run` + tarball
    install + MCP initialize handshake (serverInfo 0.1.0, 15 tools, probe logs).
  - **MCPB:** `manifest.json` (spec **0.3**, validated w/ `@anthropic-ai/mcpb` 2.1.2) — 6
    `user_config` fields → env (server_url, library, enable_write, index_dir, calibredb_path,
    add_roots as **single** directory picker — the spec only defines array-expansion for `args`,
    env join is undefined); `scripts/pack-mcpb.mjs` (`pnpm pack:mcpb`) stages `build/mcpb` with a
    real `npm install --omit=dev --omit=optional` (pnpm symlinked node_modules can't be zipped;
    embeddings excluded per locked opt-in decision) → **3.6 MB `.mcpb`** (12.1 MB unpacked).
    Smoke-tested the staged bundle in isolation (no parent node_modules): handshake 0.1.0, 11 tools
    (4 write tools absent w/ enable_write=false), semantic tools fail actionably. `build_index` now
    puts failure reasons in the text block (not only structuredContent) — the exact no-embeddings
    path MCPB users hit.
  - **Docs:** community `README.md` (quick starts for Claude Code/Desktop JSON/MCPB/Cowork, the
    two-key write gate incl. the GUI-server-is-read-only gotcha, semantic setup, 15-tool table,
    env reference, troubleshooting), `CHANGELOG.md` (0.1.0), DISTRIBUTION.md status sync.
  - **✅ RELEASED 2026-07-02:** repo flipped public → tag `v0.1.0` → `npm publish` (needed a
    granular access token — the account had no 2FA; plain publish 403s) → GitHub release with the
    `.mcpb` → post-publish `npx -y calibre-mcp@0.1.0` handshake verified against the live server.
    **Fast-follow SHIPPED same day (PR #9):** `server.json` published live to the **MCP Registry**
    (`io.github.caelum29/calibre-mcp` 0.1.0; `mcp-publisher login github` device flow + `publish`,
    verified via the registry API) + `.github/workflows/{ci,release}.yml` (CI green on first run;
    release.yml on `v*` tag: version guard → `npm publish --provenance` → `pack:mcpb` → release
    upload → `mcp-publisher github-oidc` registry publish). **Pipeline PROVEN end-to-end with
    v0.1.1** (2026-07-02): npm 0.1.1 + `.mcpb` release asset + registry `isLatest` — all from one
    tag push, **zero secrets** (npm auth = OIDC Trusted Publishing). Hard-won OIDC gotchas (all
    hit live): classic automation tokens can no longer publish (npm 2025 hardening); setup-node's
    `registry-url` writes an empty `_authToken` placeholder that overrides OIDC (PUT → 404); the
    runner npm must be ≥11.5.1 (`npm i -g npm@latest` step); the npmjs.com trusted-publisher
    entry must name the exact repo (a `caelum29/caelum29` mis-entry → silent exchange failure →
    ENEEDAUTH) and the workflow *filename only* with an empty environment. Release recipe now:
    bump version in package.json+manifest.json+server.json → CHANGELOG → tag `v*` → push.
    Remaining manual check: install the `.mcpb` in Claude Desktop.

## `calibre_extract_isbn` added (#15)

- ✅ **`calibre_extract_isbn` added (#15)** (2026-07-02, branch `feat/extract-isbn`) — the **kiwidude
  Extract-ISBN** capability Artem asked for: scan a book's own text (front matter) for a checksum-valid
  ISBN and stamp it into `identifiers:isbn`. **Gated WRITE, preview-first** (`apply=false` default reports
  the find, `apply=true` writes). Clean-room — reuses our own `extractIsbns`/`scanForIsbn` (NOT a port of
  the GPL plugin). **Read the actual plugin source** (`scan.py`/`nonpdf.py`/`config.py`) and folded its
  algorithm *behaviours* (reimplemented) into our scanner: **prefer ISBN-13 over ISBN-10**, require a
  Bookland prefix (**977/978/979**) on 13-digit runs, **reject all-same-digit runs** (`1111111111` DOES
  pass the ISBN-10 checksum — a real false-positive hole we had), and **scan front matter then the tail**
  (ISBN often on the back cover). Labeled-first stays the primary rank key (13-over-10 is secondary, so
  the labeled-vs-bare test is unchanged). **Correctness beat the plugin implies:** merges into existing
  identifiers before `set_metadata` (which replaces the whole map) so a `doi`/`asin` is never clobbered.
  Refactor: the bounded ISBN text-scan (`scanForIsbn` + timeout/deadline) lifted out of
  `calibre_recover_metadata` into shared `src/tools/isbn-scan.ts` (both tools use it; the guard refinements
  also sharpen recover_metadata's lookup key). **270 tests green** (+11); typecheck clean. **Now 15 tools**
  (cliff-safe under ~20). Live write-verify pending (needs local writes enabled — standalone server or
  the GUI Advanced toggle, same as the other write tools). **Deferred (additive):** configurable ISBN-13 prefixes; full spine/page
  walk (we scan front+tail slices, not the plugin's per-file middle sweep).

## Increment "distill" complete (idea 08)

- ✅ **Increment "distill" complete (idea 08)** (2026-07-05, branch `feat/distill`) — the **book→Agent-Skill**
  differentiator, resolved B2+ (skill-only, **0 new tools** — still 15). Build order from
  `docs/prompts/ideas/08-calibre-distill-DECISION.md` (§4.1 benchmark was already done). **292 tests
  green** (+22); typecheck clean; RU fix **verified live**.
  - New pure module `src/domain/structure/chapters.ts` — clean port of virgiliojr94/book-to-skill's
    chapter detector (MIT, provenance header) `_chapter_number`/`detect_structure`/`_structural_chapter_count`
    **+ Cyrillic extensions** (their detector has no RU/UK): chapter words `глава|часть|раздел|розділ`,
    ToC headers `оглавление|содержание|зміст`, uppercase class widened for Cyrillic. Returns **offsets**
    (`detectChapters → {chapters:[{n,heading,startChar,endChar}], hasToc, detector}`), not just counts;
    duplicate-number disambiguation by **largest-body occurrence** (ToC line vs real body). Kept CJK/Roman
    fidelity. 18 table tests (prose rejection, IIII/VV round-trip, years>99, fenced-code headings, setext
    length rule, Cyrillic, ATX fallback, offset chaining).
  - `calibre_get_content` **+`structure` param** (§4.3, `CoercedBool().default(false)`) — when true runs the
    same extraction path, calls `detectChapters`, returns `structuredContent {chapters:[{n,heading,startChar,
    endChar,approxTokens,cursor}], hasToc, detector, totalChars, format, backend}` + a compact fenced chapter
    table (NOT book text); each `cursor` pre-minted via `encodeContentCursor({offset:startChar,id,format})` so
    the skill seeks any chapter through the existing walk. Ignores `cursor`; 0 chapters = non-error steer to
    the plain walk. Description gained the selection-lever sentence.
  - **Live-verified (Content Server up):** EN book 893 (AI Engineering) → **10 chapters** (matches the
    benchmark), front matter excluded (ch.1 body @29290 not the ToC line); **RU book 187 → 14 chapters**
    (`ГЛАВА 1..14`, ToC detected) — was **0** before the Cyrillic fix. This is the whole payoff.
  - Companion skill `skills/calibre-distill/SKILL.md` (fork of their SKILL.md, MIT provenance) — input =
    book id/title/query via `calibre_search`; extract.py → `get_content structure=true`; grep/sed →
    `calibre_search`/`calibre_semantic_search scope=book` + per-chapter cursors; **Mode 5 targeted fold-in**
    (§4.4a — topic-scoped merge via in-book search, no upstream equivalent) + **Step 9.5 library write-back**
    (§4.4b — Topic-Index tags + distill note via gated `calibre_update_book`, preview-first, merge-don't-clobber).
    Install = copy/symlink to `~/.claude/skills/` (MCPB can't bundle skills — noted in README).
  - **Tool count: 15 → 15** (one param + one pure module + one skill). No INDEX_VERSION bump, no store.ts
    change, no new deps, no writes in the core path. **Deferred (§4.5):** TS port of discovery_tax for CI;
    chapter labels on search hits (rides idea 02 `loc_*`); "distill this shelf" batch UX; EPUB spine mode
    (idea 02 Phase 2 `epub-spine.ts` will slot behind the detector seam); configurable extra chapter-word
    languages.

## Topic-aggregate skill added (prompt 03 / D1.7)

- ✅ **Topic-aggregate skill added (prompt 03 / D1.7)** (2026-07-05, branch `feat/distill-topic`) — the
  **distributable** artifact class: new sibling skill `skills/calibre-distill-topic/SKILL.md` synthesizes
  ONE topic across ≥3 books into a single **concept-keyed** skill (layered overview → decision framework →
  per-concept sections → cross-source config table → mandatory **"where sources disagree/complement"** →
  ISBN bibliography-as-L4). **0 new MCP tools** (reuses `calibre_search`/`calibre_semantic_search`/
  `calibre_get_content structure=true`/`calibre_get_book` + optional `calibre_update_book` write-back);
  agent-neutral; English-only artifacts, RU/UK read natively. Encodes the D1.7 validity conditions (≥3
  sources, no source > 0.50 contribution, per-source own-words/quote-budget, `{n,heading}` L4 keys, never
  char-offset cursors) and emits the D2.8 `kind: topic-aggregate` `distill.manifest.yaml`. Cross-linked
  both ways with `calibre-distill` (one line under its Modes → sibling; sibling routes single-book back).
  Modeled on the validated hand-run prototype (`docs/prompts/ideas/distill-samples/topic-kafka-reliability/`,
  gitignored). **Deferred:** TS manifest emitter; chapter-file layer for very large topics. (The
  automated D1.4 verifier shipped — next bullet.)

## Legal-gate verifier shipped (prompt 04 / D1.4)

- ✅ **Legal-gate verifier shipped (prompt 04 / D1.4)** (2026-07-05, branch `feat/legal-gate`, merged) —
  the mechanical half of the distill admission test. Pure SDK/IO-free module
  `src/domain/distill/legal-gate.ts`: 8-gram shingle overlap (normalized, Unicode/RU-safe, title/author
  **allowlist** per the D1.7 empirical finding), quote budget (25 words/quote, 200/skill), ≥20×
  compression floor (+ per-chapter variant), heading-match with L4/bibliography exemption, cursor-leak
  probe (base64url decode), attribution check; `runLegalGate` aggregates to the manifest
  `quality.legal_gate` keys. CLI `scripts/legal-gate.mjs <skill-dir> --book <id>…` (Content Server +
  Extractor source pull, stderr logs, exit 0/1, writes nothing). Zero new deps, zero new tools; 25
  table-driven tests. **Live-verified both ways:** kafka-reliability prototype → PASS on all 6 checks
  (0 overlaps, 367.6× compression, 24 quoted words); scratch copy + one verbatim RU sentence → shingle
  FAIL with attributed hits. Real bug found live: YAML frontmatter `description:` miscounted as a
  40-word quote → `stripFrontmatter()` + regression test.

## §8 #3 RESOLVED — registry shape (D3)

- ✅ **§8 #3 RESOLVED — registry shape (D3)** (2026-07-05) — `docs/PRODUCT-DECISIONS.md` D3, design-only.
  **Rail = git-convention on GitHub surfaced as a Claude Code plugin marketplace** (one repo +
  `.claude-plugin/marketplace.json`; GitHub's own DMCA process IS the §512 safe-harbor story — no
  server, no registered agent); **index = single curated regenerated file** (E4 generalized, data
  separate from skill content); **submission = PR → CI legal-gate in a reusable workflow → merge =
  listing** (deferred until distribution opens; the submitter-uneditable workflow is what makes gh
  attestation mean "the gate passed this digest"); **private half = zero overhead** (skill dir drops
  into `~/.claude/skills/`, registry machinery purely additive). Two amendments folded in:
  `contribution_frac` must be **gate-recomputed from measured overlap, never trusted from the manifest**
  (anti-laundering), and paraphrase-substitution needs a semantic-coverage outlier flag (e5 embedder)
  the shingle check can't see. Open: §8 #4 topic-resolution, §8 #5 gate economics, §512(f) residual.

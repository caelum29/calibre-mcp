# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The "no extractable text" message no longer diagnoses every format as a scanned PDF —
  an empty EPUB/AZW3 now reads as a missing text layer (image-only pages or DRM) (#100).

## [0.6.4] — 2026-07-22

### Fixed

- Claude Desktop 1.24012.x: every tool declaring an `outputSchema` failed with
  "Tool execution failed" — the client rejects the call pre-dispatch when the schema
  contains the `$schema` meta-key, which the MCP TS SDK always emits. The server now
  strips the `$schema` key from `outputSchema` in outgoing `tools/list` results
  (semantics-free), restoring all tools in Desktop.

## [0.6.3] — 2026-07-22

### Fixed

- Tool failures no longer die silently: an unhandled promise rejection in the process
  used to kill the whole server on Node ≥15, surfacing to the client as a detail-free
  "Tool execution failed" with no way to diagnose it. Such rejections are now logged with
  a full stack to stderr and the process survives; uncaught exceptions still log their
  stack before exit. The catch-all error handler around every tool call now also returns
  the actual error name and message (plus a machine-readable `errorCode`) instead of a
  bare "internal error in `<tool>`", so agents get something actionable to act on. Also
  fixed a related crash vector in the ISBN-scan timeout path that could kill the process
  on a later extraction failure.

### Added

- `pnpm pack:mcpb:dev` builds a Claude Desktop test bundle stamped with a
  `X.Y.Z-dev.<sha>[.dirty]` version (staged only — repo files are untouched), so a local
  test install can never be mistaken for a released bundle.

## [0.6.2] — 2026-07-21

### Fixed

- `calibre_remove_book` no longer scares agents into refusing removal on explicit user
  request: the description overstated the danger ("permanently delete… files on disk") —
  in reality `calibredb remove` without `--permanent` moves books to Calibre's Trash,
  restorable from the GUI — and the dry-run returned `isError: true`, which read as
  "dangerous/failed" and primed refusal of the confirm step. The tool now describes the
  Trash-recoverable two-step flow accurately, the dry-run is a success result with steering
  text (gate unchanged: zero writes without `confirm=true`), and the post-removal message
  mentions Trash restorability. `docs/TOOLS.md` aligned.

## [0.6.1] — 2026-07-21

### Added

- `countOnly` parameter on `calibre_search` — answer "how many books match?" with just the
  count: no cover board, no row fetch (#67).
- Cover board hero state: a search that identifies exactly one book renders a card-like
  hero (large cover opens the full book card, title/authors, Open + Search-inside) instead
  of a one-book shelf; the shelf⇄coverflow toggle hides (#71).

### Fixed

- Zero-result searches no longer attach an empty cover board — plain text only, and the
  board widget collapses instead of showing an error (#68).
- Book card: clicked Read/Download buttons no longer disappear after Claude Desktop's
  open-link dialog (approve or decline) — Desktop resolves a successful ui/open-link with
  an error-shaped body, which the widget misread as "host can't open links" (#69).
- Cover board & card: Search-inside (and other message-backed buttons) no longer vanish
  after a successful send; buttons now hide only when the host genuinely lacks the
  ui/message method (-32601) or omits it from its declared capabilities (#72).
- Book card: the Open button no longer flashes/jitters on click — the pending "Opening…"
  state appears only when the call takes longer than 200 ms (#70).

## [0.6.0] — 2026-07-20

### Added

- Action buttons across both in-chat widgets (issue #53): **Open** launches a book in the
  local Calibre viewer via a new widget-internal `calibre_open_book` tool and the
  `calibre://view-book` scheme — it works even on hosts that block link-opening. The book
  card gains per-format **Download** buttons, a click-to-zoom cover, a **Search inside this
  book** input, and a curation row (**Fix metadata**, **Find duplicates**, **Summarize**)
  that hands the request to the assistant in chat. The cover board gains per-card **Open**
  and **Search inside** (re-runs the board's own query inside that book).
- Runtime shelf⇄coverflow toggle on the cover board. `CALIBRE_MCP_BOARD_STYLE` now sets the
  *initial* style; both variants ship in one widget.

### Changed

- The board no longer opens the browser viewer ("Read") — **Open** (local viewer) replaces
  it; the book card keeps per-format browser Read alongside Download.
- Widgets degrade per capability: hosts that refuse chat messages hide the message-backed
  buttons (`data-nomsg`), hosts that refuse links hide Read/Download/zoom (`data-noread`);
  Open is never hidden.

## [0.5.2] — 2026-07-19

### Added

- Coverflow search-results widget: a second visual style for the in-chat cover board (3D
  cover flow with reflections), selectable via `CALIBRE_MCP_BOARD_STYLE=shelf|coverflow`
  (default `shelf`). The Claude Desktop bundle exposes it as a "Coverflow search results"
  toggle in extension settings.

### Changed

- The cover-board widget template is now composed from one shared MCP-plumbing core plus
  per-variant visuals, so both styles share the same data flow, handshake, and degradation
  paths.
- `CALIBRE_MCP_BOARD_STYLE` parsing is tolerant: strips pasted quotes, accepts
  boolean-toggle values (`true`/`1`/`yes`) as coverflow.

## [0.5.1] — 2026-07-19

### Fixed

- **Semantic-search degradation is now loud** ([#41], [#46]). `calibre_build_index` and
  `calibre_semantic_search` report `semanticAvailable` and `semanticReason` in structured
  output, and an automatic keyword-only downgrade now leads the text response with a warning
  instead of reading as unqualified success.
- **"Embedding model missing" guidance now covers every install type** ([#47]). One universal
  message with steps for the Claude Desktop `.mcpb` extension, npx/global npm, and dev
  checkouts — each ending with the required server restart (installing the model while the
  server is running never takes effect on Node 24).
- **Embedder/reranker load failures have stable semantics** ([#45]). A missing
  `@huggingface/transformers` stays a stable coded error (restart after install), while
  transient load failures (e.g. a flaky model download) are no longer cached and can succeed
  on retry.

### Added

- **`calibre_ping` semantic status block** ([#48]) for one-call diagnosis: model id and
  dimension, dependency installed (disk-level check), in-process load state, model cache
  presence, indexed book/vector counts, and a restart-required flag — mirrored into the text
  response.
- Docs: firsthand probe of Node 24's failed-import negative caching
  (`docs/node24-import-retry-probe.md`, [#44]).
- The calibre-mcp skill now documents `calibre_merge_books` (tool map: 16).

## [0.5.0] — 2026-07-19

### Added

- **`calibre_merge_books`** ([#50]) — merge duplicate book records, mirroring Calibre's GUI
  merge (M / Alt+M / Shift+M): moves formats from source books into an explicit target
  (target's copy wins conflicts), merges metadata per Calibre's per-field rules (fill-if-empty,
  tag/identifier unions computed client-side, `\n\n`-concat comments, full custom-column
  support by datatype), then trashes the sources — always recoverable, never `--permanent`.
  `mode=safe` keeps sources, `mode=formatsOnly` moves formats only. Dry-run plan (survivor,
  per-format disposition, metadata diff, advisory dissimilarity warning) unless `confirm=true`;
  execution is a step ledger with delete always last, so a partial failure never loses data
  and re-running safely completes the merge ([#33] semantics). 17th model-facing tool, gated
  behind `CALIBRE_MCP_ENABLE_WRITE`.

### Fixed

- **`calibre_update_book` could report a committed write as failed** ([#33]). Routed writes
  commit server-side before `calibredb` replies, so a failing post-write re-read or a CLI
  timeout could turn a successful write into a tool error. The diff re-read now degrades to a
  success result with the intended-value diff, and CLI timeouts are verified against a re-read:
  confirmed writes report success, unconfirmed ones steer the model to check with
  `calibre_get_book` before retrying. The same verify-on-timeout treatment applies to the
  `calibre_bulk_update` apply loop.
- **`calibre_list_categories` rejected `(?i)`-style inline flags in `valueFilter`** ([#30]).
  JS `RegExp` doesn't accept PCRE/Python inline flags, so patterns like `(?i)o.?reilly|packt`
  failed with "Invalid group" — despite matching already being case-insensitive. Leading
  `(?flags)` groups are now stripped and folded into the RegExp flags; flags JS can't express
  (e.g. `x`) get an explicit message instead of a parser error. Mid-pattern (scoped) inline
  flags are still rejected, since JS has no equivalent.

[#30]: https://github.com/caelum29/calibre-mcp/issues/30
[#33]: https://github.com/caelum29/calibre-mcp/issues/33
[#41]: https://github.com/caelum29/calibre-mcp/issues/41
[#44]: https://github.com/caelum29/calibre-mcp/issues/44
[#45]: https://github.com/caelum29/calibre-mcp/issues/45
[#46]: https://github.com/caelum29/calibre-mcp/issues/46
[#47]: https://github.com/caelum29/calibre-mcp/issues/47
[#48]: https://github.com/caelum29/calibre-mcp/issues/48
[#50]: https://github.com/caelum29/calibre-mcp/issues/50

## [0.4.2] — 2026-07-19

### Added

- **`calibre_get_content` gains a numeric `offset` param** ([#28]). Jump straight to a char
  position — e.g. a search passage's `charStart` — instead of hand-encoding a cursor token.
  Mutually exclusive with `cursor`, tolerant coercion, and an explicit error when the offset is
  past the end of the book. The "Invalid cursor" error and the `calibre_semantic_search` header
  hint now point to `offset`, closing the search→content interop gap.

### Fixed

- **`structure=true` returned generic `Chapter N` placeholders instead of real chapter titles**
  ([#29]). Bare headings are now enriched with the title line typeset below them, and per-page
  running headers no longer steal the chapter start from the real titled heading.

[#28]: https://github.com/caelum29/calibre-mcp/issues/28
[#29]: https://github.com/caelum29/calibre-mcp/issues/29

## [0.4.1] — 2026-07-18

### Fixed

- **`calibre_get_content` forward pagination was unusable in clients that drop
  `structuredContent`** ([#26]). The `nextCursor` token now also appears in the text block
  ("More remains — continue with cursor: `<token>`"), so pagination works even when a client
  only surfaces the text content. Invalid or hand-constructed cursors (e.g. `char:N`) now return
  an actionable error instead of silently restarting at offset 0, and a cursor minted for a
  different book/format errors explicitly rather than returning wrong content. The `structure=true`
  chapter table now includes a cursor column, and the `cursor` param is documented as an opaque
  token to be passed back verbatim.

[#26]: https://github.com/caelum29/calibre-mcp/issues/26

## [0.4.0] — 2026-07-18

### Added

- **In-chat cover board widget** on `calibre_search` and `calibre_semantic_search` (library
  scope only) ([#19], [#22], D-017). A vanilla-JS carousel rendered via MCP Apps (`io.mcp/ui`
  extension, SEP-1865), with covers loaded from the Content Server thumbnail endpoint and a
  generated placeholder fallback for books without one. Supports keyboard navigation; a Read
  button opens the book directly in Calibre's server UI via `ui/open-link`. Only renders on
  hosts that support MCP Apps — other clients get the plain text/resource_link result unchanged.
- **Book detail card widget** on `calibre_get_book`: cover, rating, series, a facts grid, tags,
  per-format Read buttons, and a "Similar" action that kicks off a semantic-search follow-up.
- **`include_cover` param on `calibre_get_book`** (default `false`) — opt in to a base64 cover
  image block in the tool result for clients that want it inline without the widget.

[#19]: https://github.com/caelum29/calibre-mcp/issues/19
[#22]: https://github.com/caelum29/calibre-mcp/issues/22

### Changed

- Added a widget-internal `calibre_board_data` tool (hidden from the model via
  `_meta.ui.visibility: ["app"]`), backed by a server-side board cache, so the cover-board widget
  can still fetch its data on hosts (e.g. Claude Desktop) that strip `structuredContent` from the
  tool-result notification. The model-facing tool surface stays at 15 tools + ping.

## [0.3.0] — 2026-07-18

### Added

- **Front-matter demotion in `calibre_semantic_search scope=book`** ([#18]). TOC, praise-page,
  and foreword text is keyword-dense but semantically empty, so it used to win exactly the
  definitional queries ("what is a bounded context") where body content is wanted. Chunks that
  lie mostly before the first detected chapter are now flagged `front_matter` at index time
  (additive schema migration — existing indexes keep working, books pick the flag up on
  re-index) and are stable-partitioned below body matches after the rerank stage, labeled
  `[front matter]`, with a note in the header. Nothing is filtered out — foreword/TOC queries
  still work. Validated by the new `front-matter-trap` retrieval-eval kind (D-016).
- **`calibre_search scope=book` now steers definitional queries to the semantic path**: the
  tool description warns that calibredb FTS snippets often land in front matter, and when the
  target book has a semantic index the result includes an in-band tip pointing at
  `calibre_semantic_search scope=book`.

[#18]: https://github.com/caelum29/calibre-mcp/issues/18

### Fixed

- **Large books are no longer silently skipped by the indexer.** The book-download cap was a
  hardcoded 64 MB in the HTTP layer that `calibre_build_index` never overrode, so any book whose
  *served* payload exceeded it failed with "Book file exceeds the size limit" — 28 of 795 books
  (3.5%) in a real library. The cap is now configurable via `CALIBRE_MCP_MAX_BOOK_BYTES` and
  defaults to 256 MB. Note the cap must be sized against what the **Content Server serves**, not
  the file on disk: the server can return a far heavier copy (an 8 MB PDF served as 70 MB), which
  is why a seemingly generous disk-sized limit still dropped books.
- **EPUB extraction no longer dies on modern CSS.** Calibre's own markdown text writer raises
  `ValueError: could not convert string to float: 'calc(1em / 2)'` on ebooks using `calc()`, which
  failed extraction outright and dropped the book from the index. `ebook-convert` now retries once
  with `--txt-output-formatting=plain` when markdown conversion fails, keeping markdown (whose
  headings chunking relies on) as the preferred path. Timeouts are not retried.

## [0.2.1] — 2026-07-11

### Added

- **structuredContent mirroring for semantic search and content extraction** —
  `calibre_semantic_search` now mirrors ranked hits into `structuredContent`
  (`results[]` for library scope, `passages[]` for book scope), and
  `calibre_get_content` mirrors its excerpt into `structuredContent.text`.
  Structured-only MCP clients that drop text content blocks no longer lose the
  actual search/read payload.

### Changed

- **`localWrite` classification for index-directory writes** — `calibre_build_index`
  writes the server's own semantic-index directory, not the user's library, so it's
  intentionally left ungated. That carve-out is now explicit via a new
  `ToolDescriptor.localWrite` marker plus a boot-time invariant
  (`assertWriteClassification()`) that fails loud if any non-read-only tool declares
  neither `write` nor `localWrite` — no more silently unclassified mutators.

## [0.2.0] — 2026-07-09

The semantic-search suite. **Breaking for existing indexes**: `INDEX_VERSION` bumped
2 → 3 (chunking v3 changes chunk boundaries) — run `calibre_build_index` again to
rebuild before using semantic/hybrid search.

### Added

- **Cross-encoder rerank stage** (`bge-reranker-v2-m3`, q8) — always-on second pass for
  hybrid and vector search results, pool cap 30 candidates, model pre-downloaded at
  build time, `CALIBRE_MCP_RERANK` env var as an escape hatch to disable it (D-011).
- **Chunking v3** — drops the old fixed-overlap window and budgets chunks in real
  model tokens instead of characters, for tighter and more consistent chunk sizes.
  `INDEX_VERSION` is now `3`; existing indexes must be rebuilt.
- **Weighted FTS + hybrid fusion** — a new `book_meta` FTS column (weighted bm25) feeds
  a weighted-RRF fusion seam alongside vector search, improving keyword/metadata recall
  in hybrid mode.
- **Golden-query retrieval eval harness** — 50 labeled EN+RU queries over a fixture
  corpus (`pnpm eval`), with committed baseline, reranker, and model-bake-off reports
  for regression tracking.
- Per-library candidate-vector cache for faster repeat semantic queries.

### Changed

- Semantic embedding model reaffirmed as `multilingual-e5-small` after a model
  bake-off against alternatives (D-012/D-013).

### Fixed

- `bookId` is now accepted as an alias for `id` on single-book tools.
- nDCG@k no longer double-counts label credit on duplicate-label positions (could
  previously exceed 1.0).

## [0.1.6] — 2026-07-07

### Added

- **`calibre_get_content` `structure` param + `calibre-distill` skill** (idea 08) — the
  extractor can now return a book's chapter structure (heading detection with Cyrillic
  chapter-word support and ToC awareness), and a companion `calibre-distill` skill turns a
  single book into a compressed, cursor-linked Agent Skill. No new tool (one param on an
  existing tool); tool count stays at 15.
- **`calibre-distill-topic` companion skill** — multi-book topic synthesis (the D1.7
  distributable artifact class): synthesizes one topic across ≥3 library books into a
  single concept-keyed Agent Skill with a mandatory "where the sources disagree or
  complement" section, an ISBN bibliography-as-L4 block, and a `kind: topic-aggregate`
  `distill.manifest.yaml`. Zero new MCP tools; cross-linked both ways with
  `calibre-distill`.
- **Legal-gate verifier** (`src/domain/distill/legal-gate.ts` + `scripts/legal-gate.mjs`) —
  mechanical D1.4 admission checks for generated distill skills: 8-gram verbatim-shingle
  overlap (with title/author allowlist), quote budget (25 words/quote, 200/skill), ≥20×
  compression floor, heading-match (L4 block exempt), content-cursor leak detection, and
  attribution presence. CLI reads the skill dir + manifest, pulls source text via the
  Content Server, prints a per-check report, exits 0/1. Zero new deps, zero new tools.

### Changed

- **`calibre-distill` skill: Rule 7 enforced** — the Step 7 verbatim-reproduction
  instructions (exact-syntax code examples, reproduced tables, faithful worked examples,
  verbatim chapter headings) are replaced with re-authoring instructions; Quality Rule 7
  gains a numeric quote budget (25 words/quote, 200/skill) and generated skills now carry
  a mandatory attribution block ("buy the book" line included).

### Docs

- `docs/PRODUCT-DECISIONS.md`: D1.7 prototype-validation findings folded in; **D3**
  resolves the registry shape (git-convention rail on GitHub surfaced as a Claude Code
  plugin marketplace, single regenerated index file, PR → CI legal-gate submission,
  zero-overhead private half). PRODUCT-VISION §8 items 1–3 marked resolved.

## [0.1.5] — 2026-07-02

### Added

- **`calibre_extract_isbn`** — the kiwidude Extract-ISBN capability. Scans a book's own
  text (front matter, then back-matter tail) for a checksum-valid ISBN and stamps it into
  the `isbn` identifier. Gated write, preview-first: `apply=false` (default) reports the
  ISBN found without writing; `apply=true` writes it. Merges into existing identifiers so
  a `doi`/`asin` is never clobbered. This brings the tool count to 15.

### Changed

- The ISBN text-scanner (shared by `calibre_extract_isbn` and `calibre_recover_metadata`)
  is hardened to match the kiwidude plugin's behaviour: prefer ISBN-13 over ISBN-10,
  require a Bookland prefix (977/978/979) on 13-digit runs, reject all-same-digit runs
  (which pass the ISBN-10 checksum), and scan front matter then the tail. This also
  sharpens `calibre_recover_metadata`'s lookup key.

## [0.1.4] — 2026-07-02

### Fixed

- `calibre_add_book` no longer hangs. Adding a book routed through the Content Server
  spawned a Calibre import worker whose orphaned process kept the library write lock,
  hanging the tool (~4 min) and stalling other tools' reads afterward. Subprocesses are
  now run in their own process group and force-killed as a group on timeout, so nothing
  is left holding the lock. The same hardening applies to text-extraction conversions
  (`ebook-convert`), and `calibre_add_book` now allows up to 120s for genuinely slow
  imports/conversions.

## [0.1.3] — 2026-07-02

Hardening pass from an integration smoke-test run — no breaking changes.

### Added

- `calibre_build_index` now supports a **keyword-only** index build path, so building
  a search index no longer requires the optional `@huggingface/transformers`
  (embeddings) dependency to be installed.

### Fixed

- `calibre_semantic_search` now gives honest, actionable messaging in keyword-only
  mode instead of implying vector/semantic results are available.
- `calibre_recover_metadata`'s ISBN text-scan is now bounded, so it can no longer hang
  the stdio server on pathological book text.
- Resolved a hang in `calibre_find_duplicates` / `calibre_quality_report` on large
  libraries.

### Performance

- `select-books` now fetches `/ajax/books` in parallel batches (instead of serially)
  and logs per-stage timing to stderr, speeding up any tool that selects books by
  query (`calibre_bulk_update`, `calibre_find_duplicates`, `calibre_quality_report`,
  `calibre_build_index`).

## [0.1.2] — 2026-07-02

### Fixed

- MCPB: a blank optional config field with no manifest default (e.g. **calibredb
  binary**) could leak its raw `${user_config.x}` placeholder into the environment
  un-substituted. The server treated that literal as a real value, so `calibredb`
  auto-detection never ran and every call failed with `calibredb not found at
  "${user_config.calibredb_path}"`. Blank fields now correctly fall through to
  auto-detect (`calibredb_path`, `library`, `index_dir`, `add_roots`).

## [0.1.1] — 2026-07-02

### Added

- Published to the official [MCP Registry](https://registry.modelcontextprotocol.io) as
  `io.github.caelum29/calibre-mcp` (`server.json`).
- Automated release pipeline: on a `v*` tag, CI publishes to npm (with provenance),
  attaches the `.mcpb` bundle to the GitHub release, and updates the MCP Registry.

No functional changes to the server.

## [0.1.0] — 2026-07-02

First public release.

### Added

- **15 tools** over the Calibre Content Server (stdio transport):
  - Read: `calibre_search` (metadata + full-text, library- or book-scoped),
    `calibre_get_book`, `calibre_get_content` (cursor-walkable excerpts),
    `calibre_list_categories`, `calibre_list_libraries`, `calibre_ping`
  - Semantic: `calibre_semantic_search` (hybrid vector + keyword retrieval,
    multilingual `multilingual-e5-small` embeddings, RU/EN cross-lingual),
    `calibre_build_index`
  - Curation: `calibre_find_duplicates` (merge-safety scoring),
    `calibre_quality_report`, `calibre_recover_metadata` (Open Library →
    Google Books, preview-only)
  - Write (gated off by default): `calibre_update_book`, `calibre_bulk_update`
    (selection required, preview-first), `calibre_add_book` (path-whitelisted),
    `calibre_remove_book` (confirm-required dry-run)
- Library auto-detection (server default via `/ajax/library-info`) and
  cross-platform `calibredb` discovery (macOS / Windows / Linux / `PATH`).
- npm package (`npx calibre-mcp`) and Claude Desktop one-click `.mcpb` bundle
  (embeddings excluded from the bundle to stay small; available via npx).
- Serialization-hardened inputs (Zod coercion on every tool) against the
  known client-side `-32602` args-as-strings bug.

[0.1.1]: https://github.com/caelum29/calibre-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/caelum29/calibre-mcp/releases/tag/v0.1.0

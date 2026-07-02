# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

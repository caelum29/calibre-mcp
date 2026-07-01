# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/caelum29/calibre-mcp/releases/tag/v0.1.0

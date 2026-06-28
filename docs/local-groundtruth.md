# Local ground-truth probes (Calibre 9.10, macOS, this machine — 2026-06-27)

Captured by directly invoking the installed Calibre and its running Content Server.
These are authoritative for the user's actual environment.

## Environment
- `calibredb (calibre 9.10)` at `/Applications/calibre.app/Contents/MacOS/calibredb` (aliased; also ebook-convert, ebook-meta, calibre-server, fetch-ebook-metadata).
- Node v24.15.0.
- Two libraries: `Programming Books` (default, **801 books**) and `Reaserch Books`, both under `~/Documents/Books/`.
- Calibre **GUI is running** + a **Content Server on localhost:8080** (PID confirmed via lsof).

## calibredb subcommands (v9.10)
list, add, remove, add_format, remove_format, show_metadata, set_metadata, export, catalog,
saved_searches, add_custom_column, custom_columns, remove_custom_column, set_custom,
restore_database, check_library, list_categories, backup_metadata, clone, embed_metadata,
search, fts_index, fts_search.

### `list` (read)
- `--for-machine` → JSON array of objects. `--fields all` or comma list. Custom fields via `*name` (e.g. `*rating` for `#rating`).
- builtin fields: author_sort, authors, comments, cover, formats, identifiers, isbn, languages, last_modified, pubdate, publisher, rating, series, series_index, size, tags, template, timestamp, title, uuid.
- `--search` accepts the search-query language; `--sort-by`, `--limit`, `--template`.

### `search` (read)
- Returns comma-separated list of matching book ids (feed into other commands).

### `show_metadata` (read)
- `--as-opf` → OPF XML. Otherwise human text. (No JSON flag.)

### `set_metadata` (WRITE)
- `--field name:value` (repeatable) OR an OPF file. `--list-fields` to enumerate.
- identifiers syntax: `--field identifiers:isbn:XXXX,doi:YYYY`. booleans: true/false. languages: ISO639.
- **This is the canonical safe write path** (the brief's CLI workaround for the Cowork serialization bug).

### `fts_index` (write/maintenance)
- `enable | disable | status | reindex [ids...]`. `--wait-for-completion`, `--indexing-speed=fast|slow`.
- **Local FTS status right now: `Integration status: False` → FTS NOT enabled on this library.**

### `fts_search` (read)
- `--output-format=text|json` ✅ (machine-readable JSON available).
- `--include-snippets` (with `--match-start-marker`/`--match-end-marker`) — slower.
- `--restrict-to=ids:1,2,3` or `--restrict-to=search:tag:foo`.
- `--do-not-match-on-related-words`, `--indexing-threshold` (default 90%).
- NOTE: snippets give surrounding text + match markers; whether a precise PDF page / EPUB spine locator is returned needs confirmation (FTS not enabled here to test live) — flagged for web research.

### `list_categories` (read)
- Tag-browser equivalent. `--csv`, `--item_count`, `--categories=`.

### custom columns
- `add_custom_column name label datatype` / `custom_columns` (list) / `remove_custom_column` / `set_custom` (write a custom field value).

## GUI concurrency lock — CONFIRMED
With the Calibre GUI running, `calibredb --with-library <path> list` fails with:
> "Another calibre program such as calibre-server or the main calibre program is running. Having multiple programs that can make changes to a calibre library running at the same time is a bad idea. calibredb can connect directly to a running calibre Content server, to make changes through it, instead."

→ Direct CLI/SQLite access races the GUI. The supported concurrency-safe path while GUI is open is to point calibredb at the **Content Server URL** (`--with-library http://localhost:8080/#Library_Id`) or use the Content Server HTTP API directly.

## Content Server `/ajax/` REST API (live shapes)
Base: `http://localhost:8080`. No auth configured here (LAN/local).

- `GET /ajax/library-info` →
  `{"library_map": {"Programming_Books":"Programming Books","Reaserch_Books":"Reaserch Books"}, "default_library":"Programming_Books"}`
- `GET /ajax/search?query=rust&num=3` →
  `{"total_num":84, "num_books_without_search":801, "offset":0, "num":3, "sort":"title", "book_ids":[658,814,704], "library_id":"Programming_Books", "vl":""}`
  (query uses the Calibre search-query language; returns ids only — paginated.)
- `GET /ajax/categories` → array of category nodes (Authors, Languages, Tags, Series, …) each with hex-encoded `/ajax/category/<hex>/<lib>` url.
- `GET /ajax/book/<id>/<library_id>` → full metadata object. TOP KEYS:
  `application_id, author_sort, author_sort_map, authors, category_urls, comments, cover, format_metadata, formats, identifiers, languages, last_modified, link_maps, main_format, other_formats, pages, pubdate, publisher, rating, series, series_index, tags, thumbnail, timestamp, title, title_sort, user_categories, user_metadata, uuid`
  - `identifiers` → `{"isbn":"9780473679750"}`; `formats` → `["pdf"]`; `user_metadata` → custom-columns container (empty = none defined on this library).
- Also exists (per manual, not all probed): `/ajax/books` (bulk by ids), `/ajax/category/<hex>/<lib>`, `/get/<fmt>/<id>/<lib>` (download), `/get/cover/<id>/<lib>`.

Implication: the Content Server is the **GUI-concurrency-safe read API** and is already running on this machine — strong candidate for the read path; writes over HTTP require enabling auth + write permissions (to verify in web research).

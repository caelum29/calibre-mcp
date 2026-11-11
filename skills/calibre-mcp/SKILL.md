---
name: calibre-mcp
description: "Search, read, and curate your Calibre ebook library. The operating manual for the calibre-mcp server (19 tools) with the calibre CLI as escape hatch. Covers picking the right search (metadata query vs full-text vs semantic), reading book content, chapter maps and book figures, gated preview-first writes (metadata, tags, bulk edits), deduplication, quality audits, ISBN extraction + metadata recovery, add/remove/merge books, semantic-index builds, and safe CLI routing through the Content Server while the Calibre GUI is running (convert, export, catalog). Use for any ebook/library task: finding books, searching inside them, curating metadata, or maintenance. Triggers on 'book', 'ebook', 'calibre', 'library', 'книга', 'бібліотека', 'знайди в книзі'."
---

# Calibre MCP Skill

Two interfaces, in priority order:
1. **`calibre-mcp` MCP tools** (`calibre_*`) — primary. Search, semantic search, content
   extraction, metadata writes, dedupe, quality, enrichment. All inputs are Zod-coerced
   server-side, so stringified numbers/arrays/objects from the client are handled.
2. **Calibre CLI via shell** — escape hatch for operations the server intentionally defers
   (convert, export, catalog, maintenance). See "CLI escape hatch" below.

Libraries: discover them with `calibre_list_libraries` (names and IDs differ per user; the
default library is used when none is given). Examples below use a library named `My Books` with
ID `My_Books`. Calibre GUI + Content Server on `:8080` are normally running.

## Hard rules

- **Metadata writes go through MCP tools** (`calibre_update_book`, `calibre_bulk_update`) —
  the old `-32602` serialization bug is fixed by server-side coercion. No CLI workaround needed.
- **CLI writes/reads while the GUI is open MUST route through the running Content Server**:
  `calibredb --with-library 'http://localhost:8080/#My_Books'` (library **ID** after `#`,
  not the display name — the display form 404s). **Never** use `--library-path` on a live GUI
  library — the concurrency lock makes direct DB access refused or dangerous.
- Writes are gated by `CALIBRE_MCP_ENABLE_WRITE`. With it off, previews and dry-runs still work;
  the applying call returns `write_disabled` (tell the user, don't retry), and
  `calibre_update_book` / `calibre_add_book` are not listed at all.
- Destructive/bulk ops are preview-first: `calibre_bulk_update` defaults `preview:true`,
  `calibre_remove_book` and `calibre_merge_books` default `confirm:false` (dry-run),
  `calibre_extract_isbn` defaults `apply:false`, `calibre_manage_bundles` defaults `confirm:false`. Show the preview, get user confirmation,
  then re-call with the apply flag.
- All tools take an optional `library` param (display name is fine); omitted = default library.

## Tool map (18)

| Tool | Purpose | Key params |
|---|---|---|
| `calibre_search` | Find books by metadata or full text; also keyword search *inside* one book; highlights/bookmarks and author/series/tag notes (Calibre 9.18+) | `query`, `mode: meta\|fts\|annotations\|notes`, `scope: library\|book`, `bookId`, `sort`, `limit`, `cursor`, `filter` (bundle), `include_excluded` |
| `calibre_get_book` | Full metadata + formats + cover for one book | `id` (number or uuid) |
| `calibre_get_content` | Read book text chunk-by-chunk without flooding context | `id`, `maxChars` (default 8k, max 40k), `cursor`, `structure` (outline), `sentenceAware` |
| `calibre_get_figures` | List a book's captioned figures (location: PDF page `p.N`, EPUB spine section `§N`), then fetch ≤3 as images (also rendered for the user in an in-chat figure viewer on MCP Apps hosts) | `id`, `indexes` (omit to list), `detail: standard\|high`, `include_uncaptioned`, `format` |
| `calibre_list_categories` | Tags/authors/series/etc. values + counts; schema discovery | `field`, `valueFilter` (regex), `limit`, `cursor` |
| `calibre_list_libraries` | Library map + default | — |
| `calibre_semantic_search` | Meaning-based search across the library or within one book | `query`, `scope: library\|book`, `bookId`, `mode: hybrid\|vector\|keyword`, `topK`, `filter` (bundle), `include_excluded` |
| `calibre_build_index` | Build/refresh the semantic index (needed before semantic search) | `ids`/`query`/`bookId` to scope, `force`, `enableFts` (turn on Calibre FTS; needs writes enabled, else `fts.status: write_disabled`), `keywordOnly` |
| `calibre_find_duplicates` | Dup detection | `mode: identical\|similar\|compare`, `ids`, `query`, `filter` (bundle) |
| `calibre_quality_report` | Library audit: missing metadata, rule violations | `checks`, `ids`/`query`/`filter` |
| `calibre_recover_metadata` | Propose metadata for raw-filename books (ISBN → OpenLibrary → Google Books) | `id`, `sources` — returns a *proposal*; apply via `calibre_update_book` (needs writes enabled) |
| `calibre_update_book` | Write metadata for one book | `id`, `changes` (object incl. `#custom` fields) |
| `calibre_bulk_update` | Same change across many books | `changes` and/or `tags_add`/`tags_remove`, `ids` OR `query` OR `filter` (one required), `preview` |
| `calibre_add_book` | Import a file (path must be under the whitelisted roots) | `path` |
| `calibre_remove_book` | Delete books | `ids`, `confirm` |
| `calibre_merge_books` | Merge duplicate records: formats + metadata into a target, sources → trash | `targetId`, `sourceIds`, `mode: merge\|safe\|formatsOnly`, `confirm` |
| `calibre_extract_isbn` | Scan book text for ISBN, optionally write it | `id`, `apply` |
| `calibre_manage_bundles` | Bundles = named topical filters (Calibre saved searches); `-name` = exclusion marker. Lists virtual libraries read-only — never creates one | `action: list\|create\|update\|delete`, `name`, `expression`, `confirm` |

## Bundles (topical filters)

Bundles are named filters backed by Calibre saved searches (`calibre_manage_bundles`; `list` works with writes off).
Use them to scope work to a topic instead of the whole 800-book library:

- **Topical query → try the matching bundle first.** "What do my databases books say about X?" →
  `calibre_semantic_search { query: "X", filter: "databases" }`. An unknown filter name errors
  with the list of available bundles — that error IS the discovery mechanism, don't pre-list.
- **Exclusion markers**: bundles named `-something` are auto-subtracted from discovery searches
  (`calibre_search`, `calibre_semantic_search` library scope). The result always says what was
  subtracted (`exclusions applied: […]`); pass `include_excluded: true` to see everything.
  Targeting the marker itself (`filter: "-outdated"`) shows exactly its books.
- **Maintenance sees everything**: `quality_report`/`find_duplicates`/`bulk_update` accept
  `filter` but never auto-subtract markers — noise books need curation most.
- Filtering is query-time; creating/changing bundles needs no re-index.

## Tag Convention

Short, lowercase, consistent tags:

**Language/Runtime:** `javascript`, `typescript`, `rust`, `python`, `sql`, `html-css`
**Framework/Tool:** `nodejs`, `nestjs`, `react`, `kafka`, `kubernetes`, `docker`, `git`, `graphql`, `excel`
**Domain:** `databases`, `ai`, `llm`, `machine-learning`, `data-science`, `devops`, `cloud`, `networking`
**Practice/Pattern:** `architecture`, `design-patterns`, `ddd`, `testing`, `refactoring`, `oop`, `algorithms`
**Topic:** `performance`, `security`, `concurrency`, `distributed-systems`, `web-development`
**Meta:** `reference` (pocket guides, cookbooks), `beginner`, `advanced`

Rules:
- Lowercase with hyphens: `machine-learning` not `Machine Learning`
- Prefer short specific tags: `sql` not `Sql, Databases, Computers, General`
- 2–5 tags per book is ideal
- Clean up verbose auto-imported tags from metadata services
- `+needs-description` is a system tag for books missing comments

## Search Query Syntax

For `calibre_search` with `mode: meta` (and `calibredb list --search`):

```
author:Asimov                        # field-specific
title:"The Ring"                     # phrase
format:epub publisher:oreilly        # multiple fields
author:Asimov and not series:Robot   # boolean
tags:"=javascript"                   # exact match (= prefix)
title:"~^Java.*Script$"              # regex (~ prefix)
rating:">3"                          # comparison
pubdate:">2024"                      # date filter
date:lastmonth  date:thisyear  date:lastyear   # Calibre 9.18+
date:>2monthsago  date:>1yearsago              # Calibre 9.18+ (number in front)
```

Maintenance queries:
```
date:>7daysago      # recently added
rating:false        # no rating
tags:false          # no tags
cover:false         # no cover
formats:false       # no files
identifiers:false   # no ISBN etc.
```

## Key Details

- **Rating**: 0–10 internally (0,2,4,6,8,10 → 0–5 stars). `changes: {rating: 10}` = 5 stars.
- **Custom fields**: `#` prefix in `changes` (e.g. `#read_status`).
- **Book files on disk**: `<library_path>/<book_path>/<filename>.<format>` — get `path` and
  `formats` from `calibre_get_book` to build the full filesystem path.
- **PDF quality**: text-based PDFs (O'Reilly, Manning) extract fine; scanned PDFs produce
  empty/garbled text — Calibre has no OCR.
- **Semantic search**: if it reports no/partial index, run `calibre_build_index` first
  (scoped to `ids`/`query` for speed, or full library).

## Common Workflows

**Find info about a topic across books:**
`calibre_semantic_search` (meaning) or `calibre_search mode:fts` (exact terms) →
then drill into a hit: `calibre_search scope:book bookId:N` or
`calibre_semantic_search scope:book` → `calibre_get_content` for full passages.

**Read a whole book / big sections:**
`calibre_get_content` with `structure:true` first for the outline, then walk with `cursor`.

**Update metadata:**
`calibre_update_book` with `changes: {tags: [...], title: "...", rating: 8}`.

**Batch tag by search:**
`calibre_bulk_update` with `query: "title:SQL"` and `tags_add: ["SQL"]` (keeps each book's other
tags; `changes: {tags: [...]}` would replace them) — review the preview, then re-call with
`preview:false`. Show the user any preview `⚠` lines (`books[].warnings`): a list that
replaces the whole list, or a case-only rename that renames a tag on every book.

**Read a write result before reporting it:**
- `applied` = written. `unchanged` (tags_add / tags_remove calls only) = nothing would change on
  that book (the tag merge and any `changes` fields), so it was skipped, not written. Report these
  as "already current", not as failures.
- `confirmedByReRead` (`{id, cause: "dropped" | "timeout"}` in bulk, `"dropped" | "timeout"` on
  `calibre_update_book`) = the call timed out or lost its connection, but a re-read showed every
  requested value. It is a success; the text says "Confirmed by a re-read".
- `failed` entries, or a `write_unverified` error, that say "verify with calibre_get_book" may
  have committed. Check the book with `calibre_get_book` before any retry. Never re-run blindly.
- A stopped bulk run (refused / server unreachable) lists `retryIds`: re-run with exactly those ids.

**Fix a raw-filename book (e.g. `795731065.pdf`):**
`calibre_extract_isbn` (preview) → `calibre_recover_metadata` → confirm with user →
`calibre_update_book` with the proposed fields. With writes off, show the user the proposal and
tell them applying it needs `CALIBRE_MCP_ENABLE_WRITE`.

**Dedupe:**
`calibre_find_duplicates mode:similar` → inspect groups with `mode:compare ids:[...]` →
`calibre_merge_books` with `targetId` = the compare report's "recommend keeping book N" and
the rest as `sourceIds` (dry-run plan → confirm with user → `confirm:true`). A
`⚠ REVIEW` line (mixed languages, possibly different editions, not the same work) means ask the
user before merging, whatever the score. Formats move to
the target (its copy wins), metadata merges per Calibre's rules, sources land in Calibre's
trash (recoverable ~14 days). `mode:safe` keeps sources; plain `calibre_remove_book` is for
discarding a record without keeping anything from it.

**Library cleanup sweep:**
`calibre_quality_report` → fix per issue class (tags via bulk_update, ISBNs via extract_isbn,
metadata via recover_metadata).

**Add a book:**
`calibre_add_book path:"/Users/me/Downloads/file.epub"` (path must be under the allowed
roots; if refused, the error names them).

**Extract book text to a file / send to NotebookLM:**
1. `calibre_get_book` → check formats and disk path
2. If no TXT: shell `ebook-convert "<book file>" "/tmp/book.txt"` (standalone, no library lock)
3. Read the TXT via filesystem; for NotebookLM add via `source_add` (or user uploads manually
   for very large books)

## CLI escape hatch

For operations the MCP server defers. Always through the server URL when the GUI is running:

```bash
LIB='http://localhost:8080/#My_Books'
```

| Operation | Command |
|---|---|
| Convert format | `ebook-convert in.pdf out.epub` (file-level, safe anytime) |
| Export books | `calibredb export --with-library "$LIB" <id> --to-dir ~/Downloads/` |
| Generate catalog | `calibredb catalog ~/Downloads/catalog.csv --with-library "$LIB"` |
| Remove one format | `calibredb remove_format --with-library "$LIB" <id> TXT` |
| Health check | `calibredb check_library --library-path "..."` (**GUI must be closed** — direct DB) |
| Embed metadata into files | `calibredb embed_metadata --with-library "$LIB" all` |
| Fetch metadata online | `fetch-ebook-metadata --title "..." --authors "..."` |
| Inspect file metadata | `ebook-meta file.epub` |

CLI writes require the Content Server to allow local writes (`--enable-local-write` /
GUI preference); if a write is refused, that's the first thing to check. `calibre_ping`'s
`calibre writes:` line (`calibreWriteAccess`) says whether Calibre currently accepts writes.

## Examples

| Request | Action |
|---|---|
| "Які книги по JS є?" | `calibre_search` query: `"javascript"` |
| "В якій книзі є event sourcing?" | `calibre_semantic_search` query: `"event sourcing"` |
| "Where exactly does this book cover CQRS?" | `calibre_search` mode:fts scope:book bookId:N |
| "What did I highlight about commits?" | `calibre_search` mode:annotations query:`"commit"` (Calibre 9.18+; `calibre_too_old` on older) |
| "What do my author notes say about the outbox?" | `calibre_search` mode:notes query:`"outbox"` (notes attach to items: no `filter`) |
| "Show my note on Adam Bellemare" | `calibre_search` mode:notes query:`'authors:"Adam Bellemare"'` (also `series:` / `tags:` / `publisher:` / `#custom:`) |
| "All my highlights in book N" | `calibre_search` mode:annotations scope:book bookId:N query:`"*"` |
| "Rate Vibe Coding 5 stars" | `calibre_update_book` changes: `{rating: 10}` |
| "Зміни теги книги" | `calibre_update_book` changes: `{tags: [...]}` |
| "Tag all SQL books" | `calibre_bulk_update` query:"title:SQL" → preview → apply |
| "Books without tags?" | `calibre_search` query: `"tags:false"` |
| "Знайди дублікати" | `calibre_find_duplicates` |
| "Об'єднай ці дублікати" / "Merge these two records" | `calibre_merge_books` (dry-run plan → confirm with user → `confirm:true`) |
| "Що не так з бібліотекою?" | `calibre_quality_report` |
| "What's this 795731065.pdf book?" | `calibre_extract_isbn` → `calibre_recover_metadata` |
| "Add book from Downloads" | `calibre_add_book` |
| "Delete a book" | `calibre_remove_book` (dry-run → confirm with user → `confirm:true`; unknown ids are reported as not found, never counted) |
| "Show all tags" | `calibre_list_categories` field:"tags" |
| "Convert to EPUB" | shell: `ebook-convert` |
| "Export a book" | shell: `calibredb export --with-library "$LIB"` |
| "Send book to NotebookLM" | ensure TXT (ebook-convert), read file, `source_add` |

## When a tool fails

An `isError` result already says what to do next — follow it. When the cause stays unclear
or the same failure repeats, call `calibre_ping`: its `recent errors` list the server's own
failures with tool and `call` id, plus today's log file path. Its `Index:` line lists every
library as `Name (id: Lib_Id) [default]: …`: pass that id, not the display name, as `library`. With file access, read the
`README.md` beside that log file and trace the failing `call` id; report the logged cause
rather than a guess.

A `library_id_collision` error means two libraries' ids differ only in letter case and the named
one was refused because the other was indexed first. Tell the user which library is refused and
that renaming its folder (then restarting Calibre's Content Server) fixes it; the other library
keeps working. Don't retry the build.

## Reference Documentation

- `calibredb --help` / `calibredb <subcommand> --help` — the authoritative CLI reference for the installed version
- **`docs/TOOLS.md`** (repo) — full tool reference: parameters, defaults, preview/confirm flows
- **`docs/SEMANTIC-SEARCH.md`** (repo) — how the semantic index and hybrid retrieval work
- **`docs/TROUBLESHOOTING.md`** (repo) — symptom-first fixes: connection, model install, write gates, cursors, logs

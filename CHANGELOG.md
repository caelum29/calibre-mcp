# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut by release-please from Conventional Commit messages: each release PR
inserts its generated section above the newest entry. Hand-written notes still go under
`[Unreleased]`; when merging a release PR, fold them into the generated section and leave
`[Unreleased]` empty.

## [0.11.0](https://github.com/caelum29/calibre-mcp/compare/v0.10.0...v0.11.0) (2026-10-30)


### Added

* **observability:** agent-readable JSONL logs, per-call records, ping.recentErrors ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([2d381d0](https://github.com/caelum29/calibre-mcp/commit/2d381d011cbb05483046df3e8aaf16a661322969))
* **observability:** agent-readable JSONL logs, per-call records, ping.recentErrors ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([8b09005](https://github.com/caelum29/calibre-mcp/commit/8b09005d0f35fb0d0c8cd882600b05ddababae2b))
* **semantic:** add EmbeddingGemma 2 candidates (768/256) and bump transformers.js to 4.3.1 ([#139](https://github.com/caelum29/calibre-mcp/issues/139)) ([#209](https://github.com/caelum29/calibre-mcp/issues/209)) ([5883a56](https://github.com/caelum29/calibre-mcp/commit/5883a56bb85ae22405708ebc4b84ddab0490ffce))


### Fixed

* **bulk-update:** collapse per-id errors to one bounded line in text ([#216](https://github.com/caelum29/calibre-mcp/issues/216)) ([5c6c0f8](https://github.com/caelum29/calibre-mcp/commit/5c6c0f8eefb1e68c969c7dcb67c88ae0443b8d0b))
* **bulk-update:** hand back retryIds and a re-run steer after a mid-loop refusal ([#213](https://github.com/caelum29/calibre-mcp/issues/213)) ([70ff746](https://github.com/caelum29/calibre-mcp/commit/70ff746c7840988c396f82b76fb43156e8e6b56f))
* **bulk-update:** keep committed books visible when a write is refused mid-loop ([#213](https://github.com/caelum29/calibre-mcp/issues/213)) ([74496ff](https://github.com/caelum29/calibre-mcp/commit/74496ff10816845b3df2847c7786eaeaea31f618))
* **bulk-update:** reject ids combined with query ([#214](https://github.com/caelum29/calibre-mcp/issues/214)) ([a53602f](https://github.com/caelum29/calibre-mcp/commit/a53602f4f4088a7eeafa3a68479d8a7422032688))
* **curation:** extend raw-filename title heuristics ([#207](https://github.com/caelum29/calibre-mcp/issues/207)) ([53c3f2b](https://github.com/caelum29/calibre-mcp/commit/53c3f2beb0132bffd679b1107f28e59fae60a466))
* **metadata:** authors are weak only when every entry is suspect ([#201](https://github.com/caelum29/calibre-mcp/issues/201)) ([3b97334](https://github.com/caelum29/calibre-mcp/commit/3b97334d8cec779eb8a9d846f71ee035ca538634))
* **metadata:** ISBN/metadata recovery heuristics ([#198](https://github.com/caelum29/calibre-mcp/issues/198) [#201](https://github.com/caelum29/calibre-mcp/issues/201)) ([a40cf04](https://github.com/caelum29/calibre-mcp/commit/a40cf0481593a12243cb61f104e8733d883c3731))
* **metadata:** loosen title agreement to subset or 1/3 overlap with EN/RU stop-words ([#198](https://github.com/caelum29/calibre-mcp/issues/198)) ([fa246b2](https://github.com/caelum29/calibre-mcp/commit/fa246b2b95717d458e66941068f0706bc11c85ec))
* **metadata:** normalize provider authors, flag suspect authors, drop author-as-publisher, emit ISBN-13 ([#201](https://github.com/caelum29/calibre-mcp/issues/201)) ([541e980](https://github.com/caelum29/calibre-mcp/commit/541e9805f057604719e1035bf6c9ffde11a311df))
* **metadata:** skip ad/catalog ISBNs and flag title-mismatched hits ([#198](https://github.com/caelum29/calibre-mcp/issues/198)) ([b58e5bf](https://github.com/caelum29/calibre-mcp/commit/b58e5bfc456a20c9befd9a829ced9920ed73e320))
* **metadata:** titles agree on subset or 2+ shared significant words ([#198](https://github.com/caelum29/calibre-mcp/issues/198)) ([21f06cc](https://github.com/caelum29/calibre-mcp/commit/21f06cca685a37c1de44cc02e542766076a61d33))
* **metadata:** treat empty and absent field values as equal ([#202](https://github.com/caelum29/calibre-mcp/issues/202)) ([d87ddb8](https://github.com/caelum29/calibre-mcp/commit/d87ddb875203921aad0be6f87281e7cfbcb71422))
* **observability:** address review of [#250](https://github.com/caelum29/calibre-mcp/issues/250) — retention, prune race, ping parity ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([221c23c](https://github.com/caelum29/calibre-mcp/commit/221c23c38dec0e2b3dddeba80cccb69ab4505aaf))
* **observability:** land [#250](https://github.com/caelum29/calibre-mcp/issues/250)'s live-test fixes — argv/diag redaction, semantic availability logs ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([2a07be3](https://github.com/caelum29/calibre-mcp/commit/2a07be3ba8a51d5a99a7669ccd8ecc35693411d7))
* **observability:** live-test findings — redact calibredb argv, log semantic availability ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([b0e95f0](https://github.com/caelum29/calibre-mcp/commit/b0e95f0d9245523e5bc3d936f57e75a42786a326))
* **observability:** scrub argv echoes from calibredb diag in logs ([#247](https://github.com/caelum29/calibre-mcp/issues/247)) ([fd60cf0](https://github.com/caelum29/calibre-mcp/commit/fd60cf0132f98eabab1467480406a159fc907c44))
* P1 polish — 401 write refusal, update_book changed-only summary, parity for 3 more tools ([bae5ae4](https://github.com/caelum29/calibre-mcp/commit/bae5ae416251f03599e8bb8e06ccc097844ca614))
* **parity:** name the book id in book-scope search text and the indexed ids in build_index text ([#234](https://github.com/caelum29/calibre-mcp/issues/234)) ([46f8b25](https://github.com/caelum29/calibre-mcp/commit/46f8b25d13aabd41929afbecbebbc8e82c2bd5e8))
* **quality-report:** coerce stringified readability boolean ([#212](https://github.com/caelum29/calibre-mcp/issues/212)) ([831aea3](https://github.com/caelum29/calibre-mcp/commit/831aea3cfafddd9856e407855db16bead1de8387))
* **tools:** mirror quality issues, FTS snippets, dup groups and compare diff into structuredContent ([#199](https://github.com/caelum29/calibre-mcp/issues/199)) ([d73101f](https://github.com/caelum29/calibre-mcp/commit/d73101f644dce78b10aabed5fc2c03a1403313ba))
* **tools:** one result model for text + structuredContent ([#212](https://github.com/caelum29/calibre-mcp/issues/212) [#227](https://github.com/caelum29/calibre-mcp/issues/227) [#211](https://github.com/caelum29/calibre-mcp/issues/211) [#199](https://github.com/caelum29/calibre-mcp/issues/199)) ([e259b60](https://github.com/caelum29/calibre-mcp/commit/e259b6038be4057b360d0a11194e0b17c5e63e8a))
* **tools:** render nextCursor into the text channel via pageCursor ([#211](https://github.com/caelum29/calibre-mcp/issues/211)) ([828fef8](https://github.com/caelum29/calibre-mcp/commit/828fef80e1132ed31ffce2a2cd9b3b897c4ad676))
* **tools:** shared result renderer + pagination helper, committed ids in bulk text ([#227](https://github.com/caelum29/calibre-mcp/issues/227)) ([8563865](https://github.com/caelum29/calibre-mcp/commit/85638656dc44a263c47ba97bc7f65212b74ce7e2))
* **ui:** key board cache by library and filter ([#215](https://github.com/caelum29/calibre-mcp/issues/215)) ([8aeb446](https://github.com/caelum29/calibre-mcp/commit/8aeb4467f22f675bd3f656ac342f283a4e5c8205))
* **ui:** key board cache by library and filter ([#215](https://github.com/caelum29/calibre-mcp/issues/215)) ([cdb02ee](https://github.com/caelum29/calibre-mcp/commit/cdb02eeb03cae54a8543f90b54363ee1cb1a6d9d))
* **update-book:** drop no-op fields from the applied diff ([#202](https://github.com/caelum29/calibre-mcp/issues/202)) ([8693543](https://github.com/caelum29/calibre-mcp/commit/8693543d871af28f744d203da9eae6ecac9d5e78))
* **update-book:** say no-op in text when the unverified diff is empty ([#216](https://github.com/caelum29/calibre-mcp/issues/216)) ([1e29af3](https://github.com/caelum29/calibre-mcp/commit/1e29af3e32d74de0c72a3de621650858a0f5bb00))
* **update-book:** summary names only the fields that actually changed ([#235](https://github.com/caelum29/calibre-mcp/issues/235)) ([71ffcc4](https://github.com/caelum29/calibre-mcp/commit/71ffcc4add23c52383a9d9a9475f670459123680))
* **write-refusal:** classify calibredb's 401 credentials prompt as a write refusal ([#237](https://github.com/caelum29/calibre-mcp/issues/237)) ([612293b](https://github.com/caelum29/calibre-mcp/commit/612293b98dfb6d2d97f0c63cb0be8e5520dcdc6e))
* **writes:** bulk/update write integrity + text diffs ([#202](https://github.com/caelum29/calibre-mcp/issues/202) [#221](https://github.com/caelum29/calibre-mcp/issues/221) [#213](https://github.com/caelum29/calibre-mcp/issues/213) [#214](https://github.com/caelum29/calibre-mcp/issues/214) [#216](https://github.com/caelum29/calibre-mcp/issues/216)) ([64bae60](https://github.com/caelum29/calibre-mcp/commit/64bae60f54c9bf2eb13487262bd5ce3546d63e98))
* **writes:** render update diff and bulk per-id errors in text content ([#216](https://github.com/caelum29/calibre-mcp/issues/216)) ([da20da7](https://github.com/caelum29/calibre-mcp/commit/da20da7debdae51e5a2964fa4bdee4dfd02ed701))
* **writes:** report a dropped mid-request write as may-have-committed ([#233](https://github.com/caelum29/calibre-mcp/issues/233)) ([6e2d97d](https://github.com/caelum29/calibre-mcp/commit/6e2d97d7477341ea568bd5dbd21bf36e82856d39))
* **writes:** retry transient calibredb errors on idempotent writes ([#233](https://github.com/caelum29/calibre-mcp/issues/233)) ([16bcced](https://github.com/caelum29/calibre-mcp/commit/16bcced80523c3556dd6ad37618efe4099fd3a01))
* **writes:** retry transient calibredb errors on idempotent writes ([#233](https://github.com/caelum29/calibre-mcp/issues/233)) ([fd278b8](https://github.com/caelum29/calibre-mcp/commit/fd278b86658a68c34bc0fc6e1bebd134557a7ac4))
* **writes:** share the [#33](https://github.com/caelum29/calibre-mcp/issues/33) timeout-verify helper across write tools ([#221](https://github.com/caelum29/calibre-mcp/issues/221)) ([05903c2](https://github.com/caelum29/calibre-mcp/commit/05903c2c4b3a166ec269df791d747411bcd62427))
* **writes:** timeout verify compares fields like the diff does — a landed clear is not a failure ([#33](https://github.com/caelum29/calibre-mcp/issues/33), [#221](https://github.com/caelum29/calibre-mcp/issues/221)) ([e5cb225](https://github.com/caelum29/calibre-mcp/commit/e5cb225127b22665d120484b1e2cbfd0b507b4bb))
* **writes:** timeout verify compares fields like the diff does ([#33](https://github.com/caelum29/calibre-mcp/issues/33), [#221](https://github.com/caelum29/calibre-mcp/issues/221)) ([c8b4900](https://github.com/caelum29/calibre-mcp/commit/c8b4900fa1ceaf3fd770d62353008b982b5f9875))

## [0.10.0](https://github.com/caelum29/calibre-mcp/compare/v0.9.0...v0.10.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **semantic:** transformers.js 4.3.1 + INDEX_VERSION 4 (re-index required) ([#194](https://github.com/caelum29/calibre-mcp/issues/194))

### Added

* **semantic:** transformers.js 4.3.1 + INDEX_VERSION 4 (re-index required) ([#194](https://github.com/caelum29/calibre-mcp/issues/194)) ([290c803](https://github.com/caelum29/calibre-mcp/commit/290c8034377c74c506078c1fab7226b82f8a09f0))


### Fixed

* **semantic:** atomic per-book index writes + vector-aware freshness ([#197](https://github.com/caelum29/calibre-mcp/issues/197)) ([#205](https://github.com/caelum29/calibre-mcp/issues/205)) ([30c1470](https://github.com/caelum29/calibre-mcp/commit/30c14709c825f505b0a559791902208b0163fe9b))
* **semantic:** wait on a shared index lock instead of failing ([#196](https://github.com/caelum29/calibre-mcp/issues/196)) ([#206](https://github.com/caelum29/calibre-mcp/issues/206)) ([6caf501](https://github.com/caelum29/calibre-mcp/commit/6caf5015b086deb0a2b9c6b7d107d8007d94192a))

## [0.9.0](https://github.com/caelum29/calibre-mcp/compare/v0.8.0...v0.9.0) (2026-10-23)


### Added

* cancel long tool calls and report progress ([#150](https://github.com/caelum29/calibre-mcp/issues/150)) ([d39c263](https://github.com/caelum29/calibre-mcp/commit/d39c2630387b71c8e69bad73f0138ca9da60d7a6))
* generate the tool catalog and keep tool counts in sync ([#148](https://github.com/caelum29/calibre-mcp/issues/148)) ([bda73ca](https://github.com/caelum29/calibre-mcp/commit/bda73ca2a06a9ab3b8e772648f7fcd728e79e741))


### Fixed

* address verifier findings on the hygiene stack ([#154](https://github.com/caelum29/calibre-mcp/issues/154)) ([9e8c106](https://github.com/caelum29/calibre-mcp/commit/9e8c106fdf6a1989bdd6c4d4d9a621ef58f5ba02))
* kill child process groups and exit when the client goes away ([#145](https://github.com/caelum29/calibre-mcp/issues/145)) ([47cc35d](https://github.com/caelum29/calibre-mcp/commit/47cc35de0cecc779d414ecd8c01fbbc7894c0e04))

## [Unreleased]

### Added

- **`docs/tool-catalog.json`** — the generated, exact `tools/list` the server advertises
  (writes enabled; client-compat rewrites applied), so schema changes show up as a reviewable
  diff. `pnpm catalog` regenerates it; `pnpm catalog:check` fails on drift.
- **Cancellation.** Cancelling a tool call from the client (MCP `notifications/cancelled`)
  now stops the work: running `calibredb` / `ebook-convert` / `pdftotext` / figure-scan
  process groups are killed and downloads are aborted. `calibre_build_index` stops between
  books and reports what was already indexed (re-running the same call resumes).
- **Progress notifications.** `calibre_build_index` (per book) and `calibre_quality_report`
  send MCP progress notifications when the client asks for them (throttled, monotonic).

### Changed

- **Minimum Node.js is now 22.16 (was 22.5).** The semantic index needs `node:sqlite` with
  FTS5: on 22.5–22.12 `node:sqlite` exists only behind `--experimental-sqlite` (the server
  failed to start with `ERR_UNKNOWN_BUILTIN_MODULE`), and 22.13–22.15 ship SQLite without
  FTS5 (index builds failed with `no such module: fts5`). `engines` and the MCPB manifest now
  say `>=22.16`; Node 22 is tested in CI alongside Node 24.
- **Releases are automated with release-please.** Merging the release PR tags `vX.Y.Z`,
  creates the GitHub release and publishes to npm, the GitHub release (`.mcpb`) and the MCP
  Registry from one workflow.
- **Tool counts in the docs and manifests are now generated and correct.** The plugin and
  marketplace descriptions said 17 tools, the skill and `CLAUDE.md` 18; the server advertises
  19 model-facing tools (18 task tools + `calibre_ping`) plus 2 widget-internal ones. Every
  stated count is now maintained from the catalog.

### Fixed

- **No orphaned `calibredb` / `ebook-convert` processes after the client disconnects.**
  Subprocesses run in their own (detached) process group so a timeout can kill the
  conversion worker too — but that also let them outlive the server when the client
  closed stdin or sent SIGTERM mid-call, keeping the library write lock. The server now
  shuts down on stdin EOF/close, SIGINT and SIGTERM, kills every still-running process
  group first, closes the MCP server and exits 0.

## [0.8.0] — 2026-10-23

### Added

- **PDF outline (bookmarks) as a chapter-map source (#134).** `calibre_get_content` structure output can now report `detector: "pdf-outline"`; about 78% of sampled PDFs get an outline map, including books whose text never says "Chapter N".
- **`indexVersion` as citation provenance (#136).** Exposed in `calibre_semantic_search` results and `calibre_ping` (read from the opened index's meta), with a stale-index hint.
- **`pnpm reindex` (#99).** Book-level parallel re-index with worker threads and a single serialized SQLite writer; about 2.35x faster at N=3 (full library roughly 6-7 h vs 15 h), resumable, and refuses the production index without `--production`. `calibre_build_index` itself stays at N=1.
- **Label-only PDF figure captions recovered from page layout** (`pdftotext -bbox-layout`): label-only figures drop from 4,196 to 900 library-wide.

### Changed

- **EPUB front matter is demoted in search (#102).** Heading-structured front matter (title page, copyright, praise, TOC as headings) now ranks lower; the eval gate covers it with a new fixture.
- **RRF fusion weights evaluated (#142).** `VECTOR_RRF_WEIGHT` stays 1.0 (D-021).

### Fixed

- **EPUB figure markers for BPB/Manning caption shapes (#101).** The 14 books that placed 0 figures now place all of them.
- **Figure captions (#107).** No more empty captions, wrapped captions are joined (with an ellipsis when cut), body-text false positives are rejected, two-line bare labels are recognized; page-boundary fallback markers on book 175 go from 57 to 0.
- **Concurrency fixes found during #99.** Chunking is async so other workers' Content Server timers no longer fire spuriously; the extract-cache LRU no longer evicts another book's in-flight temp file.

> **Upgrade note:** figure indexes, front-matter flags and chapter maps changed, so cache versions were bumped. Run a re-index (`pnpm reindex` or `calibre_build_index`) to pick up the figure and front-matter fixes in the semantic index.

## [0.7.6] — 2026-10-21

### Changed

- **Release pipeline is re-runnable (#161).** The release workflow now waits (up to 5 min) for the
  new version to be visible on npm before publishing to the MCP Registry, retries the Registry
  publish up to 3x, and skips `npm publish` when the version already exists, so a failed release
  run can be re-run safely. No server behavior changes.

## [0.7.5] — 2026-10-21

### Added

- **ODT books are now extractable (#132).** OpenDocument-text books no longer get reported
  as having no extractable text format.

### Fixed

- **`calibre_build_index` no longer stops at 100 books (#138).** It now pages through all
  query matches (reported on a 155k-book library) instead of silently truncating.
- **Concurrent semantic searches no longer all time out (#156).** They are serialized
  through a FIFO inference queue.
- **Faster book-scope and bundle keyword search (#155).** An FTS-first CTE stops SQLite
  from re-running `MATCH` per row on book-filtered queries.
- **`calibre_update_book` / `calibre_bulk_update` emit `null` before/after for empty
  fields**, and pubdate proposals are sentinel-aware (#157).
- **Richer text output.** `calibre_get_book` now lists formats, ISBN/identifiers, tags,
  series, publisher, pubdate and languages (#104); EPUB figure search hits show the page
  (#105); `calibre_get_figures` names the other available format (#106);
  `calibre_ping` always reports the semantic model and index counts, and the uncaptioned
  figure-count wording is explicit (#108).
- **PyMuPDF extraction emits `\f` page breaks like pdftotext (#133)**, so page-to-offset
  mapping no longer depends on which backend ran.

## [0.7.4] — 2026-08-21

### Added

- **Markdown books are now extractable and indexable (#12).** `MD`/`MARKDOWN` (plus
  `TXTZ`/`TEXT`) joined the extractor's format-preference list, so a markdown-only book
  is no longer reported as having "no extractable text format" by `calibre_get_content`,
  `calibre_build_index` and ISBN scanning. Markdown ranks **above PDF** — it round-trips
  through `ebook-convert` with headings intact, which chunking leans on. An empty
  markdown/text file now says so instead of blaming an image-only page layer.

### Fixed

- **EPUB figure scans no longer fail when the cache directory is missing.** `unzip -d`
  creates only one missing directory level, so a scan starting from a not-yet-created cache
  dir (fresh boot, or the OS tmp reaper having cleaned it) exited 2 and surfaced as
  `FIGURES_SCAN_FAILED`; the extraction dir is now created up front.

## [0.7.3] — 2026-08-18

### Fixed

- **Cover-board click now opens the book card in Claude Desktop (#130).** Clicking a
  cover sends a `ui/message` request instead of a widget-initiated `tools/call` — Desktop
  never surfaced the result of the latter in the chat, so the click only flashed
  "Opening…" and nothing appeared. Hosts without `ui/message` still fall back to the
  `tools/call` path.

### Chore

- Added `pnpm-workspace.yaml` with `allowBuilds` for `esbuild`/`onnxruntime-node`/
  `protobufjs`/`sharp` (required by pnpm 11); bumped the `open` dependency to `^11.0.1`.

## [0.7.2] — 2026-07-27

### Fixed

- **Empty frame after listing figures.** In MCP Apps hosts, a `calibre_get_figures` call
  that only lists captions left a tall blank panel in the chat instead of rendering
  nothing. The figure viewer now reports zero height when it has nothing to show.

## [0.7.1] — 2026-07-27

### Added

- **In-chat figure viewer (MCP Apps hosts, #112).** Fetching figures with
  `calibre_get_figures` now shows them to *you*, not just to the assistant: a large reading
  pane with a margin rail when several figures come back, caption and page under each one,
  click (or Enter) to zoom to 100% and drag to pan. A figure that couldn't be extracted
  appears as a quiet placard rather than an error, and a plain listing call renders nothing
  at all. Text-only hosts are unaffected — same images in the transcript as before.

### Changed

- **The figure viewer is now documented** in the tool reference, the README and the
  companion `calibre-mcp` skill, where `calibre_get_figures` had been missing from the tool
  map entirely.
- **Stronger nudge to actually read the figure.** Fetch results now tell the assistant the
  images are in its context, ask it to name two things visible in the figure before
  interpreting, and to say plainly when it can't see the image instead of guessing from
  what similar diagrams usually look like.

## [0.7.0] — 2026-07-27

Book **figures** — the diagrams, charts and schemas your books explain things with — are now
first-class: listable, viewable in chat, searchable by caption, and visible as markers in
extracted text.

### Added

- **`calibre_get_figures` (new tool, #18).** Lists a book's captioned figures with page and
  caption so you can judge relevance before spending image tokens, then fetches up to 3 of
  them per call as actual images. Works on EPUB (preferred) and PDF; diagrams drawn as
  vectors — invisible to image extraction — are rendered from the page as a cropped band
  above their caption. Uncaptioned images (covers, decorations, equation art) stay hidden
  unless `include_uncaptioned: true`, and scanned PDFs honestly report 0 figures.
- **Figure search: `target: figures` on `calibre_semantic_search`.** Runs the full hybrid
  pipeline over figure *captions* instead of book text, so "find a diagram of the JWT
  signature flow" ranks captions directly rather than hoping a passage mentions the figure.
  Orthogonal to `scope` — search figures library-wide or inside one book. Hits carry the
  caption, page, surrounding passage, and a ready-made `calibre_get_figures` call.
- **Inline image markers in `calibre_get_content`.** Extracted text now shows
  `[image #N: page 71, "Figure 3-1. …"]` where a figure sits, so a passage that says "as
  shown below" no longer reads as a gap — and the marker names the figure to fetch.
- `calibre_build_index` takes `prune: true` — deletes index entries for books that are no
  longer in the library. Indexing only ever upserts, so removals and merges left orphaned
  chunks that semantic search still returned, pointing at ids that 404 on
  `calibre_get_content`. The prune reports how many books/chunks/figures it dropped, and
  refuses to run at all if the library reports zero books (an empty listing must never wipe
  the index) (#100).

### Fixed

- Large books no longer fail to index with "Download timed out": the download budget now
  bounds **stalled** transfers (no bytes received for 120s, clock reset by every chunk)
  instead of total elapsed time, which a 183 MB PDF cannot meet from a cold cache. A
  stalled download says so, with the byte count received (#100).
- The "no extractable text" message no longer diagnoses every format as a scanned PDF —
  an empty EPUB/AZW3 now reads as a missing text layer (image-only pages or DRM) (#100).
- Reranked result order no longer depends on which other candidates happened to share the
  batch: pairs are now scored one at a time, so the same query returns the same ordering
  regardless of how the candidate pool composed itself.

### Changed

- **Figures and markers enter the index at build time**, so an index built by an earlier
  version needs a `force: true` rebuild before `target: figures` finds anything and before
  extracted text carries image markers. The extraction cache is versioned, so a rebuild
  re-extracts rather than reusing marker-free text.

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

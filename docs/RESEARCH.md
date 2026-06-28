# Calibre MCP Server — Research Foundation Report

> **Status:** Research only. No code, no final tool-set decisions. This is the evidence base for the next (design) session.
> **Date:** 2026-06-27 · **Environment probed:** Calibre 9.10, Node v24.15.0, macOS (Apple Silicon).
> **Method:** local ground-truth probing of the installed Calibre + 4 parallel web-research agents (first-party sources, cited inline).
> **Companion files:** `local-groundtruth.md` (live probes), `calibredb_help.txt` (full CLI dump, v9.10).

---

## 1. Executive Summary

**Direction 1 — Calibre capabilities.** Calibre exposes the *same* search-query language across three interfaces (`calibredb`, the `new_api` DB API, and the Content Server `/ajax/search`) — so one query syntax can be exposed everywhere. Machine-readable output exists where it matters: `calibredb list --for-machine` (JSON) and `calibredb fts_search --output-format json`. **Full-text search is book-level only — it returns snippets but NOT a PDF page / EPUB spine location** (confirmed via manual + Kovid Goyal forum posts; the viewer re-searches to locate hits). Calibre has **no OCR** (it only reuses an existing OCR text layer) and **PDF is the worst conversion input**. The **GUI-concurrency lock is real and was reproduced firsthand**: with the Calibre app open, direct `calibredb`/SQLite/DB-API access is refused/dangerous — the supported safe path while the app runs is the **Content Server** (already live on `:8080` on this machine, 801 books). The `/ajax/` REST API is **read-only and undocumented** (source/forum only); **all writes must go through `calibredb set_metadata` or the DB API**. *(Update 2026-06-27, `CAPABILITIES.md` §1–2: the Content Server **also** exposes a write path — `/cdb/cmd` + `/cdb/set-fields`, gated by `--enable-local-write`; "read-only" describes only `/ajax/`, not the whole server. This is our chosen write path.)*

**Direction 2 — MCP best practices.** Build on **`@modelcontextprotocol/sdk` 1.29.0** (stable, targets protocol `2025-11-25`) over **stdio** — correct for local single-user desktop clients. **Do NOT wait for v2**: it's alpha (multi-package split, `2.0.0-alpha.x`) and the spec "v2" is a Release Candidate dated `2026-07-28` (not final; its stateless/session changes barely affect a local stdio server). Isolate the SDK behind a thin layer to de-risk migration. The **args-as-strings serialization bug** (our Cowork `-32602` failure) is **confirmed, widespread, and not fixed client-side** — the canonical defense is Zod coercion (`z.coerce.number()`, `z.preprocess(JSON.parse,…)`, union fallbacks; never `z.coerce.boolean()` on `"false"`). For semantic search, use **`@huggingface/transformers` 4.2.0** with `all-MiniLM-L6-v2` (384-dim, q8) and **in-memory brute-force cosine** (≈15 MB for 10k vectors) persisted as SQLite BLOBs — sqlite-vec only if you want SQL-queryable vectors; LanceDB/pgvector are overkill at this scale.

**Direction 3 — server landscape.** ~30 Calibre MCP servers exist; most are tiny, single-author, read-only, license-less. **FaceDeer (the current server) is the strongest base** and — correction to the brief — is **NOT calibredb-based**; it drives Calibre's **internal Python API via a `calibre-debug` worker process**, with the field's only **granular per-library permission model** and the best **write-side type normalization** + tests (MIT-licensed). The richest feature set is **sandraschi** (LanceDB RAG, OCR, FTS→PDF-page/EPUB-spine *location resolution done in its own code*, portmanteau `operation=` tools) but it's Windows-only, license-less, and AI-churned. The closest **TypeScript** reference is **chepetime/calibre-librarian-mcp** (xmcp, zod, env-flag write-gating, cache+pagination, tests — but no license, dormant). The only **permissively-licensed semantic-search** code to lift is the Apache-2.0 **"calibre_tools"** (alexchilton CAS NLP project: sentence-transformers + MPS, ISBN tools, dedupe — but messy course-project structure). No existing server is a TS server with semantic search + safe writes + serialization-bug hardening — i.e. our niche is real.

---

## 2. Calibre Capability Inventory

Access interfaces: **CLI** = `calibredb`/`ebook-*`; **DB** = `new_api` (`calibre.db.cache.Cache`); **CS** = Content Server `/ajax/`; **EXT** = external/online.

| Capability | Interface | R/W | Risks / limitations |
|---|---|---|---|
| Metadata search (query language) | CLI `search`/`list -s` · DB `search()` · CS `/ajax/search` | R | Same syntax everywhere. CS returns ids only (paginated). |
| List books (machine JSON) | CLI `list --for-machine --fields all` | R | Custom fields via `*name`. No filtering beyond `--search`. |
| Read one/many book metadata | DB `get_metadata`/`field_for` · CS `/ajax/book(s)/{id}` | R | CS `/ajax/` is **undocumented** (source-only), version-fragile. |
| Show metadata (OPF) | CLI `show_metadata --as-opf` | R | No JSON flag; OPF=XML. |
| Set fields / metadata | CLI `set_metadata --field` · DB `set_field`/`set_metadata` | **W** | **Corruption risk if GUI/server holds library.** No HTTP write. CLI is the brief's safe workaround. |
| Custom columns (CRUD) | CLI `add_custom_column`/`custom_columns`/`set_custom` · DB | R/W | `#name` convention; type-specific value formats. |
| Add / remove books & formats | CLI `add`/`remove`/`add_format`/`remove_format` · DB | **W** | Same concurrency danger; prefer CLI/CS-routed CLI. |
| FTS over book text | CLI `fts_search --output-format json [--include-snippets]` | R | **Book-level only — no page/spine location.** Needs index built; default 90% indexed threshold; `--restrict-to ids:/search:`. |
| FTS index management | CLI `fts_index enable\|disable\|status\|reindex` | **W** | Separate `full-text-search.db` (FTS5) to keep in sync; rebuild cost. **Not enabled on this library yet.** |
| Categories / tag browser | CLI `list_categories` · CS `/ajax/categories` · DB `get_categories` | R | CS category urls are hex-encoded. |
| Saved searches / virtual libs | CLI `saved_searches` · query `vl:`/`search:` | R | Query-language constructs. |
| Faceting (field value counts) | DB `get_categories` / `all_field_names` | R | Best via DB API; CLI `list_categories --item_count` approximates. |
| Download book file / cover | CS `/get/{fmt}/{id}/{lib}`, `/get/cover/...` | R | Needs server running; auth for remote. |
| Convert formats | CLI `ebook-convert` | W (new file) | **PDF input poor**; lossy; CPU-heavy. |
| Per-file metadata r/w | CLI `ebook-meta` | R/W | Format-dependent; silently drops unsupported fields. Operates on file, not DB. |
| Text from scanned PDF (OCR) | **none in Calibre** → EXT Tesseract/ocrmypdf | — | **Calibre has NO OCR**; only reuses an existing text layer. |
| Library integrity | CLI `check_library` | R | Long-running on big libs. |
| Backup / restore metadata | CLI `backup_metadata`/`restore_database` | R/W | Restore is destructive. |
| Clone library | CLI `clone` | W | Creates empty library w/ same custom columns. |
| Embed metadata into files | CLI `embed_metadata` | W | Rewrites book files on disk. |
| Notes & annotations | DB `notes_for`/`set_notes_for`, `*_annotations_for_book`, `search_notes` | R/W | Concurrency danger as above. |
| Online metadata enrichment | CLI `fetch-ebook-metadata` · EXT Open Library / Google Books | R | Amazon scraping fragile/rate-limited; external APIs rate-limited. |

**Key interface notes**
- **GUI lock (reproduced):** with the app open, `calibredb --with-library <path>` errors: *"Another calibre program … is running … calibredb can connect directly to a running calibre Content server … instead."* → safe live path = `calibredb --with-library http://localhost:8080/#Library_Id` (CLI routed *through* the running server) or the CS HTTP API for reads.
- **Content Server live shapes** (probed): `/ajax/library-info`, `/ajax/search?query=…&num=&offset=`, `/ajax/categories`, `/ajax/book/{id}/{lib}` (full metadata incl. `identifiers`, `formats`, `user_metadata`=custom cols). 801 books, no auth configured locally.
- **DB API `new_api`** (`from calibre.library import db; db(path).new_api`): multiple-reader/single-writer locking, in-memory mirror of `metadata.db`. `format_abspath()` *breaks* the threadsafe promise — use `copy_format_to()`. Intended for **exclusive** access.

Sources: manual.calibre-ebook.com (`gui.html`, `db_api.html`, `server.html`, `conversion.html`, `generated/en/{calibredb,ebook-meta,fetch-ebook-metadata}.html`); calibre `src/calibre/srv/ajax.py`; mobileread forum threads on FTS; local probes (`local-groundtruth.md`).

---

## 3. MCP Best-Practices Cheat-Sheet (TS, local/stdio, 2026)

### SDK & protocol version decision
- **Use `@modelcontextprotocol/sdk` 1.29.0** (published 2026-03-30; `node>=18`; `zod ^3.25 || ^4`). Targets protocol **`2025-11-25`** (current revision). Source: registry.npmjs.org/@modelcontextprotocol/sdk; modelcontextprotocol.io/specification/versioning.
- **v2 = NOT yet.** SDK v2 is `2.0.0-alpha.x` (multi-package split: `@modelcontextprotocol/server`, `/node`, `/hono`, `/express`, `/server-legacy`). Spec "v2" is an **RC dated 2026-07-28** (not final): stateless core, sessions removed, extensions framework, MCP Apps, Tasks redesign. For a **local stdio single-user** server these changes are largely irrelevant (no sessions/sticky routing).
- **Migration de-risk:** keep tool *logic* (Zod schemas, handlers, embedding/DB code) free of SDK types; wrap `registerTool`/transport in one thin module so an eventual v2 swap is localized.

### Server API (current, not legacy `server.tool()`)
```ts
const server = new McpServer({ name, version });
server.registerTool(name, { title, description, inputSchema: z.object({…}), outputSchema, annotations }, handler);
// when outputSchema set → handler MUST return { content:[…], structuredContent: <matches schema> }
await server.connect(new StdioServerTransport());
```
- `registerResource` (+ `ResourceTemplate`) and `registerPrompt` use the same config-object shape. Per-handler logging via request context: `ctx.mcpReq.log('info', …)`.

### Transport
- **stdio is the correct default** for Claude Desktop / Claude Code / Cowork (client spawns process; no ports/auth/network). Streamable HTTP only for remote/multi-client; old HTTP+SSE is **deprecated**.

### Tool design for LLM routing
- Few well-scoped tools > many micro-tools > one giant portmanteau. Each tool def costs context + adds routing ambiguity.
- Action-oriented namespaced names (`library_search`, `book_get`, `book_update`). **Descriptions are the highest-leverage lever** — say what it does, when to use / NOT use, what it returns, arg units.
- `outputSchema`+`structuredContent` for machine-consumable JSON; skip for free text.
- **Paginate / cap** (Claude Code truncates tool output ~25k tokens). **Return IDs+summaries, not full dumps**; a separate `get_details(id)` fetches the full record. Steer toward many small queries.
- Source: anthropic.com/engineering/writing-tools-for-agents · /code-execution-with-mcp.

### Serialization-bug defense (our Cowork `-32602`)
**Confirmed & unfixed client-side** (claude-code#24599, notion-mcp-server#208 "from Claude Desktop (Cowork)", azure-devops-mcp#879). Keep the *outward* JSON Schema correct (good clients send native types) but **coerce internally**:
```ts
const count = z.coerce.number().int().min(1).max(100).default(10);        // "5" → 5
const flag  = z.preprocess(v => typeof v==='string' ? v.toLowerCase()==='true' : v, z.boolean()); // NEVER z.coerce.boolean()("false")→true
const tags  = z.preprocess(v => { if (typeof v!=='string') return v;
  try { return JSON.parse(v); } catch { return v.split(',').map(s=>s.trim()); } }, z.array(z.string()));
const idArg = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]);
```
Rule: `z.coerce.number()` everywhere you'd use `z.number()`; `z.preprocess(JSON.parse,…)` for arrays/objects.

### Errors / logging / timeouts / concurrency
- **Tool failure** → return `{ content, isError:true }` (model self-corrects; output-schema validation skipped). **Throw** only for exceptional/programming errors → JSON-RPC code (`-32602` invalid params, `-32603` internal, …).
- **stdout is sacred** on stdio — all diagnostics to **stderr** (`console.error`); one stray `console.log` corrupts the stream. Structured client logs via `ctx.mcpReq.log` (MCP `logging` capability).
- Client enforces request **timeouts** — return fast / emit progress for long work. Handlers can **overlap** (multiple in-flight ids) → keep reentrant, guard shared DB.

### Security
- Default read-only; gate writes behind explicit tools + `annotations:{readOnlyHint,destructiveHint}` + an env flag (`ALLOW_WRITES` off by default).
- **SQLite without racing the GUI:** prefer **read-only connections** (`mode=ro`); `PRAGMA journal_mode=WAL` + `busy_timeout`; tiny short write txns, never across an `await`. Treat the DB as read-mostly; route mutations through `calibredb`/CS. (Matches the reproduced GUI-lock constraint.)
- Config (paths, model dir, keys) from env; confine file access to a root, reject `..`; never echo secrets.

### Packaging & distribution
- **npx:** publish to npm with `"bin"` + shebang → `claude mcp add <name> -- npx -y <pkg>`; Desktop config `{command:"npx",args:["-y",<pkg>]}`.
- **MCPB bundle** (drag-drop into Claude Desktop): `.mcpb` ZIP + `manifest.json`. **Formerly DXT** → now `@anthropic-ai/mcpb` (CLI v2.1.2). `mcpb init`→`mcpb pack`; bundle `node_modules/`; declare user-config so the client prompts. Anthropic recommends Node (ships with Desktop).

### Local embeddings + vector layer
- **`@huggingface/transformers` 4.2.0** (renamed from `@xenova/transformers`); ONNX via `onnxruntime-node`. Model **`Xenova/all-MiniLM-L6-v2`** (384-dim) default; `bge-small`/`gte-small` for slightly better retrieval. `dtype:'q8'` good CPU default; `{ pooling:'mean', normalize:true }` → cosine == dot. Set `env.cacheDir` explicitly (default path unconfirmed). MiniLM ≈ few ms/embedding warm.
- **Vector store for 800–10k:** **in-memory brute-force cosine** (10k×384 ≈ 15 MB, sub-ms scan, exact, zero deps) — persist vectors as SQLite BLOBs, rebuild index on startup. **sqlite-vec** if you want SQL-queryable vectors in the same file. LanceDB/pgvector = overkill.

Sources: registry.npmjs.org (sdk, @huggingface/transformers, sqlite-vec, @lancedb/lancedb); modelcontextprotocol.io; github.com/modelcontextprotocol/{typescript-sdk,mcpb}; huggingface.co/docs/transformers.js; GitHub issues cited above.

---

## 4. Server Comparison Matrix

Deep cards for the 6 most relevant; the rest are in the discovery table below. (R=read, W=write.)

| Server | Lang / SDK | Calibre access | #Tools | Unique features | Activity (last / commits / releases) | Bus factor | macOS | License | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **FaceDeer/calibre_full_mcp_server** *(current)* | Python / FastMCP | **`calibre-debug` worker → internal DB API** (not calibredb) | **18 tools + 3 resources** (verified from source — see below) | **Field-level per-library permissions**; **strong write type-normalization**; NLTK content windowing; help corpus | 2026-03 / ~6 / **0** | 1 | likely OK (untested) | **MIT** | **Best base.** Keep; add releases, macOS tests, fix serialization for Cowork. |
| **sandraschi/calibremcp** | Python 3.13 / FastMCP 3.2 | direct SQLite **+** Content Server HTTP | 21 portmanteau (+9 beta) | **LanceDB metadata RAG + chunk RAG**; **FTS→PDF-page/EPUB-spine location (own code)**; **OCR**; Anna's/arXiv/Gutenberg import; Prefab UI cards; Ollama | **2026-06-27** / ~98 / **v1.0–v1.8.6** | ~1 (bot acct) | **Windows-only** | **none (risk)** | Borrow *ideas only*: portmanteau tools, FTS location resolution, RAG, `{success,message,data}` envelope. |
| **chepetime/calibre-librarian-mcp** | **TS / xmcp** | `calibredb` + `ebook-convert` subprocess | ~30 + 3 res + 3 prompts | **env-flag write-gating** (`assertWriteEnabled`); cache+invalidation; pagination util; resources+prompts; `generate_claude_config` | 2026-01 (3-day burst) / 58 / 0 | 1 (AI-gen) | macOS-first | **none** | **Best TS structural reference.** Borrow layout/patterns; can't copy code (no license). |
| **"calibre_tools"** (alexchilton CAS NLP) | Python / FastMCP | calibredb + **direct SQL** + sentence-transformers | 8 MCP (+ many scripts) | **semantic search (MPS)**; **metadata enrichment** (Amazon/Goodreads/Google); **dedupe**; ISBN extract/validate; genre NN | 2025-12 / — / 0 | 1 | yes (MPS) | **Apache-2.0** | **Only permissive semantic-search code.** Borrow algorithms; ignore course-project structure. |
| **ajtudela/calibre_mcp_server** | Python / FastMCP | direct SQLite (RO) | 10 | clean `validation.py` + typed `exceptions.py`; env-var config | 2025-10 / ~9 / 0 | 1 | OK (cross-plat) | **Apache-2.0** | Borrow clean-arch validation pattern; too thin as base (RO, no tests). |
| **trieloff/calibre-mcp** | **Bash** | `calibredb` CLI | 4 | FTS phrase→fuzzy fallback; `calibre://` + `file://` deep links; **macOS `timeout` handling** | 2025-06 (dormant) / ~14 / 0 | 0 human (all "claude") | **macOS-built/tested** | **Apache-2.0** | Borrow deep-links + macOS timeout idea; not a base (bash, RO, 4 tools). Most-starred (40★). |

**Discovery — other servers found (GitHub Search, 2026-06-27, by relevance):**

| Repo | Lang | Access | Note | ★ / last push |
|---|---|---|---|---|
| `matthewp/lyceum` | **TS** | Calibre MCP API | very new, actively pushed | 0 / 2026-06-27 |
| `2b3pro/calibre-mcp` | **TS** | unconfirmed | no docs | 0 / 2026-04-27 |
| `ispyridis/calibre-rag-mcp-nodejs` | **JS/Node** | library + RAG | Node RAG over library | 2 / 2025-09-09 |
| `ispyridis/calibre-mcp-nodejs` | **JS/Node** | library | non-RAG sibling | 0 / 2025-09-09 |
| `ericknavarro/calibre-manager-mcp` | **JS/Node** | `calibredb` CLI | safe read+write metadata, conversion | 1 / 2026-06-20 |
| `kybernetikos/access-calibre` · `caplin-adam/access-calibre` | **JS/Node** | Content Server | access ebooks via CS | 0 / 2026-02 |
| `pshap/mcp-neolibrarian` | Python | metadata.db + FTS | strictly read-only, FTS global+per-book | 3 / 2026-04-26 |
| `kasssandr/archilles` | Python | library + RAG | RAG w/ **page-level citations** | 3 / 2026-06-23 |
| `THeK3nger/calibre-mcp` | Python | Content Server | writes need `--enable-local-write` | 2 / 2025-08-20 |
| `LeHibou06/calibre-mcp` | Python | library (Docker) | FTS content search; NAS | 0 / 2026-04-06 |
| `dengfengcloud/book-to-kindle-mcp` | **JS/Node** | Calibre + email | Z-Library→Calibre→Kindle | 0 / 2026-06-01 |
| `gzigurella/converter-mcp` | Python | calibre+ffmpeg | file conversion | 0 / 2026-02-17 |
| `acato/calibre-web-mcp` | Python | **Calibre-Web** OPDS | targets Calibre-Web, not Calibre | 0 / 2026-05-28 |
| `new-usemame/book-stack-mcp` | Python | Calibre + others | unified LazyLibrarian/Anna's/Calibre | 0 / 2026-05-20 |
| `Miguel0888/mcp-server`, `Quentinbest/calibre_mcp`, `Xpresi/calibre-mcp`, `xmkevinchen/calibre-mcp`, `iain247/...`, `halimchaibi/...`, `fregapple/...` | Python | varies/unconfirmed | low-signal | 0–2 / 2025–2026 |
| `mekk.calibre` (PyPI, **not an MCP server**) | Python 2/3 | `calibredb` CLI | **BSD-licensed CLI utility collection** — algorithm reference for gap-features: `calibre_guess_and_add_isbn` (ISBN from book text), `calibre_report_duplicates` (dedupe + merge-safety), `calibre_find_books_missing_in_database`, `calibre_add_if_missing`. Pre-FTS5/`new_api` era → **idea/algorithm only**. | v1.5.0 / **2017-06-14 (dormant)** |

**Field-wide patterns:** access splits 3 ways — (a) shell `calibredb`, (b) Content Server HTTP, (c) direct `metadata.db`/FTS SQLite; FaceDeer is unique with `calibre-debug` internal API. Write-gating recurs (env flag / per-field permissions / CS `--enable-local-write`). Only FaceDeer & sandraschi loudly warn about the concurrency-corruption hazard. Registries (glama, lobehub, mcp.so, smithery) are wrappers around these GitHub repos, not separate servers.

Sources: GitHub REST API (repos/commits/releases/contributors) + raw source per repo; npm/PyPI; glama.ai, lobehub.com — all 2026-06-27.

---

## 5. Consolidated Tool Catalog

> **Superseded as the build list by `TOOLS.md`** (the locked 14-tool v1 surface, per-book `scope`
> param added 2026-06-27). This §5 is the *exploration* catalog — the union of options; `TOOLS.md`
> is what ships.

Union of every tool seen across servers + Calibre-native capabilities. **Value** = usefulness for *our* library (800 tech books, raw filenames, EN+RU, semantic-search gap). **Cx** = implementation complexity (L/M/H). "Seen in" abbrev: FD=FaceDeer, SS=sandraschi, CH=chepetime, CT=calibre_tools, AJ=ajtudela, TR=trieloff, native=Calibre itself.

### 5.0 FaceDeer baseline — verified tool inventory (source-confirmed 2026-06-27)

Tools are registered dynamically from `TOOL_DEFINITIONS` in `src/server.py` (conditional ones gate on permission flags) plus 3 standalone helper tools and 3 resources. **Actual count: 18 tools + 3 resources** (corrects the brief's/earlier "14").

- **Always-on (7):** `search_books`, `get_book_details`, `get_book_content`, `search_book_content`, `fts_search`, `get_library_schema`, `get_field_values`
- **Helpers (3):** `list_libraries`, `list_help_topics`, `get_help_topic`
- **Conditional — permission-gated (8):** `update_book`,`bulk_update_metadata` (`has_write`) · `convert_book` (`has_convert`) · `delete_book` (`has_delete`) · `list_importable_files`,`add_book` (`has_import`) · `list_exportable_files`,`export_book` (`has_export`)
- **Resources (3):** `calibre://libraries`, `calibre://help/list`, `calibre://help/{topic}`

**Coverage of this §5 catalog by the FaceDeer baseline** (✅ have · ⚠️ partial · ❌ gap = our differentiator):

| §5 area | Catalog tool | FaceDeer | Mapping / note |
|---|---|---|---|
| Read | `search_books` | ✅ | pagination, `fields`, `text_field_limit` |
| Read | `get_book_details` | ✅ | `get_book_details` |
| Read | `fts_search` | ✅ | book-level, no location |
| Read | `search_book_content` | ✅ | `search_book_content` |
| Read | `get_book_content` | ✅ | limit/offset/`sentence_aware` |
| Read | `get_library_stats/schema` | ✅ | `get_library_schema` |
| Read | `get_field_values`/faceting | ✅ | + `value_filter` regex |
| Read | `list_libraries` | ✅ | tool + resource |
| Read | `get_all_tags`/`list_categories` | ⚠️ | only via `get_field_values` |
| Read | `search_by_{author,series,tag}` | ⚠️ | folded into `search_books` (as §5 recommends) |
| Read | `get_epub_chapters` | ❌ | — |
| Read | **`find_duplicates`/`compare_books`** | ❌ | **gap** |
| Read | `missing_book_scout`/`quality_report` | ❌ | **gap** |
| Semantic | **`semantic_search`** + index build | ❌ | **headline gap** |
| Semantic | `rag_retrieve`, FTS location resolution | ❌ | gap |
| Write | `set_metadata`/`update_book` | ✅ | `changes` dict — **the Cowork `-32602` path** |
| Write | `bulk_update_metadata` | ✅ | defaults to **ALL books** (unsafe default) |
| Write | `set_custom_column` | ✅* | via `#field` in `changes` dict (no dedicated tool) |
| Write | `bulk_retag`/`normalize_author_sort` | ⚠️ | partial via bulk; **no preview-first** |
| Write | `add_book`/import | ✅ | `add_book`+`list_importable_files` (allowed_paths) |
| Write | `delete_book` | ✅ | gated `has_delete` |
| Write | `convert_book` | ✅ | gated |
| Write | `export_book` | ✅ | `export_book`+`list_exportable_files` |
| Enrich | **`metadata_enrichment`** | ❌ | **gap** (raw-filename books) |
| Enrich | **`isbn_tools`** | ❌ | **gap** |
| Enrich | `genre_classification` | ❌ | gap (low priority) |
| Infra | per-library permission model | ✅ | `has_write/convert/delete/import/export` — strongest pattern in field |
| Infra | MCP resources + prompts | ⚠️ | resources ✅, **prompts ❌** |
| Infra | `tool_help`/introspection | ✅ | `list_help_topics`/`get_help_topic` |
| Infra | `calibre://`+`file://` deep links | ⚠️ | resource URIs only, not in results |
| Infra | `generate_claude_config` | ❌ | — |

**Net:** FaceDeer already covers the entire read cluster + full write/convert/import/export + the permission model — i.e. the mechanical half of this catalog. The uncovered set is exactly our niche: **semantic_search/RAG, enrichment+isbn, dedupe/quality, preview-first bulk, and serialization-hardening** of the two write tools (`update_book`/`bulk_update_metadata`) that fail `-32602` in Cowork.

### Read / search
| Tool | Seen in | R/W | Value | Risk | Cx | Notes |
|---|---|---|---|---|---|---|
| `search_books` (metadata, query lang, paginated) | FD,SS,CH,AJ,native | R | **High** | Low | L | Core. Return ids+summary, not dumps. |
| `get_book_details` | FD,SS,CH,AJ,native | R | **High** | Low | L | Full record by id; the "details" half of ID+summary. |
| `fts_search` (library-wide full text) | FD,SS,TR,CH,native | R | **High** | Med | M | JSON + snippets; **no native location**; needs index built. |
| `search_book_content` (within one book) | FD,CH,native | R | Med | Low | M | Snippet hits inside a single book. |
| `get_book_content` / `fetch_excerpt` (text into context) | FD,CH,TR | R | Med | Med | M | char limit/offset, sentence-aware; cap output. |
| `get_epub_chapters` / `get_epub_chapter_content` | benoute | R | Med | Low | M | Direct EPUB parse for chapter-level reading. |
| `get_library_stats` / `get_library_schema` | FD,CH,AJ | R | Med | Low | L | Counts, custom-column list. |
| `get_field_values` / faceting (value+counts) | FD | R | Med | Low | M | Great for "which tags/series exist". |
| `get_all_tags` / `list_categories` | CH,AJ,native | R | Low | Low | L | Tag browser equivalent. |
| `search_by_{author,series,tag,title}` (typed shortcuts) | AJ,CH | R | Low | Low | L | Sugar over `search_books`; maybe collapse into it. |
| `find_duplicates` / `compare_books` | CH,CT,SS | R | **High** | Low | M | Direct fit for raw-filename cleanup. |
| `missing_book_scout` / `quality_report` | CH | R | Med | Low | M | Find books missing metadata (our raw-title problem). |
| `list_libraries` | FD,SS,native | R | Med | Low | L | Multi-library (we have 2). |

### Semantic / RAG (our headline gap — no good TS option exists)
| Tool | Seen in | R/W | Value | Risk | Cx | Notes |
|---|---|---|---|---|---|---|
| `semantic_search` (meaning-based) | CT,SS,archilles,ispyridis | R | **High** | Med | H | all-MiniLM-L6-v2 + in-memory cosine; the core differentiator. |
| `metadata_index_build` / embeddings rebuild | SS,CT | W (index) | **High** | Med | M | One-time + incremental on add/update. |
| `rag_retrieve` (chunk-level over book text) | SS,kasssandr | R | Med | High | H | Heavier; needs chunking + text extraction; defer? |
| FTS location resolution (PDF page / EPUB spine) | SS (own code) | R | Med | High | H | Calibre FTS can't; must compute ourselves — costly. |

### Write (must be serialization-hardened + gated)
| Tool | Seen in | R/W | Value | Risk | Cx | Notes |
|---|---|---|---|---|---|---|
| `set_metadata` / `update_book` (field changes) | FD,SS,CH,native | **W** | **High** | **High** | M | **Our broken path in Cowork.** Borrow FaceDeer type-normalization + Zod coercion. |
| `bulk_update_metadata` (across many books) | FD,SS | **W** | **High** | **High** | M | Same hardening; guard "all books" default. |
| `set_custom_column` / `set_custom` | FD,CH,SS,native | **W** | Med | High | M | Per-type value formatting. |
| `bulk_retag` / `normalize_author_sort` | CH,SS,CT | **W** | Med | High | M | Cleanup ops; preview-first pattern (chepetime). |
| `add_book` / import | FD,SS,native | **W** | Med | High | H | Whitelisted paths; post-import metadata. |
| `delete_book` / remove formats | FD,SS,native | **W** | Low | **High** | M | Destructive; strong gating + confirm. |
| `convert_book` | FD,SS,gzigurella,native | W (file) | Low | Med | M | PDF input poor; CPU-heavy. |
| `export_book` | FD,SS,native | W (file) | Low | Low | M | Whitelisted paths. |

### Enrichment (fits the raw-filename problem)
| Tool | Seen in | R/W | Value | Risk | Cx | Notes |
|---|---|---|---|---|---|---|
| `metadata_enrichment` (Open Library / Google Books) | CT,SS,native | R→W | **High** | Med | M | For `795731065`/`top.dvi`-style books. Rate-limit aware. |
| `isbn_tools` (extract/validate, ISBN-10/13, from EPUB) | CT | R | **High** | Low | M | Recover identifiers → then enrich. |
| `genre_classification` (NN) | CT | R | Low | Med | H | Course-project nicety; low priority. |

### Infra / UX affordances
| Tool | Seen in | R/W | Value | Risk | Cx | Notes |
|---|---|---|---|---|---|---|
| Per-library **permission model** | FD | — | **High** | — | M | Field-level read/write gating — strongest safety pattern. |
| `calibre://` + `file://` deep links in results | TR | R | Med | Low | L | Nice agent/user affordance. |
| MCP **resources + prompts** | FD,CH,SS | R | Med | Low | M | `library-info`, cleanup/merge prompts. |
| `generate_claude_config` (self-bootstrap) | CH | R | Low | Low | L | Onboarding sugar. |
| `tool_help` / introspection | SS,FD | R | Low | Low | L | Self-describing tools. |
| macOS `calibredb` timeout handling | TR | — | Med | Low | L | Relevant since we're on macOS + GUI-lock. |

**Catalog takeaways for selection:** the high-value cluster is **search + details + FTS + semantic_search + dedupe + enrichment + hardened set/bulk metadata** — semantic search and serialization-hardened writes are exactly what no existing TS server combines. Borrow FaceDeer's permission model + type-normalization, chepetime's TS structure + write-gating, calibre_tools' (Apache-2.0) semantic/ISBN/dedupe algorithms.

---

## 6. Open Questions / Gaps (resolve before designing)

> **Resolution map (added 2026-06-27, post-design).** Most of these are now closed downstream — read
> this section as the *original* exploration, not current status:
> **#1** write path → RESOLVED `CAPABILITIES.md` §2 · **#2** FTS → addressed `CAPABILITIES.md` §5
> (book-level still; embeddings are the location layer) · **#5** RU model → RESOLVED `TOOLS.md` #5
> (multilingual day 1) · **#6** PDF extraction → RESOLVED `CAPABILITIES.md` §4 (PyMuPDF primary) ·
> **#7** `/ajax` stability → RESOLVED `CAPABILITIES.md` §1.5 (pin 9.x + probe + fallback) · **#8**
> write auth → RESOLVED `CAPABILITIES.md` §2 (`--enable-local-write`). Still open at **implementation
> time:** **#3** (exact `-32602` failure point) and **#4** (transformers.js cache/cold-start).
> **#9/#10** = carried-forward notes (licensing rules; FaceDeer is internal-API- not calibredb-based).

1. **Access path for our writes:** with the GUI normally open, do we (a) route `calibredb` through the running Content Server URL, (b) require the user to close the GUI for writes, or (c) talk to Calibre's internal API like FaceDeer's `calibre-debug` worker? Each has different concurrency/latency trade-offs. **Needs a decision + a small spike.**
2. **FTS strategy:** FTS isn't enabled on the library yet (`Integration status: False`). Do we require/enable `fts_index`, and accept book-level-only results, or build our own per-book content search? **Page-level locations would have to be computed ourselves (expensive).**
3. **How FaceDeer's write tools actually break in Cowork:** servers-A confirmed FaceDeer *does* normalize types server-side, yet Cowork still fails. Is the `-32602` happening *before* its normalization (at FastMCP/Zod-equivalent schema validation)? **Worth reproducing to pin the exact failure point** so our Zod-coercion layer targets the right boundary.
4. **transformers.js cache path & cold-start cost** on packaged distribution — set `env.cacheDir` explicitly; measure first-run model download UX inside an MCPB bundle.
5. **RU-language handling:** all-MiniLM-L6-v2 is English-centric. For EN+RU semantic search, do we need a **multilingual** model (e.g. `paraphrase-multilingual-MiniLM`) — and does it run acceptably on M-series? **Unverified.**
6. **PDF text extraction quality** for our mostly-PDF technical library (code blocks, tables) — Calibre extraction is weak; is an external extractor (e.g. `pdftotext`/PyMuPDF) needed for usable semantic chunks? **Unverified for our corpus.**
7. **`/ajax/` API stability:** it's undocumented/source-only — if we lean on it for reads, pin a Calibre version and add a fallback to `calibredb`.
8. **Content Server write auth:** confirmed *no* HTTP write CRUD exists; double-check whether `calibredb --with-library <server-url>` writes need `--enable-auth` + a write-permitted user when going through the server.
9. **Licensing for code reuse:** safely reusable = calibre_tools (Apache-2.0), ajtudela (Apache-2.0), trieloff (Apache-2.0), FaceDeer (MIT), **`mekk.calibre` (BSD)**. `mekk.calibre` is the second permissive source (after calibre_tools) for our **gap-features** — port its `calibre_guess_and_add_isbn` (ISBN-from-text → feeds `isbn_tools`/enrichment) and `calibre_report_duplicates` (dedupe + merge-safety scoring → `find_duplicates`) **algorithms**, but it predates FTS5/`new_api` so treat as algorithm reference, not a library. sandraschi & chepetime remain **idea-only** (no license).
10. **Brief correction to carry forward:** FaceDeer is **not** "calibredb-based" — it's `calibre-debug`/internal-API-based. Re-read its permission + normalization code with that in mind when borrowing.

---

*Artifacts in this directory: `RESEARCH.md` (this report) · `local-groundtruth.md` (live Calibre probes) · `calibredb_help.txt` (full v9.10 CLI dump).*

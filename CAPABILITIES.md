# CAPABILITIES.md — What we can actually implement

> **Status:** Deep capability + API analysis (2026-06-27). Builds on `RESEARCH.md` / `DESIGN.md`;
> does **not** re-derive them. Method: firsthand probing of the live Content Server on this machine
> + 3 first-party research passes (Calibre source on GitHub, the manual, MobileRead/plugin repos).
> **This file resolves `RESEARCH.md` §6 open questions #1 (write path) and #8 (write auth).**

---

## 0. TL;DR — the three things that change the design

1. **The write path is solved, and it's the Content Server.** Every `calibredb` subcommand is
   callable over HTTP at **`/cdb/cmd/{which}/{version}`** on the already-running server (`:8080`).
   Reads work anonymously; **writes are gated** (`"Anonymous users are not allowed to make changes"`).
   This is the *documented, GUI-concurrency-safe* mutation path — it's literally how
   `calibredb --with-library http://localhost:8080/#Lib` works internally. → **§1**
2. **Plugins are not callable headlessly** (no `cli_main()` on the ones that matter). Their value is
   **algorithms to reimplement in TS**, not tools to wrap: Find Duplicates, Quality Check, Count Pages,
   Extract ISBN map 1:1 onto our differentiators. → **§3**
3. **Two clean PDF/EPUB text paths exist**, neither is `calibredb`: `calibre-debug --explode-book`
   (EPUB → per-spine HTML, scriptable) and `ebook-convert … --txt-output-formatting=markdown`. PDF
   stays weak (Calibre's own docs) → use **PyMuPDF/pdftotext as primary PDF extractor**. → **§4**

---

## 1. Content Server HTTP API — the full surface (firsthand + source-verified)

Base `http://localhost:8080`. `library_id` is a **query param** on `/cdb`, the **last path segment**
on `/ajax`. All `/cdb/cmd` and `/ajax` responses are JSON (or msgpack if `Accept: application/x-msgpack`).

### 1.1 `/cdb/cmd/{which}/{version=0}` — calibredb over HTTP (the write path)

Source: `src/calibre/srv/cdb.py`. The server does
`result = module.implementation(db, notify_changes, *args)` where `args` = the **decoded request body
(a positional array)**. Every current command module is `version = 0`.

**Probed live on this machine — every calibredb subcommand is a valid module:**

| `{which}` | R/W | Anonymous | `implementation()` positional args (after `db, notify`) |
|---|---|---|---|
| `list` | R | ✅ | `fields, sort_by, ascending, search_text, limit, template=None` |
| `search` | R | ✅ | `query` |
| `fts_search` | R | ✅ | `query, adata` |
| `show_metadata`, `list_categories`, `custom_columns`, `export`, `catalog`, `backup_metadata`, `clone` | R | ✅ | — |
| `set_metadata` | **W** | ❌ gated | `action, *args` |
| `set_custom` | **W** | ❌ | `col, book_id, val, append` |
| `add`, `add_format`, `add_custom_column` | **W** | ❌ | `action, *args` / … |
| `remove`, `remove_format`, `remove_custom_column` | **W** | ❌ | `ids, permanent` / … |
| `saved_searches` | **W** | ❌ | `action, *args` |
| `embed_metadata`, `check_library`, `restore_database` | **W** | ❌ | — |
| `fts_index` | **W** | ❌ | `action, adata=None` (status/enable/disable/reindex) |

**The arg encoding (why our plain-JSON probe failed):** body must be `Content-Type: application/json`
**and a JSON array** (it is splatted with `*args`). The generic `"args are not valid encoded data"`
also fires on a missing/wrong Content-Type. Calibre's own client uses **msgpack**
(`Content-Type: application/x-msgpack`) via `calibre.utils.serialize`. Plain values (str/int/list/dict)
need no special encoding; only datetime/set/Metadata objects use the typed-canary wrapper.

**Response:** HTTP **200** always; body is `{"result": …}` on success or `{"err": …, "tb": …}` on a
handler error (error envelope, *not* an HTTP error code — the client must check for `err`).

**Dedicated write endpoints** (cleaner than `/cdb/cmd` for single-book edits, all write-gated):
- `POST /cdb/set-fields/{book_id}/{library_id}` — body `{"changes":{…}, "loaded_book_ids":[…]}`;
  supports field sets, `cover` (base64), `added_formats`/`removed_formats`. **Best single-book write.**
- `POST /cdb/add-book/{job_id}/{add_duplicates}/{filename}/{library_id}` — body = raw file bytes.
- `POST /cdb/delete-books/{book_ids}/{library_id}`, `POST /cdb/set-cover/{book_id}/…`,
  `POST /cdb/copy-to-library/{target}/…`.

### 1.2 `/ajax/` — read-only JSON (stable, documented-by-docstring)

| Endpoint | Params | Returns |
|---|---|---|
| `/ajax/library-info` | — | `{library_map, default_library}` |
| `/ajax/search/{lib}` | `query,num,offset,sort,sort_order,vl` | `{book_ids,total_num,num,offset,…}` |
| `/ajax/book/{id}/{lib}` | `category_urls,id_is_uuid,device_compatible` | full metadata dict |
| `/ajax/books/{lib}` | `ids=all\|1,2,3` | `{id: bookdict\|null}` |
| `/ajax/categories/{lib}` | `vl` | Tag-Browser top-level nodes |
| `/ajax/category/{enc}/{lib}` | `num,offset,sort,sort_order` | items + subcategories (paginated) |
| `/ajax/books_in/{cat}/{item}/{lib}` | `num,offset,sort,…` | `{book_ids,…}` |

`id_is_uuid=true` addresses books by UUID; `category_urls=false` is much cheaper for bulk pulls.

### 1.3 `/get/` and reader/structure routes

- `/get/{cover|thumb|thumb_WxH|opf|json|FORMAT}/{id}/{lib}` — cover/scaled-thumb/OPF-XML/JSON/file
  download. `?sz=full|NxM` controls thumb size.
- `/book-manifest/{id}/{fmt}` → JSON manifest (spine, TOC, resources, metadata, annotations) —
  Calibre renders the book server-side; first call may queue a job, poll until ready.
  **PDF can't be a manifest input** (no viewer input plugin) → 404. EPUB/AZW3 only.
- `/book-file/{id}/{fmt}/{size}/{mtime}/{name}` → individual extracted spine HTML/CSS/image.
  Closest thing to **location-resolved text extraction** the server offers (still no PDF page map).
- `/data-files/*`, `/get-note*`/`/set-note`, `/book-{get,set}-annotations` — notes/annotations CRUD.

### 1.4 `/interface-data/` (modern SPA backend) & OPDS

- `/interface-data/init` → field metadata + tag-browser config + id↔name maps (richer **schema**
  than `/ajax/` exposes). `/interface-data/field-{names,id-map}/{field}`, `/browse-field/{field}`,
  `/tag-browser`. **Undocumented/internal → use only for schema discovery, behind try/fallback.**
- **OPDS** (`/opds*`): Atom feeds for e-reader sync. **Skip** — strict XML subset of `/ajax`+`/cdb`.

### 1.5 Stability tiers (what to depend on)

- **Safe (documented):** `/ajax/*`, `/get/{cover,thumb,opf,FORMAT}`, OPDS, and the
  `calibredb --with-library URL` + `calibre-server` auth flags.
- **Source-only, version-fragile (pin + probe):** `/cdb/cmd` (the `{version}` segment exists *because*
  signatures change), `/cdb/set-fields` et al., `/book-manifest`, `/book-file`, all `/interface-data/*`.
  → Pin to Calibre 9.x, probe arg arity at startup, fall back to shelling `calibredb`.

---

## 2. Write access — RESOLVED (closes RESEARCH §6 #1 and #8)

Three ways to permit writes through the running server (`src/calibre/srv/handler.py check_for_write_access`):

| Mechanism | How | Fit for our localhost MCP |
|---|---|---|
| **`--enable-local-write`** | un-authenticated **local** connections may write | **Best fit** — MCP runs on the same Mac; no creds to manage. Default is read-only. |
| **`--trusted-ips`** | named IPs write without auth | Alt to local-write. |
| **`--enable-auth` + `--manage-users` user** | HTTP basic/digest as a write-permitted, **non-restricted** user | Needed only if server is exposed beyond localhost. A *per-library-restricted* user **cannot** use the db interface at all. |

**Decision input:** the GUI already runs a server on `:8080`. Two options:
(a) ask the user to add `--enable-local-write` to that server's settings (Preferences → Sharing over net),
or (b) the MCP shells **`calibredb --with-library http://localhost:8080/#Programming_Books`** for writes,
which speaks the `/cdb/cmd` msgpack protocol for us (no hand-rolled encoding) — but still needs the
server to permit the write (local-write or auth). **Recommendation: (b) for correctness now** (calibredb
handles encoding/version/auth), keep a direct-HTTP `/cdb/set-fields` client as a LATER optimization.

**Do NOT** use `calibre-debug`/`new_api`/direct SQLite for writes while the GUI is open — confirmed it
opens `metadata.db` directly with no networking → same single-writer lock as `calibredb` on a local path.

---

## 3. Plugin ecosystem — port the algorithms, don't wrap the plugins

**The headless verdict (confirmed from the manual):** `calibre-debug -r "Plugin" -- args` only works if a
plugin implements `cli_main()`. The high-value GUI plugins (Find Duplicates, Quality Check, Count Pages,
Manage Series, Reading List, Modify ePub) are `InterfaceAction` plugins with **no CLI → strictly GUI-bound.**
Metadata-source plugins run only inside Calibre's own download pipeline. **The only truly headless plugin is
FanFicFare** (real CLI), irrelevant to a tech library. So: **reimplement the logic in TS, or call native Calibre.**

All kiwidude / JimmXinu plugins are **GPL-3.0** → clean-room from documented behavior, don't copy code.

| Plugin | Capability | Our move |
|---|---|---|
| **Find Duplicates** | title/author match ladder (Identical / Similar=strip punct+prefixes / Soundex / Fuzzy) + **binary format hashing** | **Port → `find_duplicates`/`compare_books`.** Binary SHA dedupe is trivial + high-value. |
| **Quality Check** | 30+ rules: ISBN checksum, author_sort/title_sort mismatch, missing pubdate, series gaps, ePub structure | **Port the metadata-rule subset → `quality_report`.** Deterministic, easy. |
| **Count Pages** | word count + page estimate + readability (Flesch / Flesch-Kincaid / Gunning Fog), language-aware | **Port word-count + reading-level** (closed-form formulas) → quality/reading-time. |
| **Extract ISBN** | scan book text → ISBN-10/13 into identifiers | **Port → `isbn_tools`** (regex + checksum). |
| Manage Series | bulk `series_index` renumber | **Native** — plain DB field writes via `set_metadata`. No port. |
| Modify ePub / polish | font/jacket/punctuation edits without full convert | **Native** `ebook-polish` covers it; out of metadata scope → defer. |
| Goodreads / B&N / FictionDb / Baen (metadata sources) | extra metadata sources | **Skip** — fiction-skewed, weak for programming/technical titles. |
| lre-metadata | lib.rus.ec (RU) metadata | **Watch for the RU half** — scrape pattern worth studying; license unconfirmed. |
| Generate Cover / Job Spy / Action Chains / EpubMerge·Split / comics / DeDRM·KFX | Qt/GUI/out-of-scope | **Skip.** |

**Metadata sources (RESEARCH §6 #5 adjacent):** no third-party source beats the built-ins for tech books.
Keep the **Open Library → Google Books** chain; add **Amazon/ASIN** (via `fetch-ebook-metadata`) as fallback.

---

## 4. CLI tools beyond calibredb — what each unlocks

| Tool | Unlocks (vs calibredb) | MCP verdict | Mutates files? |
|---|---|---|---|
| **`calibre-debug -e worker.py`** | programmatic `new_api` (rich batched/transactional DB ops the HTTP API can't express) | **Internal capability, not a model tool.** One hardened JSON-over-stdout worker. Gate on GUI state (DB-not-locked fast path only). Never expose `-c` with model Python (injection); never `-s`. | DB writes if used for writes |
| **`calibre-debug --explode-book`** | EPUB/AZW3/DOCX → folder of per-spine HTML, scriptable (the only headless "editor") | **Use internally** for EPUB text extraction / structural chunking. | no (writes to a temp dir) |
| **`ebook-convert`** | clean text for embeddings: `--txt-output-formatting=markdown`, `--pdf-engine=calibre`, `--enable-heuristics`, `--unwrap-factor 0.45`, header/footer scrub | **Expose** as EPUB→text + PDF fallback. ⚠️ never `--asciiize` on RU (transliterates Cyrillic). | no (new output file) |
| **`ebook-meta`** | **file-level** metadata read/write incl. PDF read, `--to-opf`, `--get-cover` — works on loose/not-yet-imported files | **Expose read side** (ISBN/cover/OPF from raw-filename files before import); gate writes. | write opts only |
| **`fetch-ebook-metadata -o`** | one call fans out across Apple/Hardcover/Google/Amazon/Edelweiss/Open Library → normalized OPF + cover, no API keys | **Internal engine behind `calibre_recover_metadata`** (TOOLS #10) — the broad multi-source fallback. | only the cover file named |
| **`ebook-polish --opf`** | embed corrected metadata **into the EPUB/AZW3 file** (survives re-import) | Low priority; copy-then-polish, preview-first, write-gated. | **in place** if no out file |
| `calibre-smtp` | send book as email (Send-to-Kindle) | Optional; out of core remit. | no |
| `ebook-edit`, `ebook-viewer`, `web2disk`, `lrf*`, `calibre-parallel`, `calibre-customize` | GUI / dead formats / internal | Skip. | — |

### Text-extraction decision (RESEARCH §6 #6)
- **EPUB → text: good.** `--explode-book` (per-spine chunking) or `ebook-convert … markdown`.
- **PDF → text: weak by Calibre's own docs** ("a really, really bad format… multi-column/image/math/TOC
  not supported", **no OCR**). Best native recipe: `--pdf-engine=calibre --enable-heuristics
  --unwrap-factor 0.45` + regex header scrub. **Plan PyMuPDF/pdftotext as the primary PDF path**, Calibre
  as the EPUB path + PDF fallback. (Our library is mostly PDF → this matters.)

---

## 5. Net effect on the design / open questions

| RESEARCH §6 open question | Status after this analysis |
|---|---|
| #1 write access path | **RESOLVED.** Route writes through the running Content Server: shell `calibredb --with-library http://localhost:8080/#Lib` (server handles cdb encoding/auth), with the server permitting writes via `--enable-local-write`. |
| #8 Content Server write auth | **RESOLVED.** Writes need `--enable-local-write` (localhost, our case) OR an authenticated non-restricted user. Confirmed live: anonymous writes are blocked. |
| #2 FTS strategy | `fts_index`/`fts_search` callable over `/cdb/cmd` too; still book-level only, no location. Our embeddings remain the location-resolving layer. |
| #6 PDF extraction quality | **RESOLVED.** Use external PyMuPDF/pdftotext for PDF; Calibre for EPUB. |
| #7 `/ajax/` stability | `/ajax` safe; `/cdb`,`/book-manifest`,`/interface-data` are source-only → pin 9.x + probe + calibredb fallback. |
| New: plugin reuse | **Port** Find Duplicates / Quality Check / Count Pages / Extract ISBN algorithms (GPL → clean-room). No plugin is headlessly wrappable. |

**Sources:** live probe of `:8080` (this machine); `github.com/kovidgoyal/calibre` `src/calibre/srv/{cdb,ajax,content,code,opds,books,handler,routes}.py`, `utils/serialize.py`, `db/cli/`; `manual.calibre-ebook.com` (`server`, `conversion`, `metadata`, `calibre-debug`, `calibredb`, CLI pages); kiwidude68/calibre_plugins + JimmXinu repos; MobileRead plugin threads. All 2026-06-27.
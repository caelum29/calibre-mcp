# CLAUDE.md — Calibre MCP Server

<!-- Project memory for the calibre-mcp build: the invariants a fresh session needs BEFORE touching
     code today. Chronological build history → docs/JOURNAL.md. Locked decisions + deferred registry
     → docs/DECISIONS.md. Keep this file lean; status narrative does NOT belong here. -->

## Macro goal

Build **the most capable Calibre MCP server in existence** — a single, reliable
TypeScript server that replaces the current two-server hack (`FaceDeer/calibre_full_mcp_server`
for reads + `shell-command-mcp`/`calibredb` for writes) running in Claude Desktop today.

It must:
1. **Match the full tool surface of every known Calibre MCP server** (feature parity baseline).
2. **Add semantic search** — the headline differentiator no existing TS server has.
3. **Fix the write path** that breaks in Cowork (`MCP error -32602`, args-as-strings).

**Two surfaces (Artem's framing).** The server works at two scopes: the **catalog/library**
(update the library, book metadata, tags, bulk ops, dedupe, enrich) and a **single book** (extract
content — whole book or a chunk — and keyword/semantic search *within* one book). Semantic search
spans both: **across the whole library OR one book separately** — a `scope: library|book` param, not
extra tools (see `docs/TOOLS.md`).

In one line: every useful tool the field has *plus* meaning-based search (library- *and* book-scoped)
*plus* safe, hardened writes.

## Target environment (ground-truth, do not re-derive)

- Calibre **9.10**, macOS Apple Silicon (macOS 26 beta), Node **v24**.
- Library: **~801 books** in `Programming Books` (default) + a `Reaserch Books` lib, under `~/Documents/Books/`.
- Mostly **PDF/EPUB, technical, EN + RU**. Many have raw filenames (`795731065`, `top.dvi`, `B0CZS7H23N.pdf`) → metadata recovery matters.
- Calibre **GUI is normally running** + Content Server live on `:8080`.
- Clients: Claude Desktop, Claude Code CLI, Cowork. Transport: **stdio**.

## Hard constraints / gotchas (these killed earlier attempts)

- **GUI-concurrency lock is real (reproduced).** With the app open, direct `calibredb`/SQLite/DB-API
  access is refused or dangerous. Safe live paths: Content Server HTTP (reads) or `calibredb`
  routed *through* the server URL. Treat the DB as **read-mostly**; never race the GUI on writes.
  **Write path RESOLVED** (`docs/CAPABILITIES.md` §2): route writes through the running server — shell
  `calibredb --with-library http://localhost:8080/#Lib` (it speaks `/cdb/cmd` for us), the server
  permitting writes via `--enable-local-write`; a direct `/cdb/set-fields` HTTP client is a LATER opt.
- **`-32602` serialization bug** (our Cowork failure) is client-side, confirmed, unfixed. Defense =
  **Zod coercion** on every input: `z.coerce.number()`, `z.preprocess(JSON.parse, …)` for arrays/objects,
  unions for ids. **Never** `z.coerce.boolean()` on `"false"`.
- **stdout is sacred** on stdio — all logs to **stderr**. One stray `console.log` corrupts the stream.
- **FTS is book-level only** (no PDF page / EPUB spine location) and **not enabled** on this library yet.
  Calibre has **no OCR**; PDF is the worst conversion/extraction input.
- **Writes gated by default** — read-only unless an explicit env flag + per-tool `annotations` allow it.

## Engineering invariants (constrain every edit)

- **Write gate is two-key.** The master gate is `CALIBRE_MCP_ENABLE_WRITE` (truthy) in `config.ts`;
  `server.ts` `.disable()`s every `write:true` tool when it's off. On top, each write tool carries
  per-tool `annotations` and is **preview-first** (`preview`/`confirm`/`apply` in-band params, not MCP
  elicitation — see `docs/DECISIONS.md` D-003). Path-taking writes (`calibre_add_book`) enforce a
  **path whitelist** (`CALIBRE_MCP_ADD_ROOTS`, `realpathSync` boundary check).
- **libId-resolve pattern for ALL `calibredb` calls.** `calibredb --with-library` needs the library
  **ID** (`Programming_Books`), **not** the display name (`Programming Books`, which 404s). Resolve
  display→libId via `content.resolveLibraryId` first, then pass it as `calibredb` `opts.library`.
  Read paths (FTS, `calibre_ping`) resolve the libId too. (see `docs/DECISIONS.md` D-008.)
- **SDK-free seam.** Tool handlers/schemas/domain code never import `@modelcontextprotocol/sdk`; only
  the transport/registration layer (`server.ts` + `run-stdio.ts`) does. `tools/types.ts` structurally
  mirrors `CallToolResult`/`ToolAnnotations` so handlers stay SDK-free. Isolates the SDK-v2 migration.
- **Return-not-throw `isError` contract.** Handlers return a result with `isError` + an actionable
  message steering the model's next step; they don't throw across the SDK boundary.
- **Tool-count ≤ ~20.** Fold related calibredb subcommands into task/intent tools; don't 1:1-mirror
  the CLI (see the policy below + `docs/DECISIONS.md` D-005). Currently **15 model-facing tools**
  (`docs/TOOLS.md`) + 1 widget-internal (`calibre_board_data`, `_meta.ui.visibility ["app"]`, D-017).

## Tool surface to build

Baseline = the **capability surface** of FaceDeer (full read/write/convert/import/export +
per-library permission model) — **18 = a capability target, not a tool-count target**. See
`docs/RESEARCH.md` §5.0 for the verified inventory and the coverage table.

**Tool-count target: keep the model-facing surface ≤ ~20 task/intent tools.** Field + research
evidence (`docs/DESIGN.md` §9.1): selection accuracy degrades as the number of *confusable* tools per
query grows (OpenAI's "<20" is a soft heuristic; the measured degradation zone is ~30–50 similar
tools — we must stay under it). So **don't 1:1-mirror calibredb subcommands as tools**; fold related
operations into fewer **task/intent** tools (e.g. one `calibre_recover_metadata` doing
ISBN→OpenLibrary→GoogleBooks internally, not three chainable tools). Cheap evidence-backed wins:
**namespacing**, **tool consolidation**, lean tool-def token budgets, sharp **descriptions** (the
10x selection lever). At ≤20 we do **not** need RAG-over-tools / MCP-Zero machinery internally.

> The differentiator list, the consolidated **14→15 LOCKED tool list**, and its name-mapping live in
> `docs/DECISIONS.md` D-005 (rationale) and `docs/TOOLS.md` (build list of record).

## Tech stack (decided in research, confirm in design)

- **`@modelcontextprotocol/sdk` 1.29.0** (protocol `2025-11-25`), `registerTool` + `outputSchema`/`structuredContent`.
  Do **not** wait for SDK v2 (alpha); isolate the SDK behind a thin layer to de-risk migration.
- **Zod** for input schemas (with the coercion layer above).
- **Semantic search:** `multilingual-e5-small` (LOCKED — `docs/DECISIONS.md` D-001/D-010), in-memory
  brute-force cosine on `node:sqlite` BLOBs + hybrid FTS5/RRF; full pipeline in `docs/SEMANTIC-SEARCH.md`.
- **Clean Architecture:** keep tool logic (schemas, handlers, embedding/DB code) free of SDK types.
- Package via **npx** + **MCPB** bundle for Claude Desktop (release recipe → `docs/DECISIONS.md` D-006).

## Reusable code (licensing)

**Decision (2026-06-27): our server is MIT/Apache (permissive), clean-room** (`docs/DECISIONS.md` D-004).
Operating rules:
- ✅ Call Calibre as a *program* (shell `calibredb`, Content Server HTTP, `ebook-convert`,
  `fetch-ebook-metadata`) — mere use, GPL does not propagate. This is our primary interface.
- ✅ Read Calibre/plugin GPL source to *understand the contract* (`/cdb/cmd` arg shapes in
  `src/calibre/db/cli/cmd_*.py`, encoding in `utils/serialize.py`, query grammar in `db/search.py`,
  `check_isbn`/`author_to_author_sort` in `ebooks/metadata/`).
- ✅ Reimplement algorithms *independently* from the manual / observed behavior / well-known formulas
  (ISBN checksum, Flesch/Fog, SHA dedupe). **Do NOT line-by-line translate GPL code** (Calibre or
  kiwidude/JimmXinu plugins — all GPL-3.0) into TS; that would force our server to be GPL.
- ✅ Copy freely from permissive sources only (the attribution list is in `docs/DECISIONS.md`).

## Working rules

- English for all code, comments, docs (per global policy). Respond to Artem casually, concise, in markdown.
- **Cite first-party sources; flag anything unconfirmed** — don't trust memory for versions/APIs/tool lists.

## Project artifacts

- `docs/JOURNAL.md` — chronological build history + status archive (the session archaeology; append-only).
- `docs/DECISIONS.md` — registry of LOCKED decisions (`D-NNN`) + the consolidated Deferred/LATER registry.
- `docs/RESEARCH.md` — the foundation report (6 sections: capability inventory, MCP best practices, server comparison, §5 tool catalog + §5.0 FaceDeer coverage, open questions). §5/§6 superseded downstream.
- `docs/CAPABILITIES.md` — deep capability + Content-Server-API analysis; **resolves the write path/auth, PDF-extraction, and `/ajax` stability questions** and maps GPL plugins → port-the-algorithm differentiators.
- `docs/local-groundtruth.md` — firsthand probes of this machine's Calibre (CLI subcommands, GUI lock, Content Server `/ajax/` shapes).
- `docs/calibredb_help.txt` — full `calibredb` v9.10 CLI dump.
- Decision docs: `docs/DESIGN.md`, `docs/TOOLS.md` (build list of record), `docs/DISTRIBUTION.md`, `docs/INTERACTIVITY.md`, `docs/PRODUCT-DECISIONS.md`.

## Searching the docs corpus (qmd)

`docs/` is indexed for semantic + keyword search under the **`calibre-docs`** qmd
collection. Prefer it over blind `grep`/`Read` when hunting a decision, rationale,
or design detail across the corpus. The `qmd` skill (`.claude/skills/qmd/`) has the
full workflow; the short version:

```bash
qmd query "why route writes through the Content Server" -c calibre-docs   # hybrid + rerank
qmd search "libId resolve" -c calibre-docs                                # fast BM25
```

Always scope with `-c calibre-docs` — the qmd index is global and shared with
unrelated projects. After editing `docs/`, run `qmd update && qmd embed` to refresh.
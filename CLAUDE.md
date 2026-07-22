# CLAUDE.md — Calibre MCP Server

<!-- Project memory for the calibre-mcp build: the invariants a fresh session needs BEFORE touching
     code today. Chronological build history → docs/dev/JOURNAL.md. Locked decisions + deferred registry
     → docs/dev/DECISIONS.md. Longer policy/context sections are @imported from docs/claude/.
     Keep this file lean; status narrative does NOT belong here. -->

## Macro goal

Build **the most capable Calibre MCP server in existence** — a single, reliable
TypeScript server that replaces the current two-server hack (`FaceDeer/calibre_full_mcp_server`
for reads + `shell-command-mcp`/`calibredb` for writes) running in Claude Desktop today.

It must:
1. **Match the full tool surface of every known Calibre MCP server** (feature parity baseline).
2. **Add semantic search** — the headline differentiator no existing TS server has.
3. **Fix the write path** that breaks in Cowork (`MCP error -32602`, args-as-strings).

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
  **Write path RESOLVED** (`docs/dev/CAPABILITIES.md` §2): route writes through the running server — shell
  `calibredb --with-library http://localhost:8080/#Lib` (it speaks `/cdb/cmd` for us), the server
  permitting writes via `--enable-local-write`; a direct `/cdb/set-fields` HTTP client is a LATER opt.
- **`-32602` serialization bug** (our Cowork failure) is client-side, confirmed, unfixed. Defense =
  **Zod coercion** on every input: `z.coerce.number()`, `z.preprocess(JSON.parse, …)` for arrays/objects,
  unions for ids. **Never** `z.coerce.boolean()` on `"false"`.
- **stdout is sacred** on stdio — all logs to **stderr**. One stray `console.log` corrupts the stream.
- **FTS is book-level only** (no PDF page / EPUB spine location) and **not enabled** on this library yet.
  Calibre has **no OCR**; PDF is the worst conversion/extraction input.
- **Writes gated by default** — read-only unless an explicit env flag + per-tool `annotations` allow it.
- **Clients strip `structuredContent`** (Claude Desktop drops it from the tool-result notification;
  some clients surface only text blocks). Anything the model must act on — ranked hits, excerpts,
  `nextCursor` tokens — must ALSO appear in the text content; the cover-board widget refetches its
  data via the widget-internal `calibre_board_data` tool for the same reason (#26, D-017).

## Engineering invariants (constrain every edit)

- **Write gate is two-key.** The master gate is `CALIBRE_MCP_ENABLE_WRITE` (truthy) in `config.ts`;
  `server.ts` `.disable()`s every `write:true` tool when it's off. On top, each write tool carries
  per-tool `annotations` and is **preview-first** (`preview`/`confirm`/`apply` in-band params, not MCP
  elicitation — see `docs/dev/DECISIONS.md` D-003). Path-taking writes (`calibre_add_book`) enforce a
  **path whitelist** (`CALIBRE_MCP_ADD_ROOTS`, `realpathSync` boundary check).
- **libId-resolve pattern for ALL `calibredb` calls.** `calibredb --with-library` needs the library
  **ID** (`Programming_Books`), **not** the display name (`Programming Books`, which 404s). Resolve
  display→libId via `content.resolveLibraryId` first, then pass it as `calibredb` `opts.library`.
  Read paths (FTS, `calibre_ping`) resolve the libId too. (see `docs/dev/DECISIONS.md` D-008.)
- **SDK-free seam.** Tool handlers/schemas/domain code never import `@modelcontextprotocol/sdk`; only
  the transport/registration layer (`server.ts` + `run-stdio.ts`) does. `tools/types.ts` structurally
  mirrors `CallToolResult`/`ToolAnnotations` so handlers stay SDK-free. Isolates the SDK-v2 migration.
- **Return-not-throw `isError` contract.** Handlers return a result with `isError` + an actionable
  message steering the model's next step; they don't throw across the SDK boundary.
- **Tool-count ≤ ~20.** Fold related calibredb subcommands into task/intent tools; don't 1:1-mirror
  the CLI (`docs/claude/tool-surface.md` + `docs/dev/DECISIONS.md` D-005). Currently **18 model-facing
  tools** — 17 task tools (`docs/dev/TOOLS-spec.md`) + `calibre_ping` — plus 1 widget-internal
  (`calibre_board_data`, `_meta.ui.visibility ["app"]`, D-017).
- **Never report a committed write as failed.** Routed writes commit server-side *before* `calibredb`
  replies (#33): a failing post-write diff re-read degrades to a success result with the intended-value
  diff, and a CLI timeout is verified against a re-read — confirmed → success, unconfirmed → steer the
  model to `calibre_get_book` before retrying. Applies to `calibre_update_book` and the
  `calibre_bulk_update` apply loop.
- **User/model-supplied regex compiles via `src/tools/user-regex.ts`**, never bare `new RegExp()`.
  It accepts leading PCRE-style inline flags (`(?i)…`) by folding them into JS RegExp flags and gives
  an explicit error for inexpressible ones like `x` (#30).
- **Content cursors are opaque and bound.** `calibre_get_content` cursors encode
  `{offset, id, format}` and reject cross-book/format replay; decode is tolerant (never throws) but
  invalid/hand-built cursors get an actionable error, not a silent restart at 0 (#26). The numeric
  `offset` param is the cursor-free jump path (e.g. a search hit's `charStart`) — mutually exclusive
  with `cursor` (#28).

## Working rules

- English for all code, comments, docs (per global policy). Respond to Artem casually, concise, in markdown.
- **Cite first-party sources; flag anything unconfirmed** — don't trust memory for versions/APIs/tool lists.

## Imported context

- @docs/claude/tool-surface.md — two-surfaces framing, FaceDeer capability baseline, ≤20 tool-count policy
- @docs/claude/stack-and-licensing.md — locked tech stack + GPL clean-room operating rules
- @docs/claude/artifacts-and-qmd.md — docs corpus map + qmd search workflow

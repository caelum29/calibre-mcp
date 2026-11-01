# CLAUDE.md — Calibre MCP Server

<!-- Project memory for the calibre-mcp build: the invariants a fresh session needs BEFORE touching
     code today. Chronological build history → docs/dev/JOURNAL.md. Locked decisions + deferred registry
     → docs/dev/DECISIONS.md. Longer policy/context sections are @imported from docs/claude/.
     Machine-specific facts (Calibre version, library names/sizes) → gitignored CLAUDE.local.md.
     Keep this file lean; status narrative does NOT belong here. -->

## Goal

The most capable Calibre MCP server: FaceDeer-parity capability surface (full
read/write/convert/import/export + per-library permissions — a capability target, not a tool-count
target; `docs/dev/RESEARCH.md` §5.0), plus **semantic search**, plus a write path that survives Cowork.

**Two surfaces.** The server works at two scopes: the **library** (metadata, tags, bulk ops, dedupe,
enrich) and a **single book** (extract content — whole or chunked — and search *within* it). Semantic
search spans both via a `scope: library|book` param, not extra tools.

## Environment

- Calibre **GUI is normally running** + Content Server live; libraries are addressed by ID, and
  names/sizes differ per user — discover them via `calibre_list_libraries`, don't hardcode.
- Libraries are mostly technical PDF/EPUB, many with raw filenames → metadata recovery matters.
- Clients: Claude Desktop, Claude Code CLI, Cowork. Transport: **stdio**.

## Hard constraints / gotchas (these killed earlier attempts)

- **GUI-concurrency lock is real (reproduced).** With the app open, direct `calibredb`/SQLite/DB-API
  access is refused or dangerous. Reads go over Content Server HTTP; writes go through the running
  server: `calibredb --with-library http://localhost:8080/#<libId>` (needs `--enable-local-write`).
  Never race the GUI on writes (`docs/dev/CAPABILITIES.md` §2).
- **`-32602` serialization bug** (our Cowork failure) is client-side, confirmed, unfixed. Defense =
  **Zod coercion** on every input: `z.coerce.number()`, `z.preprocess(JSON.parse, …)` for arrays/objects,
  unions for ids. **Never** `z.coerce.boolean()` on `"false"`.
- **stdout is sacred** on stdio — one stray write corrupts the JSON-RPC stream. Enforced by oxlint
  `no-console`; log via `src/logging.ts` (→ stderr).
- **FTS is book-level only** (no PDF page / EPUB spine location). Calibre has **no OCR**; PDF is the
  worst conversion/extraction input.
- **Clients strip `structuredContent`** (Claude Desktop drops it from the tool-result notification;
  some clients surface only text blocks). Anything the model must act on — ranked hits, excerpts,
  `nextCursor` tokens — must ALSO appear in the text content; the cover-board widget refetches its
  data via the widget-internal `calibre_board_data` tool for the same reason (#26, D-017).

## Engineering invariants (constrain every edit)

- **Write gate is two-key.** Master gate `CALIBRE_MCP_ENABLE_WRITE` (`config.ts`) — `server.ts`
  disables every `write:true` tool when off — plus per-tool `annotations`. A new write tool must:
  set `write:true`; be **preview-first** if destructive or bulk (in-band `preview`/`confirm`/`apply`
  params, not MCP elicitation — D-003; single-book update/add write directly); and enforce the
  `CALIBRE_MCP_ADD_ROOTS` path whitelist (`src/tools/add-path.ts`) if it takes a filesystem path.
- **libId-resolve pattern for ALL `calibredb` calls.** `calibredb --with-library` needs the library
  **ID** (`Programming_Books`), **not** the display name (`Programming Books`, which 404s). Resolve
  display→libId via `content.resolveLibraryId` first, then pass it as `calibredb` `opts.library` (D-008).
- **SDK-free seam.** Tool handlers/schemas/domain code never import the MCP SDK
  (`@modelcontextprotocol/server`/`client`/`core`); only the transport/registration layer
  (`server.ts` + `run-stdio.ts`) does. `tools/types.ts` keeps a hand-written structural mirror of
  `CallToolResult`/`ToolAnnotations` — no re-export from `@modelcontextprotocol/core` (#121) — and tool
  modules declare raw Zod shapes; `server.ts` wraps them in `z.object()` for v2's Standard Schema API.
- **Return-not-throw.** Handlers return `isError` + an actionable message steering the model's next step,
  via `toolError(code, message)` — `code` from the closed set in `src/domain/error-codes.ts` (a literal, or
  `errorCodeFor(err)` for a caught error; `test/domain/error-codes.test.ts` enforces it, #249).
- **Tool-count ≤ ~20.** Selection accuracy degrades as confusable tools pile up (`docs/dev/DESIGN.md`
  §9.1), so fold related calibredb subcommands into task/intent tools — one `calibre_recover_metadata`,
  not three chainable ones; don't 1:1-mirror the CLI (D-005; build list of record =
  `docs/dev/TOOLS-spec.md`). Currently **<!-- tool-count:modelFacing -->19<!-- /tool-count:modelFacing --> model-facing
  tools** — <!-- tool-count:task -->18<!-- /tool-count:task --> task tools + `calibre_ping` — plus
  <!-- tool-count:appOnly -->2<!-- /tool-count:appOnly --> widget-internal (`calibre_board_data`, `calibre_open_book`;
  `_meta.ui.visibility ["app"]`, D-017). The counts are generator-maintained from
  `docs/tool-catalog.json` (`pnpm catalog`).
- **Never report a committed write as failed.** Routed writes commit server-side *before* `calibredb`
  replies, so timeouts and dropped connections are verified via `src/app/write-policy.ts` —
  confirmed → success, unconfirmed → steer to `calibre_get_book`, never a plain failure. Only
  idempotent `set_metadata` writes retry; timeouts never do.
- **`src/app/` = use-cases** (write policy, book selection, bundles, index-book, index build, ping index report, id resolution, ISBN scan): domain +
  ports only — no MCP result types, no concrete adapters (`test/architecture.test.ts`, #260).
- **User/model-supplied regex compiles via `src/tools/user-regex.ts`**, never bare `new RegExp()`.
- **Content cursors are opaque and bound** to `{id, format}` — invalid ones get an actionable error,
  never a silent restart at 0. The numeric `offset` param is the cursor-free jump path, mutually
  exclusive with `cursor`.

## Working rules

- **Cite first-party sources; flag anything unconfirmed** — don't trust memory for versions/APIs/tool lists.

## Imported context

- @docs/claude/stack-and-licensing.md — locked stack choices + GPL clean-room operating rules
- @docs/claude/artifacts-and-qmd.md — docs corpus map + qmd search workflow

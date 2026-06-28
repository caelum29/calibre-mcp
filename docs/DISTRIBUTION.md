# DISTRIBUTION.md — Publishing & onboarding (scope of record)

> **Status:** Distribution decisions LOCKED 2026-06-27 (Artem). Builds on DESIGN.md §8 packaging note.
> **Core premise:** this is a **locally-run** server — every user runs it on their own machine
> against their **own** Calibre library. NOT a hosted/shared service (each user's library + Content
> Server live on their own box). "Public" = publish an easy-to-install package, not stand up a server.

## Reality-check (why local-only)

The server talks to `localhost:8080` Content Server + local `calibredb`/`ebook-convert` + local
embeddings. There is no shared backend to host. A true remote deployment would require each user to
expose their Calibre to the internet (auth/TLS/tunnel) — out of scope, security-negative. So we ship
a **package that runs locally**, distributed through three channels below.

## Cowork reach — via the Claude Desktop bridge (no remote hosting)

Claude Cowork runs in a **sandboxed VM**; local **stdio** servers can't connect to it directly.
The supported path: configure the server in **Claude Desktop**, and Desktop **bridges** the local
stdio server into the Cowork VM via its SDK layer. So Cowork works with the *same* local Calibre —
**zero extra code**, just documentation. (This is also why our earlier `-32602` surfaced in Cowork.)
A direct HTTP/remote transport for Cowork is explicitly **deferred** (would mean exposing Calibre).

---

## Decisions (locked)

1. **Transport = stdio-only.** Covers all three clients: Claude Desktop (native one-click),
   Claude Code CLI (native), Cowork (via the Desktop bridge). No HTTP transport in v1.
2. **Embeddings model = opt-in.** Base server stays light and dependency-thin. Semantic search
   (`calibre_semantic_search` + `calibre_build_index`) is an explicit opt-in: the model
   (`paraphrase-multilingual-MiniLM`) downloads on first index build into an explicit `cacheDir`.
   Server runs fully without it; semantic tools surface a clear "run build-index to enable" message.
3. **Identity = `io.github.caelum29/calibre-mcp`** (reverse-DNS, tied to GitHub `caelum29`);
   npm package name `calibre-mcp`.

## Distribution channels

| Channel | Audience | Mechanism | Notes |
|---|---|---|---|
| **npm** | Claude Code CLI + any stdio client | `npx calibre-mcp`; semver; CI release | primary dev path |
| **MCPB bundle** (`.mcpb`) | Claude Desktop | one-click install, no terminal/config files | `user_config` for setup fields |
| **Official MCP Registry** | discoverability / marketplaces | publish as `io.github.caelum29/calibre-mcp` (Registry CLI) | reverse-DNS, GitHub-verified |
| **Cowork** | Cowork users | **automatic via Desktop bridge** | docs only, no code |

### MCPB `user_config` fields (Claude Desktop one-click setup)
- `serverUrl` (default `http://localhost:8080`)
- `library` (default = server's default library; auto-detect via `/ajax/library-info`)
- `enableWrite` (boolean → sets `CALIBRE_MCP_WRITE`; **default off**)
- `embeddingsCacheDir` (default OS cache dir; for opt-in semantic search)

---

## What "public" changes in scope (vs the Artem-specific build)

- **De-hardcode everything machine-specific.** No baked-in `Programming_Books`, ~801-book counts,
  or `~/Documents/Books/` path. Auto-detect library via `/ajax/library-info`; everything else config.
- **Cross-platform binary discovery.** Locate `calibredb`/`ebook-convert`/`ebook-meta` on
  macOS / Windows / Linux (Calibre install paths differ); fall back to PATH; clear error if absent.
- **Safe defaults for strangers' machines.** Writes **OFF** by default; path-whitelist for
  add/export; never expose injection-prone paths. Setup errors must be actionable
  ("Calibre Content Server not found at :8080 — start it / set serverUrl").
- **Onboarding detection.** At startup probe: Calibre binaries present? Content Server reachable?
  Writes permitted (`--enable-local-write`)? Log findings to **stderr** (stdout is sacred) and guide.
- **Release engineering.** semver, CHANGELOG, GitHub Actions → build npm + `.mcpb` + Registry publish.

---

## LATER (deferred distribution work)

| Deferred | Why now-no | Adopt when |
|---|---|---|
| HTTP/SSE transport mode | needs auth/TLS + exposing local Calibre; security-negative | a real self-host/remote demand appears |
| `supergateway` HTTP-bridge recipe for Cowork | Desktop bridge already covers Cowork | users without Desktop need direct Cowork |
| Bundling the embeddings model in the package | bloats MCPB/npm; opt-in download is leaner | offline-install demand |
| Homebrew / winget native installers | npm + MCPB cover the clients | broad non-Claude demand |
| `generate_claude_config` self-bootstrap tool | MCPB one-click removes most config friction | CLI onboarding polish |

## Open params (decide during implementation)

- **MCPB size budget** vs opt-in model download UX — confirm Desktop's bundle size limits.
- **Binary discovery order** per-OS (bundled Calibre.app path vs PATH vs user config).
- **First-run model download UX** inside the opt-in flow — progress to stderr, resumable cache.
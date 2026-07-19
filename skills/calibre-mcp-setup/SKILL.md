---
name: calibre-mcp-setup
description: "Install and verify the calibre-mcp server, end to end. Guides an agent from 'Calibre is installed' to a verified working MCP connection: preflight (Node, calibredb, Content Server — macOS/Windows/Linux commands), client-specific install (Claude Code plugin or claude mcp add, Claude Desktop .mcpb or JSON config, Cowork via Desktop, any other MCP client via a generic mcpServers block), config (library, write gate), calibre_ping verification with semantic-status triage, enabling semantic search in the .mcpb bundle, and upgrade/uninstall. Use when the user wants to set up calibre-mcp, connect Claude or another agent to their Calibre library, enable semantic search, upgrade, or fix a broken install. Triggers: install calibre-mcp, set up calibre, connect my calibre library, calibre not working, semantic search unavailable, upgrade calibre-mcp."
---

<!--
Cross-agent notes (informational; ignored by host agents):
  - Compatible skill roots: Claude Code (~/.claude/skills, .claude/skills), GitHub
    Copilot CLI (~/.copilot/skills, ~/.agents/skills, .github/skills), Amp
    (.agents/skills, ~/.config/agents/skills). Installable via
    `npx skills@latest add caelum29/calibre-mcp`.
  - Needs only shell access (and, for Phase 3, the calibre-mcp tools once loaded).
  - Windows commands assume PowerShell; macOS/Linux assume any POSIX shell.
-->

# calibre-mcp setup

Take this machine from "has Calibre" to "calibre-mcp verified working in the user's
client(s)". Work phase by phase; a phase is complete only when its VERIFY produced the
stated evidence as a tool result in this session — never claim progress without one.
If a VERIFY fails twice, stop and report; don't improvise workarounds.

**Scope**: install + configure + verify, including guiding the user through the
Calibre-side configuration (Content Server, write permission). **Out of scope**:
building a whole-library semantic index (offer the command, don't run it), modifying
the Calibre library, installing Calibre or Node themselves.

**Decisions reserved for the user** (never default them yourself): enabling the write
gate, starting the Content Server (GUI vs headless daemon), running the index build,
and which client(s) to install into.

## Phase 0 — Preflight

Check in order. Apply reversible remediations; stop for the rest.

1. **Node ≥ 22.5** (not needed for the Claude Desktop `.mcpb` path — Desktop ships its
   own runtime): `node --version`. Missing/old → if the user only wants Desktop,
   continue; otherwise stop (user installs Node).
2. **Calibre present** — try `calibredb --version`, then the platform default:
   - macOS: `/Applications/calibre.app/Contents/MacOS/calibredb --version`
   - Windows: `& "C:\Program Files\Calibre2\calibredb.exe" --version`
   - Linux: `/usr/bin/calibredb --version`
   Missing → stop; user installs from https://calibre-ebook.com/download.
   (The server auto-discovers calibredb per platform — a non-default location only
   needs `CALIBRE_MCP_CALIBREDB_PATH` later.)
3. **Content Server reachable**: `curl -s http://localhost:8080/interface-data/init`
   (PowerShell: `curl.exe`, or `Invoke-WebRequest`). Non-default port → adjust the URL
   here and set `CALIBRE_MCP_SERVER_URL` in Phase 2. Not reachable → tell the user:
   Calibre → *Connect/share → Start Content server*, or headless
   `calibre-server --port 8080`; wait, re-verify. Don't start it yourself — GUI vs
   daemon is their call. Warn: the two are **mutually exclusive** — Calibre's server
   lock is global, so `calibre-server` refuses to start while the GUI is open
   ("Another calibre program … is running"). GUI open = use the GUI's own Content
   Server, nothing else.
4. **Optional, note only**: `pdftotext -v` (poppler: `brew install poppler` /
   `winget install poppler` / distro package). Absent = degraded PDF extraction, not a
   blocker. Footnote it; install nothing.

VERIFY: 2 and 3 green (1 too, unless Desktop-only).

## Calibre-side setup (reference — walk the user through, don't click for them)

How Calibre itself should be configured for calibre-mcp. All server access goes
through the Content Server; the library database is never touched directly.

1. **Install Calibre** (user's job): https://calibre-ebook.com/download — any recent
   version; the server is developed against 9.x.
2. **Content Server on, ideally always-on.** One-off: Calibre → *Connect/share →
   Start Content server*. Better: Preferences → *Sharing over the net* → enable the
   run-automatically-at-startup option, so the server survives Calibre restarts and
   MCP sessions never hit a dead port. Default port 8080 is set on the same page —
   if changed, mirror it in `CALIBRE_MCP_SERVER_URL`.
3. **Headless alternative** (no GUI, e.g. a NAS): `calibre-server --port 8080
   [--enable-local-write] /path/to/library`. Remember the global lock from Phase 0:
   this cannot run while the GUI is open — pick one.
4. **Writes need BOTH gates open** (leave both closed for read-only use):
   - *Calibre side*: Preferences → *Sharing over the net* → *Advanced* →
     **"Allow un-authenticated local connections to make changes to the library"**,
     then restart the Content Server from the GUI (headless: `--enable-local-write`).
     With it off, every routed write returns an actionable "write refused" — this
     toggle is the first thing to check when that appears.
   - *MCP side*: `CALIBRE_MCP_ENABLE_WRITE=1` (Phase 2). Without it, write tools
     aren't even advertised.
5. **No Content Server auth for localhost.** calibre-mcp connects unauthenticated;
   a user/password-protected Content Server is untested — if the user needs remote
   auth, keep a separate unauthenticated localhost instance for calibre-mcp or stop
   and report.
6. **Multiple libraries** work out of the box: the GUI's server exposes every known
   library; tools take a `library` param (display name is fine), and
   `CALIBRE_MCP_LIBRARY` sets the default.

## Phase 1 — Which client(s)?

Detect the harness you're running in, then ask the user ONE question — where they want
calibre-mcp (multiple allowed):

| Client | Path |
|---|---|
| Claude Code | (a) plugin — server + skills + config dialog, auto-updates — or (b) server only |
| Claude Desktop | (c) `.mcpb` one-click, or (d) JSON config |
| Cowork | (e) = configure Claude Desktop; Desktop bridges local servers into Cowork automatically |
| Anything else (Copilot, Amp, Cursor, Codex, …) | (f) generic MCP config + skills via skills.sh |

Don't proceed on a guess.

## Phase 2 — Install

**(a) Claude Code plugin**
```sh
claude plugin marketplace add caelum29/calibre-mcp
claude plugin install calibre-mcp@caelum29
```
Then surface the userConfig options (server URL, library, write gate, add roots) via
`/plugin configure calibre-mcp@caelum29` or `--config KEY=VALUE`. Write gate stays OFF
unless the user explicitly says otherwise.

**(b) Claude Code, server only**
```sh
claude mcp add calibre -- npx -y calibre-mcp
```

**(c) Claude Desktop `.mcpb`** — user downloads the `.mcpb` asset from
https://github.com/caelum29/calibre-mcp/releases/latest and opens it; Desktop prompts
for settings. Manual by design — give the link and stop this branch. Note: the bundle
ships without the embeddings dependency (semantic search reports unavailable; keyword
FTS works fully).

*Enabling semantic search in the `.mcpb` install* (optional, on request): run
`npm install @huggingface/transformers` **inside the extension directory**
(Settings → Extensions → Advanced shows the path; macOS:
`~/Library/Application Support/Claude/Claude Extensions/local.mcpb.<id>.calibre-mcp/`),
then **restart the server** — toggle the extension off/on in Settings → Extensions, or
restart Desktop. The restart is mandatory, not a nicety: Node 24 negatively caches a
failed package lookup for the process lifetime, so installing while the server runs
NEVER takes effect. This restart-after-install rule applies to every install type
(npx, dev checkout too).

**(d) Claude Desktop JSON** — add to `claude_desktop_config.json`
(macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`):
```json
{ "mcpServers": { "calibre": { "command": "npx", "args": ["-y", "calibre-mcp"] } } }
```
Windows: if the server never connects, wrap the command —
`"command": "cmd", "args": ["/c", "npx", "-y", "calibre-mcp"]` (Desktop-on-Windows
spawning quirk).

**(f) Other MCP clients** — emit the same `mcpServers` block and point the user to
their client's MCP-config location (don't guess paths you can't verify). Skills for
Agent-Skills-compatible harnesses: `npx skills@latest add caelum29/calibre-mcp`.

Env vars for any JSON path, all optional: `CALIBRE_MCP_SERVER_URL`
(default `http://localhost:8080`), `CALIBRE_MCP_LIBRARY` (display name is fine —
libId resolution is internal; empty = server default), `CALIBRE_MCP_ENABLE_WRITE`
(unset = read-only), `CALIBRE_MCP_ADD_ROOTS`, `CALIBRE_MCP_CALIBREDB_PATH`,
`CALIBRE_MCP_RERANK=off` (skip the ~576 MB reranker model — see Phase 4).

Reproducibility: `npx -y calibre-mcp` may serve a stale cached version — pin
(`npx -y calibre-mcp@X.Y.Z`) or force latest (`calibre-mcp@latest`) when it matters.

VERIFY (a/b): `claude mcp list` shows the calibre server "✔ Connected".
VERIFY (c/d/e/f): config file contains the entry (read it back); live check is Phase 3.

## Phase 3 — Live verify

In a session where the server is loaded, call the **`calibre_ping`** tool — its
semantic-status block reports connectivity, library, write-gate state, and
semantic-index state in one call. Evidence = the ping result.

Triage the `semantic` block (don't just echo it):

| Ping says | Meaning → action |
|---|---|
| `available: true` + counts | Semantic ready; nothing to do |
| `dependencyInstalled: false` | Expected for `.mcpb` / `--omit=optional` installs; keyword search fully works. Offer the Phase 2(c) enable recipe |
| `dependencyInstalled: true, loaded: "failed"` / `restartRequired: true` | Dep is on disk but this process can't use it — **restart the server**; nothing else fixes it |
| `modelCached: false` | First embedding build will download the ~118 MB model — set expectations |
| `vectorCount` 0 / missing with dep OK | No semantic index yet — offer `calibre_build_index` (Phase 4) |

A client can't see a server registered mid-session: if `calibre_ping` isn't available
here, say so, and give the user the exact post-restart check ("restart, then ask: *ping
my calibre library*"). Never simulate or predict the result.

## Phase 4 — Offer, don't execute

- **Semantic search**: first `calibre_build_index` downloads `multilingual-e5-small`
  (~118 MB, one-time) **and pre-warms the cross-encoder reranker
  (`bge-reranker-v2-m3`, ~576 MB one-time)** — warn about the size before the first
  build; `CALIBRE_MCP_RERANK=off` skips the reranker (search still works, fused order
  only). Suggest starting with a subset (one tag / a few ids). `keywordOnly: true` =
  the zero-ML fallback. Models + index live in the shared data dir (macOS:
  `~/Library/Application Support/calibre-mcp/index`; Linux: `$XDG_DATA_HOME` or
  `~/.local/share/…`; Windows: `%APPDATA%`-based) — plan for ~700 MB+ with both models.
- **Companion skills** (if not installed via plugin/skills.sh): `calibre-mcp` usage
  guide, `calibre-distill`, `calibre-distill-topic`.

## Upgrade / uninstall / clean slate

**Upgrade** (per install type):
- Claude Code plugin: auto-updates; force with `claude plugin update calibre-mcp@caelum29`.
- npx paths: usually picks up new versions, but the npx cache can serve a stale one —
  `npx -y calibre-mcp@latest`, or pin explicitly.
- Claude Desktop `.mcpb`: download the new release asset and open it — installing over
  the old version is the upgrade path. A manually-installed `@huggingface/transformers`
  inside the old extension dir does NOT carry over — re-run the Phase 2(c) enable
  recipe (incl. restart) after upgrading.
- After any upgrade the server restarts with the client; re-verify with `calibre_ping`.

**Uninstall**: `claude plugin uninstall calibre-mcp@caelum29` / `claude mcp remove
calibre` / delete the `mcpServers` entry / remove the extension in Desktop Settings.
The shared data dir (index + models, Phase 4 locations) is NOT removed by any of
these — deleting it is the user's call; a rebuilt index restores everything except
the one-time model downloads.

**Clean slate** (index corrupt / wrong model state): stop the client, delete the
shared data dir, restart, rebuild the index. Never delete the Calibre library itself.

## Final report

```
phase 0: node <ver> | calibredb <ver> @ <path> | content-server OK/FAIL | pdftotext yes/no
phase 2: <client(s)> → <command results>
phase 3: <calibre_ping block, or the post-restart instruction>
write gates: MCP ON/OFF | calibre-side local-write ON/OFF/unknown (user's decision)
offered, not run: <list>
stops hit: <list or none>
```

Done = phases 0–3 verified. Anything reported without a tool result in this session is
a failure of this setup, not a success.

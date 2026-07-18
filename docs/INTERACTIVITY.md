# INTERACTIVITY.md — In-chat UI (MCP Apps) (scope of record)

> **Status:** Researched 2026-06-27. Expands DESIGN.md §9.3. **No scope locked yet** — this captures
> the landscape + the now-open adoption gate + candidate widgets. The "v1 vs LATER" call on the
> cover board is still **OPEN** (see §Decisions).
> **The primitive:** **MCP Apps** (official spec, SEP-1865, landed Jan 2026, `protocolVersion 2026-01-26`).
> **MCP-UI** is the community SDK that predated/feeds it (`ui://` resources, `UIResourceRenderer`).

## 0. The unblock (why this is worth revisiting now)

DESIGN §9.3 deferred MCP Apps "until Claude Desktop support is confirmed in our target env."
**That gate is now OPEN:** as of April 2026, **Claude (web + desktop)**, VS Code GitHub Copilot,
Goose, Postman, and MCPJam all render MCP Apps. So an in-chat **cover board** will actually display
in our primary client. (Cowork-via-bridge: the UI leg likely does **not** proxy through — treat as
text-only there. See §3.)

## 1. Two tiers of "interactive" — don't conflate

| Tier | What | Effort | Support |
|---|---|---|---|
| **Image in chat** | tool returns `ImageContent` (base64) — a cover inline | trivial | everywhere |
| **Interactive widget** | cover board, clickable grid, diff preview — HTML/JS in a **sandboxed iframe** | med–high | MCP Apps hosts only |

The cover **board** = tier 2. A single cover = tier 1 (works even where MCP Apps doesn't).

## 2. How MCP Apps works (the loop)

1. Tool declares `_meta.ui.resourceUri` pointing at a `ui://` resource.
2. Server serves that resource = bundled **HTML/JS**.
3. Host fetches it, renders in a **sandboxed iframe**.
4. User interaction → the iframe `postMessage`s **JSON-RPC** to the host (a tool-call request /
   prompt / notification). The UI **never** talks to our backend directly.
5. Host runs the requested tool → **model stays in the loop**.

No SDK dependency required (raw JSON-RPC over postMessage per spec); `mcp-ui` SDK optional.

## 3. Candidate widgets — mapped to our v1 tools

| Widget | Sits on | Value | Notes |
|---|---|---|---|
| **Cover board** (grid; click → open book) | `calibre_search`, `calibre_semantic_search` | highest wow, low risk | Artem's ask; vanilla HTML+CSS grid is enough |
| Single cover inline | `calibre_get_book` | base affordance | tier-1 `ImageContent`, no MCP Apps needed |
| **Bulk-update diff/preview** (before/after + Commit) | `calibre_bulk_update` | strengthens **preview-first** (DESIGN §4) beyond text+elicitation | commit posts a confirmed tool-call |
| **Duplicate merge review** (side-by-side, pick master) | `calibre_find_duplicates` | safe visual merge | pairs with merge-safety score |
| **Enrichment candidate picker** (OpenLibrary/Google cards, pick) | `calibre_recover_metadata` | ideal for raw-filename books | pick → apply via `calibre_update_book` |
| Semantic results browser (cards: score + snippet + cover) | `calibre_semantic_search` | showcases the differentiator | library scope → book cards; **`scope=book`** → in-book passage cards (jump-to-location) |

**Design rule (already in DESIGN §9.3):** build `update`/`bulk`/`find_duplicates`/search tools to
return **structured data**; the UI layer bolts on later by adding `_meta.ui` + a `ui://` resource.
Non-UI hosts ignore `_meta.ui` and use the structured text + `resource_link[]`.

## 4. Open spikes (real technical unknowns — resolve before committing the board)

1. **Cover loading inside a sandboxed iframe** — *the* feasibility spike. Options:
   - (a) `<img src="http://localhost:8080/get/thumb_WxH/{id}/{lib}">` direct — only if the host's
     CSP/sandbox permits a localhost origin in `img-src` (**uncertain**, hosts often restrict).
   - (b) **base64 thumbnails** embedded in the `ui://` resource / passed via postMessage — always
     works but heavy payload for 20–50 covers. → Likely the safe default; measure size.
   - Decision pending a live probe in Claude Desktop.
2. **Graceful degradation** — clients without MCP Apps, **and Cowork via the Desktop bridge**, must
   get a sensible text + `resource_link[]` response. `_meta.ui` is additive, never required.
3. **Build cost** — `ui://` = a bundled HTML/JS asset → a build step. Keep board vanilla
   HTML+CSS+small JS (no React needed). Consider `mcp-ui` SDK vs raw postMessage.
4. **Injection hygiene (DESIGN §5 in the UI layer)** — render book titles/authors via `textContent`,
   never `innerHTML`; the iframe template is static, no eval of model/book-supplied data.
5. **Thumb endpoint sizing** — `/get/thumb_WxH` vs `/get/cover` (full); thumbs cheaper for a board.

## 5. Decisions

- **RESOLVED (2026-07-18, D-017) — cover board SHIPPED in v0.4.0.** Cover board on
  `calibre_search` + `calibre_semantic_search` (always-attach per issue #24) and a book card on
  `calibre_get_book`, built on `@modelcontextprotocol/ext-apps` with hand-written vanilla widgets
  from the approved mockup (`assets/cover-carousel.html`). Data path, CSP, handshake facts, and
  degradation contract are all locked in `docs/DECISIONS.md` D-017; the §4 spikes below resolved
  via issues #20 (research) and #21 (live probe). Remaining widget ideas stay in the Deferred
  registry (`DECISIONS.md` § Interactivity).
- **Locked direction:** tools return structured data so any of §3 can be bolted on without rework
  (this is already DESIGN §9.3 policy — restated here so the build honors it from day 1).
- **Cowork:** UI leg is **text-only** (bridge doesn't proxy the iframe) — design for degradation.

## 6. Adopt-trigger summary

| Item | When |
|---|---|
| Cover board (tier 2) | after the search/semantic vertical slice works headless; first UI to ship |
| Single cover (tier 1) | can land early — cheap `ImageContent` on `get_book` |
| Bulk/merge/enrich preview widgets | after preview-first text flow proven, as the §4 upgrade |

**Sources (2026-06-27):**
[MCP Apps blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) ·
[ext-apps spec/SDK](https://github.com/modelcontextprotocol/ext-apps) ·
[MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview) ·
[mcp-ui SDK](https://github.com/MCP-UI-Org/mcp-ui) ·
[The Register — Claude supports MCP Apps](https://www.theregister.com/special-features/2026/01/26/claude-supports-mcp-apps-presents-ui-within-chat-window/4645652)
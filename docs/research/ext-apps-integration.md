# ext-apps SDK × our stack — integration research (ticket #20)

> **Status:** Researched 2026-07-18 against first-party sources (ext-apps repo `main`,
> pushed 2026-07-17; npm `@modelcontextprotocol/ext-apps@1.7.4`; stable spec 2026-01-26).
> Resolves map #19's research ticket. **Headline: stack is fully compatible (verified
> empirically), but per-call UI suppression is NOT spec-legal — charted decision 5
> returns to Artem.**

## 1. Version / compat matrix — GREEN, empirically verified

`@modelcontextprotocol/ext-apps@1.7.4` (latest):

| Peer / engine | Requirement | Ours | OK |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.29.0` | `1.29.0` (pinned) | ✅ exact |
| `zod` | `^3.25.0 \|\| ^4.0.0` | `4.4.3` | ✅ |
| `react`/`react-dom` | optional peers (`peerDependenciesMeta`) | none | ✅ not needed |
| Node | `>=20` | `>=22.5` (dev: 24) | ✅ |
| Runtime dep | `@standard-schema/spec` only | — | ✅ tiny footprint |

**Empirical probe (2026-07-18, scratch project):** `ext-apps@1.7.4` + `sdk@1.29.0` +
`zod@4.4.3` + TS `NodeNext` + `"type": "module"` — `tsc --noEmit` clean and runtime
`registerAppTool`/`registerAppResource`/`getUiCapability` all work on Node 24.

- **Known issue [#704](https://github.com/modelcontextprotocol/ext-apps/issues/704)**
  (open, types-only): emitted `.d.ts` use extensionless relative imports → breaks under
  `NodeNext`. **Does not hit us** — it affects the client-side `app-bridge`/`events`
  types (which we don't import; we hand-roll the widget); the `/server` entry
  typechecks clean in an ESM project. It *does* break in a CJS consumer (dual-package
  type mismatch) — irrelevant, we're ESM.
- `registerAppTool` is a **thin wrapper over `server.registerTool`** (normalizes
  `_meta.ui.resourceUri` ↔ legacy flat `_meta["ui/resourceUri"]` for older hosts);
  `registerAppResource` wraps `registerResource` defaulting
  `mimeType: "text/html;profile=mcp-app"` (`RESOURCE_MIME_TYPE`). No transport or
  protocol machinery — the SDK-free seam holds: import ext-apps **only in `server.ts`**.
- License: repo is MIT→Apache-2.0 transition (new code Apache-2.0) — permissive,
  compatible with our clean-room policy (D-004).

## 2. Protocol negotiation — no upgrade forced

- MCP Apps is an **extension** (`io.modelcontextprotocol/ui`, SEP-1865 via SEP-1724),
  negotiated through `capabilities.extensions` in the standard `initialize` — **not**
  a base-protocol bump. The spec's own example uses `protocolVersion: "2024-11-05"`;
  field report [#671](https://github.com/modelcontextprotocol/ext-apps/issues/671)
  shows Claude negotiating it on `2025-11-25` (our protocol). The `2026-01-26` version
  string belongs to the **iframe↔host `ui/initialize` handshake**, not the server
  connection.
- SDK 1.29.0's `ClientCapabilities` type doesn't include `extensions` yet (pending
  SEP-1724 in the SDK); ext-apps' `getUiCapability(clientCapabilities)` accepts the
  widened type and reads `extensions["io.modelcontextprotocol/ui"]` — runtime
  passthrough works today (verified in the probe).
- **Unconfirmed (→ spike #21):** whether Claude *Desktop over stdio* sends the
  extension capability. #671's evidence is claude.ai + `mcp-remote`. Registration
  strategy hedge: the spec says non-Apps hosts simply ignore `_meta.ui` ("tool behaves
  as standard tool"), so **always-attach registration is safe** regardless; the
  `getUiCapability` check is a SHOULD, not a MUST (and per-connection conditional
  registration would need `oninitialized` + late `registerTool` + `list_changed` —
  extra moving parts for little gain).

## 3. Per-call UI suppression — **NOT spec-legal** (gates charted decision 5)

- Rendering binds at the **tool level**: `_meta.ui.resourceUri` on the tool
  declaration. There is **no result-level opt-out** in the stable spec (2026-01-26)
  **or the current draft** — no `_meta.ui` on `CallToolResult` is defined.
- Worse for the `ui`-param idea: hosts render the widget **optimistically, before the
  tool responds** (spec author idosal in
  [#191](https://github.com/modelcontextprotocol/ext-apps/issues/191): "the UI is
  rendered optimistically before the Tool responds… Currently, the MCP Apps spec
  doesn't include this mechanism"). So even a result-level convention couldn't stop
  the iframe from appearing; #191's `resourceUris[]`/response-override proposal is
  open and unadopted (checked draft spec 2026-07-17: absent).
- OpenAI-host folklore (no `structuredContent` + `isError` → no render) is
  **host-specific behavior, not spec** — do not build on it.
- **Consequence:** a model-passed `ui: false` param cannot suppress the board on a
  UI-declared tool. Decision 5 returns to Artem. Real options:
  1. **Always-attach** on `calibre_search`/`calibre_semantic_search` (board renders on
     every library-scope search in Apps hosts; non-Apps hosts unaffected).
  2. **Separate `calibre_show_books` display tool** carrying the `_meta.ui` (model
     decides by *choosing the tool*; +1 tool = 16, still under the ≤~20 budget). This
     is the spec-shaped way to get per-call control today.
  3. Hybrid: always-attach now, split later if it annoys.
- Related affordance worth knowing: `visibility: ["app"]` hides a tool from the model
  but keeps it callable from the widget (host MUST omit it from the model's
  `tools/list`) — useful later for widget-only refresh/pagination tools without
  burning model-facing tool count.

## 4. `_meta.ui` × `outputSchema`/`structuredContent` — no conflict

- `registerAppTool` passes `outputSchema`/`annotations` straight through to
  `registerTool`; our text + `resource_link[]` + `structuredContent` result shape is
  untouched.
- The widget receives the **entire `CallToolResult`** via the
  `ui/notifications/tool-result` notification (`content`, `structuredContent`,
  `_meta`) — so the board reads book ids/titles from `structuredContent` we already
  return. Tool *arguments* arrive separately via `ui/notifications/tool-input`.
- Spec best practices: `content` = model/text-host representation;
  `structuredContent` = UI data ("not added to model context" in Apps hosts —
  host-dependent claim, relevant to the map's payload-slimming fog item); result
  `_meta` = extra UI-only payload if we ever need one.
- #671 shows Claude replaces the rendered result with a placeholder for the model
  ("This tool call rendered an interactive widget… do not repeat it") — degradation
  text still matters for non-Apps hosts, but expect Apps hosts to hide it.

## 5. The iframe↔host handshake to hand-roll (vanilla JS)

Conceptually the View is an MCP client; host is its server. Raw JSON-RPC 2.0 over
`window.parent.postMessage` (spec includes a no-SDK example). Desktop/native hosts
load our HTML directly; the double-iframe sandbox proxy (`ui/notifications/sandbox-*`)
is **host-internal — we never implement it**.

Lifecycle (View perspective):

1. → request `ui/initialize` `{protocolVersion: "2026-01-26", appCapabilities:
   {availableDisplayModes: ["inline"]}, clientInfo}` — response carries
   `hostCapabilities` (**check `openLinks` before showing the Read button**,
   `serverTools` before enabling click→tool-call) and `hostContext` (`theme`,
   `styles.variables` CSS vars, `containerDimensions`, `locale`).
2. → notification `ui/notifications/initialized`.
3. ← `ui/notifications/tool-input` (complete args, exactly once; optional
   `tool-input-partial` 0..n before it — ignorable).
4. ← `ui/notifications/tool-result` (the full `CallToolResult` → render the board).
5. Interactions:
   - Cover click → request `tools/call` `{name: "calibre_get_book", arguments: {…}}`
     (host proxies to our server; model stays in the loop).
   - Read button → request `ui/open-link` `{url}` (host opens default browser;
     may error `-32000` if denied → degrade gracefully).
6. Housekeeping: → `ui/notifications/size-changed` on content resize (ResizeObserver;
   REQUIRED for flexible-height containers); ← `ui/notifications/host-context-changed`
   (merge partial `hostContext`, e.g. theme flip); ← `ui/resource-teardown` request —
   respond `{}` promptly; respond to `ping`.

Theming: standardized CSS vars (`--color-background-primary`, `--color-text-primary`,
`--font-sans`, `--border-radius-md`, …) via `hostContext.styles.variables`; widget MUST
declare its own `:root` fallbacks; hosts use `light-dark()` values.

**CSP defaults (drives spike #21):** with no `_meta.ui.csp` declared, hosts MUST apply
`img-src 'self' data:` and `connect-src 'none'` — i.e. **base64 `data:` cover thumbs
work with zero CSP config; any `fetch()` from the widget is blocked by default**.
Loading covers from `http://localhost:8080/get/thumb_…` requires declaring
`csp.resourceDomains: ["http://localhost:8080"]` on the *resource read* `_meta` (docs
explicitly say localhost must be declared too); hosts MUST NOT loosen but MAY restrict
further — whether Claude Desktop honors a localhost origin is exactly the spike's
live probe. Note [#671](https://github.com/modelcontextprotocol/ext-apps/issues/671)
(open, May 2026): a report of Claude Desktop/claude.ai negotiating + fetching but not
rendering the iframe (Windows/remote setup) — if the spike reproduces on macOS/stdio,
that issue is the place to look.

## 6. Degradation — spec-guaranteed, plus hygiene

- Spec: "If host does not support MCP Apps, tool behaves as standard tool (text-only
  fallback)"; servers SHOULD always return meaningful `content`. Our existing text +
  `resource_link[]` path is untouched — `_meta.ui` is additive.
- Servers **MAY omit `ui://` resources from `resources/list`** (discovery happens via
  tool `_meta`) — do this to keep our resource listing clean for non-Apps clients.
- Cowork-via-bridge: still **unconfirmed** whether the UI leg proxies; treat as
  text-only (INTERACTIVITY.md §3 stance) until the spike observes otherwise.

## Sources (all first-party, fetched 2026-07-18)

- Stable spec: `modelcontextprotocol/ext-apps` `specification/2026-01-26/apps.mdx`
  (SEP-1865, Stable 2026-01-26) + `specification/draft/apps.mdx` (checked for
  response-level override: absent).
- SDK: `src/server/index.ts` @ main; npm metadata `@modelcontextprotocol/ext-apps@1.7.4`.
- Docs: `docs/csp-cors.md` (localhost CSP), `docs/overview.md`, `docs/patterns.md`.
- Issues: [#191](https://github.com/modelcontextprotocol/ext-apps/issues/191)
  (conditional rendering — open, spec-author confirmed absent),
  [#704](https://github.com/modelcontextprotocol/ext-apps/issues/704) (NodeNext types),
  [#671](https://github.com/modelcontextprotocol/ext-apps/issues/671) (Claude render
  bug report).
- Local probe: scratch install `ext-apps@1.7.4` × `sdk@1.29.0` × `zod@4.4.3` ×
  Node 24 × NodeNext ESM — typecheck + runtime clean.

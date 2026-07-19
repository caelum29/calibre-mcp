// Cover-board widget for the MCP Apps iframe (issues #19/#22). Two visual variants —
// "shelf" (the approved assets/cover-carousel.html mockup) and "coverflow"
// (assets zip coverflow.html, 3D cover flow) — picked once at boot via
// CALIBRE_MCP_BOARD_STYLE (per-call switching is not spec-legal, issue #24). Both share
// one MCP plumbing core: appInfo handshake, data pull via widget-initiated tools/call
// (Desktop strips structuredContent from the tool-result notification), click →
// calibre_get_book, Read → ui/open-link. SDK-free; served by server.ts as two ui://
// resources (one per search tool, so the widget knows its tool without guessing).
// Injection hygiene: all book fields land via textContent/createElement — no innerHTML,
// no eval. The widget JS avoids template literals so the outer literals need no escaping.

export const BOARD_KEYWORD_URI = "ui://calibre/board-keyword.html";
export const BOARD_SEMANTIC_URI = "ui://calibre/board-semantic.html";

/** Cover-board visual style; chosen once at server boot (config.boardStyle). */
export type BoardStyle = "shelf" | "coverflow";

/** Render the board template for one owning search tool. */
export function boardHtml(
  tool: "calibre_search" | "calibre_semantic_search",
  version: string,
  style: BoardStyle = "shelf",
): string {
  const tpl = style === "coverflow" ? COVERFLOW_TEMPLATE : SHELF_TEMPLATE;
  return tpl.replaceAll("__TOOL__", tool).replaceAll("__VERSION__", version);
}

/* ============================================================================
 * Shared shell — tokens, base, meta row, empty/error states, state switching.
 * The ONLY place colors live (frozen mockup); both variants consume these tokens.
 * ==========================================================================*/

const SHARED_CSS_TOP = `/* ============ tokens — the ONLY place colors live (frozen mockup) ============ */
:root{
  color-scheme: light dark;
  /* fallbacks (no light-dark support) */
  --bg:#faf7f2; --tx:#33302b; --tx-muted:#8a8378; --card:#ffffff;
  --line:rgba(60,50,40,.14); --accent:#c67139; --btn:#ffffff;
  /* live tokens */
  --bg: light-dark(#faf7f2, #262624);
  --tx: light-dark(#33302b, #ece9e3);
  --tx-muted: light-dark(#8a8378, #9c958a);
  --card: light-dark(#ffffff, #31302e);
  --line: light-dark(rgba(60,50,40,.14), rgba(255,255,255,.13));
  --accent: light-dark(#c67139, #d98d55);
  --accent-tint: light-dark(rgba(198,113,57,.12), rgba(217,141,85,.16));
  --btn: light-dark(rgba(255,255,255,.94), rgba(49,48,46,.94));
  --skel: light-dark(rgba(60,50,40,.08), rgba(255,255,255,.07));
  --skel-hi: light-dark(rgba(255,255,255,.65), rgba(255,255,255,.09));
  --shadow: 0 1px 2px rgba(0,0,0,.07), 0 5px 16px rgba(0,0,0,.09);
  --shadow-lg: 0 2px 4px rgba(0,0,0,.09), 0 10px 26px rgba(0,0,0,.14);
  --scrim: light-dark(rgba(255,253,250,.88), rgba(38,38,36,.88));
  /* book-volume knobs */
  --spine: light-dark(rgba(0,0,0,.16), rgba(0,0,0,.42));
  --crease: light-dark(rgba(255,255,255,.55), rgba(255,255,255,.14));
  --sheen: light-dark(rgba(255,255,255,.26), rgba(255,255,255,.05));
  --pages: light-dark(#f1ebe0, #46453f);
  --pages-line: light-dark(#d8d0c2, #2c2b28);
  --pagestack: 1.5px 0 0 var(--pages), 2.5px 0 0 var(--pages-line), 4px 0 0 var(--pages), 5px 0 0 var(--pages-line);
  /* generated-cover knobs (hue arrives per-card via --h/--h2) */
  --cov-l:84%; --cov-l2:73%; --cov-c:.05; --cov-c2:.075;
  --cov-tx-l:29%; --cov-tx-c:.055;
  --cov-line:rgba(0,0,0,.10); --cov-shine:rgba(255,255,255,.35);
}
:root[data-theme="light"]{ color-scheme:light; }
:root[data-theme="dark"]{ color-scheme:dark; }
:root[data-theme="dark"]{
  --cov-l:39%; --cov-l2:30%; --cov-c:.045; --cov-c2:.06;
  --cov-tx-l:91%; --cov-tx-c:.03;
  --cov-line:rgba(255,255,255,.12); --cov-shine:rgba(255,255,255,.08);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --cov-l:39%; --cov-l2:30%; --cov-c:.045; --cov-c2:.06;
    --cov-tx-l:91%; --cov-tx-c:.03;
    --cov-line:rgba(255,255,255,.12); --cov-shine:rgba(255,255,255,.08);
  }
}
/* ============ base ============ */
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg); color:var(--tx);
  font:14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  padding:10px 0 0;
}
body[data-collapsed="1"]{display:none}
a{color:var(--accent)} a:hover{color:var(--tx)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}

/* ============ widget shell ============ */
.widget{position:relative; max-width:800px; margin:0 auto;}
.meta{
  display:flex; align-items:baseline; gap:12px;
  padding:0 18px 6px; min-height:20px;
}
.meta .note{
  font-size:12.5px; color:var(--tx-muted);
  display:none; align-items:center; gap:6px;
}
.meta .note::before{
  content:""; width:7px; height:7px; border-radius:50%;
  background:var(--accent); opacity:.7; flex:none; display:inline-block;
}
.widget[data-lowconf="1"] .meta .note{display:inline-flex}
.meta .pos{margin-left:auto; font-size:12px; color:var(--tx-muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
`;

const SHARED_CSS_BOTTOM = `/* ============ empty / error ============ */
.flat{
  display:none; align-items:center; gap:10px;
  padding:18px; font-size:13px; color:var(--tx-muted);
}
.flat b{color:var(--tx); font-weight:550}
.flat .q{
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:12px; background:var(--skel); padding:2px 7px; border-radius:6px;
}
.retry{
  padding:4px 13px; border-radius:999px; font-size:12.5px;
  background:var(--accent-tint); color:var(--accent); font-weight:550;
}
.retry:hover{background:var(--accent); color:#fff}

/* state switching */
.widget[data-state="loading"] .view-loading{display:block}
.widget[data-state="results"] .view-results{display:block}
.widget[data-state="empty"] .view-empty{display:flex}
.widget[data-state="error"] .view-error{display:flex}
.view{display:none}
`;

/* ============================================================================
 * Shared widget JS — MCP plumbing only; each variant supplies renderResults(),
 * renderSkeleton(), and its own interactions (function declarations hoist, so
 * the core may call them). No template literals, no innerHTML, no console.
 * ==========================================================================*/

const CORE_JS = `  var TOOL = "__TOOL__";

  /* ================= JSON-RPC over postMessage ================= */
  var pending = {};
  var nextId = 1;
  function rpcRequest(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
    });
  }
  function rpcNotify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params }, "*");
  }
  function rpcRespond(id, result) {
    window.parent.postMessage({ jsonrpc: "2.0", id: id, result: result }, "*");
  }

  /* ================= widget state ================= */
  var w = document.getElementById("w"), pos = document.getElementById("pos");
  var S = { state: "loading", count: 0, selected: null, focusIdx: 0 };
  var ready = false;          // ui/initialize handshake done
  var afterReady = [];        // thunks queued until then
  var toolArgs = null;        // from ui/notifications/tool-input
  var sawResult = false;      // tool-result notification arrived
  var payload = null;         // BoardPayload being rendered
  var openLinksOk = true;     // hostCapabilities.openLinks gate for the Read affordance

  function whenReady(fn) { if (ready) fn(); else afterReady.push(fn); }

  /* ================= host messages ================= */
  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.method === undefined) {
      var p = pending[m.id];
      if (p) { delete pending[m.id]; if (m.error) p.reject(m.error); else p.resolve(m.result); }
      return;
    }
    if (m.method === "ping" && m.id !== undefined) { rpcRespond(m.id, {}); return; }
    if (m.method === "ui/resource-teardown" && m.id !== undefined) { rpcRespond(m.id, {}); return; }
    if (m.method === "ui/notifications/tool-input-partial") return; // ~80 empties precede tool-input
    if (m.method === "ui/notifications/tool-input") {
      toolArgs = (m.params && m.params.arguments) || m.params || null;
      // Board is bound at the tool level, so scope=book calls render it too (per-call
      // suppression is not spec-legal, issue #24) — collapse to zero height instead.
      if (toolArgs && toolArgs.scope === "book") collapse();
      return;
    }
    if (m.method === "ui/notifications/tool-result") {
      onToolResult((m.params && m.params.result) || m.params || {});
      return;
    }
    if (m.method === "ui/notifications/tool-cancelled") { setState("error"); return; }
    if (m.method === "ui/notifications/host-context-changed") {
      applyHostContext((m.params && m.params.hostContext) || m.params);
      return;
    }
  });

  function applyHostContext(ctx) {
    if (!ctx) return;
    var t = ctx.theme;
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
    else if (t) delete document.documentElement.dataset.theme;
  }

  function collapse() {
    document.body.dataset.collapsed = "1";
    reportSize();
  }

  /* ================= data flow =================
     Spec hosts deliver the full CallToolResult in the notification (_meta.calibreBoard
     is attached by the search handlers). Claude Desktop strips structuredContent AND
     _meta there, so we fall back to a widget-initiated tools/call to the app-visibility
     calibre_board_data cache; a cache miss re-runs the search once, then re-pulls. */
  function onToolResult(res) {
    sawResult = true;
    if (document.body.dataset.collapsed === "1") return;
    if (res && res.isError) { setState("error"); return; }
    var meta = res && res._meta;
    if (meta && meta.calibreBoard && meta.calibreBoard.books) { gotPayload(meta.calibreBoard); return; }
    pullData(false);
  }

  function pullData(isRetryAfterRerun) {
    whenReady(function () {
      var args = { tool: TOOL };
      if (toolArgs && typeof toolArgs.query === "string") args.query = toolArgs.query;
      rpcRequest("tools/call", { name: "calibre_board_data", arguments: args })
        .then(function (r) {
          var sc = r && r.structuredContent;
          if (sc && sc.books) { gotPayload(sc); return; }
          fallbackOrFail(isRetryAfterRerun);
        })
        .catch(function () { fallbackOrFail(isRetryAfterRerun); });
    });
  }

  function fallbackOrFail(isRetryAfterRerun) {
    // Cache miss (server restarted, stale widget) — re-run the original search once;
    // its handler repopulates the cache, then the exact-match pull succeeds.
    if (!isRetryAfterRerun && toolArgs && typeof toolArgs.query === "string") {
      rpcRequest("tools/call", { name: TOOL, arguments: toolArgs })
        .then(function () { pullData(true); })
        .catch(function () { setState("error"); });
      return;
    }
    setState("error");
  }

  // Grace path when the host never delivers tool-result: poll the cache only — never
  // re-run the search, which may still be in flight (a re-run would double the work).
  function pollData(triesLeft) {
    whenReady(function () {
      var args = { tool: TOOL };
      if (toolArgs && typeof toolArgs.query === "string") args.query = toolArgs.query;
      rpcRequest("tools/call", { name: "calibre_board_data", arguments: args })
        .then(function (r) {
          if (sawResult) return; // the real path took over meanwhile
          var sc = r && r.structuredContent;
          if (sc && sc.books) { gotPayload(sc); return; }
          if (triesLeft > 0) setTimeout(function () { pollData(triesLeft - 1); }, 2500);
          else setState("error");
        })
        .catch(function () {
          if (triesLeft > 0) setTimeout(function () { pollData(triesLeft - 1); }, 2500);
          else setState("error");
        });
    });
  }

  function gotPayload(p) {
    payload = p;
    if (!p.books || p.books.length === 0) {
      document.getElementById("emptyQ").textContent = p.query || (toolArgs && toolArgs.query) || "";
      setState("empty");
      return;
    }
    w.dataset.mode = p.books.some(function (b) { return typeof b.score === "number"; }) ? "semantic" : "keyword";
    w.dataset.lowconf = p.lowConfidence ? "1" : "0";
    setState("results");
  }

  /* ================= MCP actions ================= */
  function thumbUrl(bookId) {
    var base = String(payload.serverUrl || "").replace(/\\/+$/, "");
    return base + "/get/thumb/" + bookId + "/" + encodeURIComponent(payload.libraryId) + "?sz=268x356";
  }
  function readUrl(bookId) {
    var base = String(payload.serverUrl || "").replace(/\\/+$/, "");
    return base + "/#book_id=" + bookId + "&library_id=" + encodeURIComponent(payload.libraryId) + "&panel=book_details";
  }

  function onCardClick(bookId) {
    rpcRequest("tools/call", { name: "calibre_get_book", arguments: { id: bookId } })
      .then(clearOpening)
      .catch(clearOpening);
  }
  function clearOpening() {
    clearTimeout(S._t);
    document.querySelectorAll(".card.is-opening").forEach(function (c) { c.classList.remove("is-opening"); });
  }

  function onRead(bookId) {
    rpcRequest("ui/open-link", { url: readUrl(bookId) })
      .then(function (r) { if (r && r.isError) disableRead(); })
      .catch(disableRead);
  }
  function disableRead() {
    // Host refused ui/open-link — hide the (deliberately secondary) affordance quietly.
    document.body.dataset.noread = "1";
  }

  var lastH = 0;
  function reportSize() {
    var h = document.body.dataset.collapsed === "1" ? 0 : document.documentElement.scrollHeight;
    if (h === lastH) return;
    lastH = h;
    rpcNotify("ui/notifications/size-changed", { height: h, width: document.documentElement.scrollWidth });
  }
  new ResizeObserver(reportSize).observe(document.body);

  /* ================= deterministic placeholder ================= */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  function isRaw(t) { return /[\\/_]|\\.(pdf|dvi|djvu|epub|fb2)$/i.test(t) || /^scan|^\\d{6,}/i.test(t); }

  /* ================= rendering helpers (createElement + textContent only) ================= */
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function setState(st) {
    S.state = st;
    w.dataset.state = st;
    if (st === "results") renderResults(); else pos.textContent = "";
    reportSize();
  }

  document.getElementById("retry").addEventListener("click", function () {
    setState("loading");
    pullData(false);
  });
`;

const BOOT_JS = `  /* ================= boot: skeleton first, then handshake ================= */
  renderSkeleton();
  setState("loading");
  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    // appInfo (not the client-info field name) — the host zod-validates this shape (spike #21)
    appInfo: { name: "calibre-cover-board", version: "__VERSION__" }
  }).then(function (r) {
    openLinksOk = !(r && r.hostCapabilities && r.hostCapabilities.openLinks === false);
    applyHostContext(r && r.hostContext);
    rpcNotify("ui/notifications/initialized", {});
    ready = true;
    afterReady.splice(0).forEach(function (fn) { fn(); });
    // If the host never sends tool-result (or sent it before we listened), poll the
    // cache after a grace period — it has the data the moment the search finishes.
    setTimeout(function () {
      if (!sawResult && document.body.dataset.collapsed !== "1" && S.state === "loading") pollData(6);
    }, 2000);
  }).catch(function () { setState("error"); });
`;

/** Assemble one variant template from its visuals + the shared core. */
function template(variantCss: string, views: string, variantJs: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>calibre-mcp cover board</title>
<style>
${SHARED_CSS_TOP}
${variantCss}
${SHARED_CSS_BOTTOM}</style>
</head>
<body>

<div class="widget" id="w" data-state="loading" data-mode="keyword" data-lowconf="0">
  <div class="meta">
    <span class="note">Weak matches — try rephrasing your query</span>
    <span class="pos" id="pos"></span>
  </div>
${views}
  <div class="view view-empty flat">
    <span><b>No books matched</b>&nbsp; <span class="q" id="emptyQ"></span></span>
  </div>

  <div class="view view-error flat">
    <span>Couldn&rsquo;t load results</span>
    <button class="retry" id="retry">Retry</button>
  </div>
</div>

<script>
"use strict";
(function () {
${CORE_JS}
${variantJs}
${BOOT_JS}})();
</script>
</body>
</html>
`;
}

/* ============================================================================
 * Variant: shelf (the approved assets/cover-carousel.html mockup — frozen)
 * ==========================================================================*/

const SHELF_CSS = `/* ============ shelf / carousel ============ */
.shelf{position:relative}
.strip{
  display:flex; gap:14px; align-items:flex-start;
  overflow-x:auto; overscroll-behavior-x:contain;
  scroll-snap-type:x proximity; scroll-behavior:smooth; scroll-padding-inline:18px;
  padding:6px 18px 10px; margin:0; list-style:none;
  scrollbar-width:none;
}
.strip::-webkit-scrollbar{display:none}
.item{position:relative; flex:none; scroll-snap-align:start; width:134px;}
.card{
  display:flex; flex-direction:column; gap:8px; width:100%;
  text-align:left; border-radius:14px; padding:0;
}
.cover{
  position:relative; display:block; width:134px; height:178px;
  border-radius:4px 11px 11px 4px; /* square spine edge, rounded fore-edge */
  overflow:hidden;
  box-shadow:var(--pagestack), var(--shadow);
  transition:transform .18s ease, box-shadow .18s ease;
}
.cover::before{ /* spine crease + top sheen = volume */
  content:""; position:absolute; inset:0; z-index:1; pointer-events:none; border-radius:inherit;
  background:
    linear-gradient(90deg, var(--spine) 0%, transparent 9%),
    linear-gradient(90deg, transparent 4.5%, var(--crease) 7%, transparent 11%),
    linear-gradient(168deg, var(--sheen) 0%, transparent 24%);
}
.item:hover .cover{transform:translateY(-3px); box-shadow:var(--pagestack), var(--shadow-lg)}
.card[aria-pressed="true"] .cover{
  outline:2.5px solid var(--accent); outline-offset:2px;
}
/* generated placeholder cover */
.ph{
  position:absolute; inset:0; display:flex; flex-direction:column;
  padding:12px 11px 10px;
  background:linear-gradient(160deg,
    oklch(var(--cov-l) var(--cov-c) var(--h)) 0%,
    oklch(var(--cov-l2) var(--cov-c2) var(--h2)) 100%);
  color:oklch(var(--cov-tx-l) var(--cov-tx-c) var(--h));
}
.ph::after{ /* inner rule = deliberate "printed cover" feel */
  content:""; position:absolute; inset:6px; border-radius:7px;
  border:1px solid var(--cov-line); pointer-events:none;
}
.ph .mark{
  width:22px; height:22px; border-radius:50%;
  background:var(--cov-shine); margin-bottom:10px; flex:none;
}
.ph[data-v="1"] .mark{border-radius:6px}
.ph[data-v="2"] .mark{width:34px; height:10px; border-radius:999px}
.ph .pt{
  font-size:13px; line-height:1.25; font-weight:650; letter-spacing:.01em;
  display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden;
  overflow-wrap:anywhere; text-wrap:pretty;
}
.ph .pa{
  margin-top:auto; font-size:10.5px; opacity:.75;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.ph .pt.raw{ /* raw filename → typewriter-ish, still intentional */
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight:500; font-size:11.5px;
}
.cover img{
  position:absolute; inset:0; width:100%; height:100%;
  object-fit:cover; background:var(--card);
}
/* score badge (semantic only) */
.score{
  position:absolute; left:7px; bottom:7px; z-index:2;
  font-size:10px; font-variant-numeric:tabular-nums;
  padding:2px 7px; border-radius:999px;
  background:var(--scrim); color:var(--tx-muted);
  display:none;
}
[data-mode="semantic"] .score{display:block}
[data-mode="semantic"] .ph .pa{padding-left:44px} /* reserve room for score badge */
/* opening chip */
.opening{
  position:absolute; inset:auto 7px 7px auto; z-index:2;
  font-size:10.5px; padding:3px 8px; border-radius:999px;
  background:var(--accent); color:#fff;
  opacity:0; transform:translateY(4px);
  transition:opacity .15s ease, transform .15s ease;
  pointer-events:none;
}
.card.is-opening .opening{opacity:1; transform:none}
/* text under cover */
.t{
  font-size:12.5px; line-height:1.3; font-weight:550;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  overflow-wrap:anywhere;
}
.a{
  font-size:11.5px; color:var(--tx-muted);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
/* read affordance */
.read{
  position:absolute; top:7px; right:7px; z-index:3;
  font-size:11px; padding:3.5px 10px; border-radius:999px;
  background:var(--btn); color:var(--tx); box-shadow:var(--shadow);
  opacity:0; transform:translateY(-3px);
  transition:opacity .15s ease, transform .15s ease;
}
.item:hover .read, .item:focus-within .read{opacity:1; transform:none}
.read:hover{background:var(--accent-tint); color:var(--accent)}
body[data-noread="1"] .read{display:none}
/* nav arrows */
.arrow{
  position:absolute; top:76px; z-index:4;
  width:34px; height:34px; border-radius:50%;
  background:var(--btn); box-shadow:var(--shadow-lg);
  display:grid; place-items:center;
  transition:opacity .15s ease;
}
.arrow:hover{background:var(--accent-tint)}
.arrow svg{stroke:var(--tx); stroke-width:2.75; fill:none; stroke-linecap:round; stroke-linejoin:round}
.arrow[disabled]{opacity:0; pointer-events:none}
.arrow.prev{left:8px} .arrow.next{right:8px}

/* ============ skeleton ============ */
.skel .cover-s{
  width:134px; height:178px; border-radius:11px; flex:none;
  background:var(--skel); position:relative; overflow:hidden;
}
.skel .l1,.skel .l2{height:10px; border-radius:6px; background:var(--skel)}
.skel .l1{width:80%; margin-top:9px} .skel .l2{width:55%; margin-top:6px}
.cover-s::after{
  content:""; position:absolute; inset:0;
  background:linear-gradient(100deg, transparent 30%, var(--skel-hi) 50%, transparent 70%);
  transform:translateX(-100%); animation:shimmer 1.4s infinite;
}
@keyframes shimmer{to{transform:translateX(100%)}}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important; transition:none!important}
  .strip{scroll-behavior:auto}
}
`;

const SHELF_VIEWS = `
  <div class="view view-loading">
    <ul class="strip" aria-hidden="true" id="skelStrip"></ul>
  </div>

  <div class="view view-results">
    <div class="shelf">
      <ul class="strip" id="strip" role="listbox" aria-label="Search results"></ul>
      <button class="arrow prev" id="prev" aria-label="Previous results"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="arrow next" id="next" aria-label="Next results"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
  </div>
`;

const SHELF_JS = `  /* ================= shelf rendering ================= */
  var strip = document.getElementById("strip"),
      prev = document.getElementById("prev"), next = document.getElementById("next");

  function renderResults() {
    var books = payload.books;
    S.count = books.length;
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var title = String(b.title || "book " + b.bookId);
      var authors = (b.authors || []).join(", ");
      var h = hash(title) % 360, h2 = (h + 38) % 360, v = hash(title) % 3;

      var li = el("li", "item");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = i === 0 ? 0 : -1;

      var cover = el("span", "cover");
      cover.style.setProperty("--h", String(h));
      cover.style.setProperty("--h2", String(h2));

      var ph = el("span", "ph");
      ph.dataset.v = String(v);
      ph.appendChild(el("span", "mark"));
      ph.appendChild(el("span", isRaw(title) ? "pt raw" : "pt", title));
      ph.appendChild(el("span", "pa", authors));
      cover.appendChild(ph);

      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () { img.remove(); }; // no/broken cover → generated placeholder
      img.src = thumbUrl(b.bookId);
      cover.appendChild(img);

      if (typeof b.score === "number") cover.appendChild(el("span", "score", b.score.toFixed(2)));
      cover.appendChild(el("span", "opening", "Opening\\u2026"));
      card.appendChild(cover);
      card.appendChild(el("span", "t", title));
      card.appendChild(el("span", "a", authors || "\\u00A0"));
      li.appendChild(card);

      var read = el("button", "read", "Read");
      read.type = "button";
      read.tabIndex = -1;
      read.setAttribute("aria-label", "Read " + title + " in external viewer");
      li.appendChild(read);

      frag.appendChild(li);
    });
    strip.replaceChildren(frag);
    if (!openLinksOk) disableRead();
    strip.scrollLeft = 0; S.focusIdx = 0; S.selected = null;
    updatePosition(); reportSize();
  }

  function renderSkeleton() {
    var s = document.getElementById("skelStrip");
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 7; i++) {
      var li = el("li", "item skel");
      li.appendChild(el("div", "cover-s"));
      li.appendChild(el("div", "l1"));
      li.appendChild(el("div", "l2"));
      frag.appendChild(li);
    }
    s.replaceChildren(frag);
  }

  /* ================= position indicator + arrows ================= */
  function cardStep() { var it = strip.querySelector(".item"); return it ? it.offsetWidth + 14 : 148; }
  function updatePosition() {
    var n = S.count, vis = Math.max(1, Math.floor(strip.clientWidth / cardStep()));
    var first = Math.min(n - vis, Math.round(strip.scrollLeft / cardStep()));
    var a = Math.max(1, first + 1), b = Math.min(n, first + vis);
    pos.textContent = S.state === "results" ? a + "\\u2013" + b + " of " + n : "";
    var max = strip.scrollWidth - strip.clientWidth - 2;
    prev.disabled = strip.scrollLeft <= 2; next.disabled = strip.scrollLeft >= max;
  }
  strip.addEventListener("scroll", function () { requestAnimationFrame(updatePosition); });
  prev.addEventListener("click", function () { strip.scrollBy({ left: -strip.clientWidth + 40, behavior: "smooth" }); });
  next.addEventListener("click", function () { strip.scrollBy({ left: strip.clientWidth - 40, behavior: "smooth" }); });

  /* ================= interactions ================= */
  strip.addEventListener("click", function (e) {
    var read = e.target.closest(".read");
    if (read) { onRead(+read.parentElement.querySelector(".card").dataset.id); return; }
    var card = e.target.closest(".card"); if (!card) return;
    strip.querySelectorAll(".card").forEach(function (c) {
      c.setAttribute("aria-pressed", "false"); c.setAttribute("aria-selected", "false"); c.classList.remove("is-opening");
    });
    card.setAttribute("aria-pressed", "true"); card.setAttribute("aria-selected", "true");
    card.classList.add("is-opening"); S.selected = +card.dataset.id;
    clearTimeout(S._t); S._t = setTimeout(function () { card.classList.remove("is-opening"); }, 1400);
    onCardClick(S.selected);
  });
  strip.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    var d = e.key === "ArrowRight" ? 1 : -1;
    var cards = strip.querySelectorAll(".card");
    var ni = Math.max(0, Math.min(cards.length - 1, S.focusIdx + d));
    if (ni === S.focusIdx) return;
    cards[S.focusIdx].tabIndex = -1; cards[ni].tabIndex = 0;
    cards[ni].focus({ preventScroll: true }); S.focusIdx = ni;
    var it = cards[ni].closest(".item"), L = it.offsetLeft - strip.offsetLeft;
    if (L < strip.scrollLeft + 18) strip.scrollTo({ left: L - 18, behavior: "smooth" });
    else if (L + it.offsetWidth > strip.scrollLeft + strip.clientWidth - 18)
      strip.scrollTo({ left: L + it.offsetWidth - strip.clientWidth + 18, behavior: "smooth" });
  });
  strip.addEventListener("focusin", function (e) {
    var card = e.target.closest(".card");
    if (card) S.focusIdx = +card.closest(".item").dataset.idx;
  });
  window.addEventListener("resize", updatePosition);
`;

const SHELF_TEMPLATE = template(SHELF_CSS, SHELF_VIEWS, SHELF_JS);

/* ============================================================================
 * Variant: coverflow (assets zip coverflow.html mockup — frozen visuals)
 * ==========================================================================*/

const COVERFLOW_CSS = `/* ============ coverflow ============ */
.flow{position:relative}
.fscroll{position:relative; overflow-x:auto; overflow-y:hidden; scrollbar-width:none;
  scroll-snap-type:x mandatory; scroll-behavior:smooth}
.fscroll::-webkit-scrollbar{display:none}
.fsticky{position:sticky; left:0; width:100%; height:246px; overflow:hidden}
.fstage{position:absolute; inset:0; margin:0; padding:0; list-style:none; perspective:1100px}
.frow{display:flex; height:1px; width:max-content} /* padding set in JS so scroll range is exact */
.fsnap{flex:none; width:70px; scroll-snap-align:center}
.fitem{position:absolute; left:50%; top:12px; width:150px; margin-left:-75px; will-change:transform}
.cover{
  position:relative; display:block; width:150px; height:200px;
  border-radius:4px 10px 10px 4px; overflow:hidden;
  box-shadow:var(--pagestack), var(--shadow);
  -webkit-box-reflect:below 3px linear-gradient(transparent 62%, rgba(0,0,0,.15));
}
.cover::before{
  content:""; position:absolute; inset:0; z-index:1; pointer-events:none; border-radius:inherit;
  background:
    linear-gradient(90deg, var(--spine) 0%, transparent 9%),
    linear-gradient(90deg, transparent 4.5%, var(--crease) 7%, transparent 11%),
    linear-gradient(168deg, var(--sheen) 0%, transparent 24%);
}
.card{display:block; width:150px; text-align:left; border-radius:12px}
.card[aria-pressed="true"] .cover{outline:2.5px solid var(--accent); outline-offset:3px}
/* generated placeholder cover */
.ph{
  position:absolute; inset:0; display:flex; flex-direction:column;
  padding:13px 12px 11px;
  background:linear-gradient(160deg,
    oklch(var(--cov-l) var(--cov-c) var(--h)) 0%,
    oklch(var(--cov-l2) var(--cov-c2) var(--h2)) 100%);
  color:oklch(var(--cov-tx-l) var(--cov-tx-c) var(--h));
}
.ph::after{content:""; position:absolute; inset:7px; border-radius:7px;
  border:1px solid var(--cov-line); pointer-events:none}
.ph .mark{width:24px; height:24px; border-radius:50%; background:var(--cov-shine); margin-bottom:11px; flex:none}
.ph[data-v="1"] .mark{border-radius:6px}
.ph[data-v="2"] .mark{width:36px; height:11px; border-radius:999px}
.ph .pt{font-size:14px; line-height:1.26; font-weight:650; letter-spacing:.01em;
  display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden;
  overflow-wrap:anywhere; text-wrap:pretty}
.ph .pa{margin-top:auto; font-size:11px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.ph .pt.raw{font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:500; font-size:12px}
.cover img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:var(--card)}
/* score badge (semantic only) */
.score{
  position:absolute; left:8px; bottom:8px; z-index:2;
  font-size:10px; font-variant-numeric:tabular-nums;
  padding:2px 7px; border-radius:999px;
  background:var(--scrim); color:var(--tx-muted); display:none;
}
[data-mode="semantic"] .score{display:block}
[data-mode="semantic"] .ph .pa{padding-left:46px}
/* opening chip */
.opening{
  position:absolute; inset:auto 8px 8px auto; z-index:2;
  font-size:10.5px; padding:3px 8px; border-radius:999px;
  background:var(--accent); color:#fff;
  opacity:0; transform:translateY(4px);
  transition:opacity .15s ease, transform .15s ease; pointer-events:none;
}
.card.is-opening .opening{opacity:1; transform:none}
/* label under the flow */
.flabel{display:flex; flex-direction:column; align-items:center; gap:1px;
  padding:2px 18px 0; text-align:center; min-height:44px}
.flabel .ft{font-size:13px; font-weight:600; line-height:1.3; max-width:420px;
  display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden}
.flabel .fa{font-size:11.5px; color:var(--tx-muted)}
.flabel .fread{margin-top:3px; font-size:11px; padding:3px 12px; border-radius:999px;
  background:var(--accent-tint); color:var(--accent); font-weight:550}
.flabel .fread:hover{background:var(--accent); color:#fff}
body[data-noread="1"] .fread{display:none}
/* arrows */
.arrow{
  position:absolute; top:106px; z-index:4;
  width:34px; height:34px; border-radius:50%;
  background:var(--btn); box-shadow:var(--shadow-lg);
  display:grid; place-items:center; transition:opacity .15s ease;
}
.arrow:hover{background:var(--accent-tint)}
.arrow svg{stroke:var(--tx); stroke-width:2.75; fill:none; stroke-linecap:round; stroke-linejoin:round}
.arrow[disabled]{opacity:0; pointer-events:none}
.arrow.prev{left:8px} .arrow.next{right:8px}

/* ============ skeleton (coverflow pose) ============ */
.skelstage{position:relative; height:246px; overflow:hidden; perspective:1100px;
  margin:0; padding:0; list-style:none}
.skelstage .fitem{top:12px}
.cover-s{
  width:150px; height:200px; border-radius:4px 10px 10px 4px;
  background:var(--skel); position:relative; overflow:hidden;
}
.cover-s::after{
  content:""; position:absolute; inset:0;
  background:linear-gradient(100deg, transparent 30%, var(--skel-hi) 50%, transparent 70%);
  transform:translateX(-100%); animation:shimmer 1.4s infinite;
}
@keyframes shimmer{to{transform:translateX(100%)}}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important; transition:none!important}
  .fscroll{scroll-behavior:auto}
}
`;

const COVERFLOW_VIEWS = `
  <div class="view view-loading" aria-hidden="true">
    <ul class="skelstage" id="skelstage"></ul>
  </div>

  <div class="view view-results">
    <div class="flow">
      <div class="fscroll" id="fscroll" tabindex="0" role="listbox" aria-label="Search results, coverflow">
        <div class="fsticky"><ul class="fstage" id="fstage"></ul></div>
        <div class="frow" id="frow"></div>
      </div>
      <button class="arrow prev" id="fprev" aria-label="Previous"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="arrow next" id="fnext" aria-label="Next"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      <div class="flabel"><div class="ft" id="ft"></div><div class="fa" id="fa"></div>
        <button class="fread" id="fread" type="button">Read</button></div>
    </div>
  </div>
`;

const COVERFLOW_JS = `  /* ================= coverflow rendering ================= */
  var FSTEP = 70; // px of scroll per book (matches .fsnap width)
  var fscroll = document.getElementById("fscroll"), fstage = document.getElementById("fstage"),
      frow = document.getElementById("frow"), fprev = document.getElementById("fprev"),
      fnext = document.getElementById("fnext"), ft = document.getElementById("ft"),
      fa = document.getElementById("fa"), fread = document.getElementById("fread");
  var F = { n: 0, cur: 0, lastC: -1 };

  // 3D pose for an item e steps away from center (shared with the skeleton).
  function pose(e) {
    var k = Math.max(-1, Math.min(1, e)), ae = Math.abs(e);
    return {
      tf: "translateX(" + (e * 54 + k * 54) + "px) translateZ(" + ((1 - Math.abs(k)) * 80) + "px)" +
          " rotateY(" + (-k * 42) + "deg) scale(" + Math.max(0.55, 1 - Math.min(ae, 5) * 0.075) + ")",
      z: String(200 - Math.round(ae * 10)),
      op: String(Math.max(0, Math.min(1, 1 - (ae - 3.4) * 0.5)))
    };
  }

  function centerIdx() { return Math.max(0, Math.min(F.n - 1, Math.round(F.cur))); }

  function renderResults() {
    var books = payload.books;
    F.n = books.length; F.lastC = -1; S.count = books.length;
    frow.style.paddingInline = (fscroll.clientWidth / 2 - FSTEP / 2) + "px";
    var snaps = document.createDocumentFragment();
    for (var i = 0; i < F.n; i++) snaps.appendChild(el("div", "fsnap"));
    frow.replaceChildren(snaps);
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var title = String(b.title || "book " + b.bookId);
      var authors = (b.authors || []).join(", ");
      var h = hash(title) % 360, h2 = (h + 38) % 360, v = hash(title) % 3;

      var li = el("li", "fitem");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = -1;

      var cover = el("span", "cover");
      cover.style.setProperty("--h", String(h));
      cover.style.setProperty("--h2", String(h2));

      var ph = el("span", "ph");
      ph.dataset.v = String(v);
      ph.appendChild(el("span", "mark"));
      ph.appendChild(el("span", isRaw(title) ? "pt raw" : "pt", title));
      ph.appendChild(el("span", "pa", authors));
      cover.appendChild(ph);

      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () { img.remove(); }; // no/broken cover → generated placeholder
      img.src = thumbUrl(b.bookId);
      cover.appendChild(img);

      if (typeof b.score === "number") cover.appendChild(el("span", "score", b.score.toFixed(2)));
      cover.appendChild(el("span", "opening", "Opening\\u2026"));
      card.appendChild(cover);
      li.appendChild(card);
      frag.appendChild(li);
    });
    fstage.replaceChildren(frag);
    if (!openLinksOk) disableRead();
    fscroll.scrollLeft = 0;
    layoutFlow();
    reportSize();
  }

  function layoutFlow() {
    var cur = fscroll.scrollLeft / FSTEP; F.cur = cur;
    fstage.querySelectorAll(".fitem").forEach(function (item, i) {
      var p = pose(i - cur);
      item.style.transform = p.tf; item.style.zIndex = p.z; item.style.opacity = p.op;
    });
    var c = centerIdx();
    if (c !== F.lastC) {
      F.lastC = c;
      var b = payload.books[c];
      var title = String(b.title || "book " + b.bookId);
      ft.textContent = title;
      fa.textContent = (b.authors || []).join(", ") || "\\u2014";
      fread.setAttribute("aria-label", "Read " + title + " in external viewer");
    }
    fprev.disabled = cur <= 0.02; fnext.disabled = cur >= F.n - 1.02;
    pos.textContent = (c + 1) + " of " + F.n;
  }

  function renderSkeleton() {
    var s = document.getElementById("skelstage");
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 5; i++) {
      var p = pose(i - 2);
      var li = el("li", "fitem");
      li.style.transform = p.tf; li.style.zIndex = p.z;
      li.appendChild(el("div", "cover-s"));
      frag.appendChild(li);
    }
    s.replaceChildren(frag);
  }

  /* ================= interactions ================= */
  function selectCenter() {
    var c = centerIdx();
    var card = fstage.querySelector('.fitem[data-idx="' + c + '"] .card');
    if (!card) return;
    fstage.querySelectorAll(".card").forEach(function (x) {
      x.setAttribute("aria-pressed", "false"); x.setAttribute("aria-selected", "false"); x.classList.remove("is-opening");
    });
    card.setAttribute("aria-pressed", "true"); card.setAttribute("aria-selected", "true");
    card.classList.add("is-opening"); S.selected = +card.dataset.id;
    clearTimeout(S._t); S._t = setTimeout(function () { card.classList.remove("is-opening"); }, 1400);
    onCardClick(S.selected);
  }
  fscroll.addEventListener("scroll", function () { requestAnimationFrame(layoutFlow); });
  fprev.addEventListener("click", function () { fscroll.scrollTo({ left: (Math.round(F.cur) - 1) * FSTEP, behavior: "smooth" }); });
  fnext.addEventListener("click", function () { fscroll.scrollTo({ left: (Math.round(F.cur) + 1) * FSTEP, behavior: "smooth" }); });
  fstage.addEventListener("click", function (e) {
    var li = e.target.closest(".fitem"); if (!li) return;
    var i = +li.dataset.idx;
    // Off-center click just scrolls that book to center; a centered click opens it.
    if (Math.round(F.cur) !== i) { fscroll.scrollTo({ left: i * FSTEP, behavior: "smooth" }); return; }
    selectCenter();
  });
  fscroll.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      var d = e.key === "ArrowRight" ? 1 : -1;
      fscroll.scrollTo({ left: (Math.round(F.cur) + d) * FSTEP, behavior: "smooth" });
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectCenter(); }
  });
  fread.addEventListener("click", function () { onRead(payload.books[centerIdx()].bookId); });
  window.addEventListener("resize", function () {
    if (S.state !== "results") return;
    frow.style.paddingInline = (fscroll.clientWidth / 2 - FSTEP / 2) + "px";
    layoutFlow();
  });
`;

const COVERFLOW_TEMPLATE = template(COVERFLOW_CSS, COVERFLOW_VIEWS, COVERFLOW_JS);
// Cover-board widget for the MCP Apps iframe (issues #19/#22/#53). ONE HTML document ships
// BOTH visual variants — "shelf" (carousel) and "coverflow" (3D cover flow) — with a runtime
// toggle (the .vswitch pill). CALIBRE_MCP_BOARD_STYLE picks only the INITIAL variant; the
// client-side toggle keeps the served resource static, so per-call switching stays spec-legal
// (issues #24/#53). Both variants share one MCP plumbing core: appInfo handshake, data pull via
// widget-initiated tools/call (Desktop strips structuredContent from the tool-result
// notification), card click → calibre_get_book, Open → calibre_open_book (a tools/call, never a
// link, so it never degrades), Search-inside → ui/message. SDK-free; served by server.ts as two
// ui:// resources (one per search tool, so the widget knows its tool without guessing).
// Injection hygiene: all book fields land via textContent/createElement — no innerHTML, no eval.
// The widget JS avoids template literals so the outer literals need no escaping.

import { DEBUG_JS } from "./debug-js.js";

export const BOARD_KEYWORD_URI = "ui://calibre/board-keyword.html";
export const BOARD_SEMANTIC_URI = "ui://calibre/board-semantic.html";

/** Cover-board visual style; picks the INITIAL variant (config.boardStyle), toggled at runtime. */
export type BoardStyle = "shelf" | "coverflow";

/** Render the board template for one owning search tool, with an initial variant. */
export function boardHtml(
  tool: "calibre_search" | "calibre_semantic_search",
  version: string,
  style: BoardStyle = "shelf",
  debug = false,
): string {
  return BOARD_TEMPLATE.replaceAll("__TOOL__", tool)
    .replaceAll("__VERSION__", version)
    .replaceAll("__VARIANT__", style)
    .replaceAll("__DEBUG__", debug ? DEBUG_JS : "");
}

/* ============================================================================
 * Shared shell — tokens, base, meta row (+ variant toggle), cover, arrows.
 * The ONLY place colors live (frozen mockup); both variants consume these tokens.
 * ==========================================================================*/

const SHARED_CSS_TOP = `/* ============ tokens — the ONLY place colors live (frozen mockup) ============ */
:root{
  color-scheme: light dark;
  /* fallbacks (no light-dark support) */
  --bg:#faf7f2; --tx:#33302b; --tx-muted:#8a8378; --card:#ffffff;
  --line:rgba(60,50,40,.14); --accent:#c67139; --accent-deep:#8f4c20; --btn:#ffffff;
  /* live tokens */
  --bg: light-dark(#faf7f2, #262624);
  --tx: light-dark(#33302b, #ece9e3);
  --tx-muted: light-dark(#8a8378, #9c958a);
  --card: light-dark(#ffffff, #31302e);
  --line: light-dark(rgba(60,50,40,.14), rgba(255,255,255,.13));
  --accent: light-dark(#c67139, #d98d55);
  --accent-deep: light-dark(#8f4c20, #e8ab7d);
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
svg.i{width:12px;height:12px;stroke:currentColor;stroke-width:2.75;fill:none;stroke-linecap:round;stroke-linejoin:round;flex:none}

/* ============ widget shell ============ */
.widget{position:relative; max-width:800px; margin:0 auto;}
.meta{
  display:flex; align-items:center; gap:12px;
  padding:0 18px 6px; min-height:24px;
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
/* chrome-level variant toggle (shelf ⇄ coverflow) */
.vswitch{display:inline-flex; background:var(--btn); box-shadow:var(--shadow); border-radius:999px; padding:2px}
.vswitch button{display:grid; place-items:center; width:26px; height:20px; border-radius:999px; color:var(--tx-muted)}
.vswitch button:hover{color:var(--accent)}
.vswitch button[aria-pressed="true"]{background:var(--accent-tint); color:var(--accent)}
`;

/* ============================================================================
 * Shared cover — line-for-line identical across variants today; per-variant only
 * dimensions (scoped in SHELF_CSS/COVERFLOW_CSS). The score badge stays semantic-only.
 * ==========================================================================*/

const COVER_CSS = `/* ============ shared cover (both variants) ============ */
.cover{
  position:relative; display:block; overflow:hidden;
  border-radius:4px 11px 11px 4px; /* square spine edge, rounded fore-edge */
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
.cover img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:var(--card)}
/* generated placeholder cover */
.ph{
  position:absolute; inset:0; display:flex; flex-direction:column; padding:12px 11px 10px;
  background:linear-gradient(160deg,
    oklch(var(--cov-l) var(--cov-c) var(--h)) 0%,
    oklch(var(--cov-l2) var(--cov-c2) var(--h2)) 100%);
  color:oklch(var(--cov-tx-l) var(--cov-tx-c) var(--h));
}
.ph::after{ /* inner rule = deliberate "printed cover" feel */
  content:""; position:absolute; inset:6px; border-radius:7px;
  border:1px solid var(--cov-line); pointer-events:none;
}
.ph .mark{width:22px; height:22px; border-radius:50%; background:var(--cov-shine); margin-bottom:10px; flex:none}
.ph[data-v="1"] .mark{border-radius:6px}
.ph[data-v="2"] .mark{width:34px; height:10px; border-radius:999px}
.ph .pt{
  font-size:13px; line-height:1.25; font-weight:650; letter-spacing:.01em;
  display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden;
  overflow-wrap:anywhere; text-wrap:pretty;
}
.ph .pt.raw{ /* raw filename → typewriter-ish, still intentional */
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:500; font-size:11.5px;
}
.ph .pa{margin-top:auto; font-size:10.5px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
/* score badge (semantic only) */
.score{
  position:absolute; left:7px; bottom:7px; z-index:2;
  font-size:10px; font-variant-numeric:tabular-nums;
  padding:2px 7px; border-radius:999px;
  background:var(--scrim); color:var(--tx-muted); display:none;
}
[data-mode="semantic"] .score{display:block}
[data-mode="semantic"] .ph .pa{padding-left:44px} /* reserve room for score badge */
/* opening chip */
.opening{
  position:absolute; inset:auto 7px 7px auto; z-index:2;
  font-size:10.5px; padding:3px 8px; border-radius:999px;
  background:var(--accent); color:#fff;
  opacity:0; transform:translateY(4px);
  transition:opacity .15s ease, transform .15s ease; pointer-events:none;
}
.card.is-opening .opening{opacity:1; transform:none}
`;

const ARROW_CSS = `/* ============ nav arrows (both variants; per-variant only the vertical offset) ============ */
.arrow{
  position:absolute; z-index:4;
  width:34px; height:34px; border-radius:50%;
  background:var(--btn); box-shadow:var(--shadow-lg);
  display:grid; place-items:center; transition:opacity .15s ease;
}
.arrow:hover{background:var(--accent-tint)}
.arrow svg{stroke:var(--tx); stroke-width:2.75; fill:none; stroke-linecap:round; stroke-linejoin:round}
.arrow[disabled]{opacity:0; pointer-events:none}
.arrow.prev{left:8px} .arrow.next{right:8px}
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

/* ============ shared shimmer (both skeletons) ============ */
.cover-s::after{
  content:""; position:absolute; inset:0;
  background:linear-gradient(100deg, transparent 30%, var(--skel-hi) 50%, transparent 70%);
  transform:translateX(-100%); animation:shimmer 1.4s infinite;
}
@keyframes shimmer{to{transform:translateX(100%)}}

/* degrade: first failed ui/message hides every message-dependent affordance at once */
body[data-nomsg="1"] [data-need="msg"]{display:none}

/* ============ hero — single identified book renders card-like, not a lone shelf (issue #71) ============ */
.view-hero{padding:6px 18px 14px}
.view-hero .hero{display:flex; gap:22px; align-items:flex-start}
.view-hero .cover{width:168px; height:224px}
.hero-cover{display:block; flex:none; border-radius:14px; text-align:left}
.hero-cover:hover .cover{transform:translateY(-3px); box-shadow:var(--pagestack), var(--shadow-lg)}
.hero-info{min-width:0; display:flex; flex-direction:column; gap:4px; padding-top:8px}
.hero-info .ht{font-size:17px; font-weight:650; line-height:1.3; overflow-wrap:anywhere; text-wrap:pretty}
.hero-info .ha{font-size:13px; color:var(--tx-muted)}
.hero-actions{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px}

/* ============ state × variant switching ============ */
.view{display:none}
.widget[data-state="loading"][data-variant="shelf"] .view-shelf-loading{display:block}
.widget[data-state="loading"][data-variant="coverflow"] .view-coverflow-loading{display:block}
.widget[data-state="results"][data-variant="shelf"] .view-shelf{display:block}
.widget[data-state="results"][data-variant="coverflow"] .view-coverflow{display:block}
.widget[data-state="hero"] .view-hero{display:block}
.widget[data-state="hero"] .vswitch{display:none} /* one book — nothing to lay out */
.widget[data-state="empty"] .view-empty{display:flex}
.widget[data-state="error"] .view-error{display:flex}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important; transition:none!important}
  .strip,.fscroll{scroll-behavior:auto}
}
`;

/* ============================================================================
 * Shelf variant — layout-only (cover dims + overlay + text + skeleton).
 * ==========================================================================*/

const SHELF_CSS = `/* ============ shelf / carousel ============ */
.shelf{position:relative}
.view-shelf .arrow{top:76px}
.strip{
  display:flex; gap:14px; align-items:flex-start;
  overflow-x:auto; overscroll-behavior-x:contain;
  scroll-snap-type:x proximity; scroll-behavior:smooth; scroll-padding-inline:18px;
  padding:6px 18px 10px; margin:0; list-style:none; scrollbar-width:none;
}
.strip::-webkit-scrollbar{display:none}
.item{position:relative; flex:none; scroll-snap-align:start; width:134px;}
.view-shelf .card{
  display:flex; flex-direction:column; gap:8px; width:100%;
  text-align:left; border-radius:14px; padding:0;
}
.item .cover{width:134px; height:178px}
.item:hover .cover{transform:translateY(-3px); box-shadow:var(--pagestack), var(--shadow-lg)}
.view-shelf .card[aria-pressed="true"] .cover{outline:2.5px solid var(--accent); outline-offset:2px}
/* text under cover */
.t{
  font-size:12.5px; line-height:1.3; font-weight:550;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere;
}
.a{font-size:11.5px; color:var(--tx-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
/* per-card action overlay (Open + Search inside) */
.ov-stack{
  position:absolute; top:7px; right:7px; z-index:3;
  display:flex; flex-direction:column; align-items:flex-end; gap:5px;
  opacity:0; transform:translateY(-3px);
  transition:opacity .15s ease, transform .15s ease;
}
.item:hover .ov-stack, .item:focus-within .ov-stack{opacity:1; transform:none}
.ov{display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:4px 10px; border-radius:999px}
.ov.open{background:var(--accent); color:#fff}
.ov.open:hover{background:var(--accent-deep)}
.ov.search{background:var(--scrim); color:var(--tx); box-shadow:var(--shadow)}
.ov.search:hover{color:var(--accent)}

/* ============ shelf skeleton ============ */
.skel .cover-s{
  width:134px; height:178px; border-radius:11px; flex:none;
  background:var(--skel); position:relative; overflow:hidden;
}
.skel .l1,.skel .l2{height:10px; border-radius:6px; background:var(--skel)}
.skel .l1{width:80%; margin-top:9px} .skel .l2{width:55%; margin-top:6px}
`;

/* ============================================================================
 * Coverflow variant — layout-only (stage + cover dims + label bar + skeleton).
 * ==========================================================================*/

const COVERFLOW_CSS = `/* ============ coverflow ============ */
.flow{position:relative}
.view-coverflow .arrow{top:106px}
.fscroll{position:relative; overflow-x:auto; overflow-y:hidden; scrollbar-width:none;
  scroll-snap-type:x mandatory; scroll-behavior:smooth}
.fscroll::-webkit-scrollbar{display:none}
.fsticky{position:sticky; left:0; width:100%; height:246px; overflow:hidden}
.fstage{position:absolute; inset:0; margin:0; padding:0; list-style:none; perspective:1100px}
.frow{display:flex; height:1px; width:max-content} /* padding set in JS so scroll range is exact */
.fsnap{flex:none; width:70px; scroll-snap-align:center}
.fitem{position:absolute; left:50%; top:12px; width:150px; margin-left:-75px; will-change:transform}
.fitem .cover{
  width:150px; height:200px; border-radius:4px 10px 10px 4px;
  -webkit-box-reflect:below 3px linear-gradient(transparent 62%, rgba(0,0,0,.15));
}
.fitem .card{display:block; width:150px; text-align:left; border-radius:12px}
.fitem .card[aria-pressed="true"] .cover{outline:2.5px solid var(--accent); outline-offset:3px}
/* label + actions under the flow */
.flabel{display:flex; flex-direction:column; align-items:center; gap:1px;
  padding:2px 18px 0; text-align:center; min-height:62px}
.flabel .ft{font-size:13px; font-weight:600; line-height:1.3; max-width:420px;
  display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden}
.flabel .fa{font-size:11.5px; color:var(--tx-muted)}
.facts-row{display:flex; gap:8px; margin-top:5px}
.fbtn{display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; padding:5px 14px; border-radius:999px}
.fbtn.primary{background:var(--accent); color:#fff}
.fbtn.primary:hover{background:var(--accent-deep)}
.fbtn.ghost{background:var(--btn); box-shadow:var(--shadow)}
.fbtn.ghost:hover{background:var(--accent-tint); color:var(--accent)}

/* ============ coverflow skeleton (coverflow pose) ============ */
.skelstage{position:relative; height:246px; overflow:hidden; perspective:1100px; margin:0; padding:0; list-style:none}
.skelstage .fitem{top:12px}
.skelstage .cover-s{
  width:150px; height:200px; border-radius:4px 10px 10px 4px;
  background:var(--skel); position:relative; overflow:hidden;
}
`;

/* ============================================================================
 * One BOARD_VIEWS block — both skeletons, both results views. No ID collisions.
 * ==========================================================================*/

const BOARD_VIEWS = `
  <div class="view view-shelf-loading">
    <ul class="strip" aria-hidden="true" id="skelStrip"></ul>
  </div>

  <div class="view view-coverflow-loading" aria-hidden="true">
    <ul class="skelstage" id="skelstage"></ul>
  </div>

  <div class="view view-shelf">
    <div class="shelf">
      <ul class="strip" id="strip" role="listbox" aria-label="Search results"></ul>
      <button class="arrow prev" id="prev" aria-label="Previous results"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="arrow next" id="next" aria-label="Next results"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
  </div>

  <div class="view view-hero">
    <div class="hero">
      <button class="hero-cover" id="hCover" type="button" aria-label="Show full book details"></button>
      <div class="hero-info">
        <div class="ht" id="hTitle"></div>
        <div class="ha" id="hAuthors"></div>
        <div class="hero-actions">
          <button class="fbtn primary" id="hOpen" type="button">
            <svg class="i" viewBox="0 0 24 24"><path d="M2 4h7a3 3 0 013 3v13a3 3 0 00-3-3H2zM22 4h-7a3 3 0 00-3 3v13a3 3 0 013-3h7z"/></svg>
            Open</button>
          <button class="fbtn ghost" id="hSearch" type="button" data-need="msg">
            <svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
            Search inside</button>
        </div>
      </div>
    </div>
  </div>

  <div class="view view-coverflow">
    <div class="flow">
      <div class="fscroll" id="fscroll" tabindex="0" role="listbox" aria-label="Search results, coverflow">
        <div class="fsticky"><ul class="fstage" id="fstage"></ul></div>
        <div class="frow" id="frow"></div>
      </div>
      <button class="arrow prev" id="fprev" aria-label="Previous"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="arrow next" id="fnext" aria-label="Next"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      <div class="flabel">
        <div class="ft" id="ft"></div><div class="fa" id="fa"></div>
        <div class="facts-row">
          <button class="fbtn primary" id="fopen" type="button">
            <svg class="i" viewBox="0 0 24 24"><path d="M2 4h7a3 3 0 013 3v13a3 3 0 00-3-3H2zM22 4h-7a3 3 0 00-3 3v13a3 3 0 013-3h7z"/></svg>
            Open</button>
          <button class="fbtn ghost" id="fsearch" type="button" data-need="msg">
            <svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
            Search inside</button>
        </div>
      </div>
    </div>
  </div>
`;

/* ============================================================================
 * Shared widget JS — MCP plumbing + shared render/action helpers. Each variant
 * block below supplies renderShelf/renderFlow (etc.) and its own interactions;
 * function declarations hoist, so the core may call them. No template literals,
 * no innerHTML, no console.
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
__DEBUG__
  /* ================= widget state ================= */
  var w = document.getElementById("w"), pos = document.getElementById("pos");
  var S = {
    state: "loading", variant: w.dataset.variant || "shelf",
    rendered: { shelf: false, coverflow: false },
    count: 0, selected: null, focusIdx: 0
  };
  var ready = false;          // ui/initialize handshake done
  var afterReady = [];        // thunks queued until then
  var toolArgs = null;        // from ui/notifications/tool-input
  var sawResult = false;      // tool-result notification arrived
  var payload = null;         // BoardPayload being rendered

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
      // Board is bound at the tool level, so scope=book and countOnly calls render it too
      // (per-call suppression is not spec-legal, issue #24) — collapse to zero height
      // instead. countOnly checked as string too: hosts forward raw args uncoerced (#67).
      if (toolArgs && (toolArgs.scope === "book" || toolArgs.countOnly === true || toolArgs.countOnly === "true")) collapse();
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
    // Zero-result searches attach no board payload (issue #68) — when the notification
    // carries the result text, recognize our own zero-result strings and collapse
    // without pulling (the cache has nothing for this query).
    if (isZeroResult(res)) { collapse(); return; }
    var meta = res && res._meta;
    if (meta && meta.calibreBoard && meta.calibreBoard.books) { gotPayload(meta.calibreBoard); return; }
    pullData(false);
  }

  function isZeroResult(res) {
    var sc = res && res.structuredContent;
    if (sc && (sc.total === 0 || sc.count === 0)) return true;
    var c = res && res.content;
    var t = c && c[0] && c[0].type === "text" ? String(c[0].text) : "";
    return /^0 books matched|^0 full-text matches|^No matches for/.test(t);
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
        .then(function (r) {
          // Zero results never populate the cache (issue #68) — collapse, don't error.
          if (isZeroResult(r)) { collapse(); return; }
          pullData(true);
        })
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
    // A single identified book gets the card-like hero, not a one-book shelf (issue #71).
    // Gate on total too — a limit:1 page of many results must still render the strip.
    if (p.books.length === 1 && (p.total === undefined || p.total === 1)) {
      renderHero();
      setState("hero");
      return;
    }
    // New payload — force a fresh render of whichever variant is active (and re-render the
    // other lazily the first time it becomes active).
    S.rendered = { shelf: false, coverflow: false };
    setState("results");
  }

  /* ================= hero (single result, issue #71) ================= */
  function heroBook() { return payload && payload.books && payload.books[0]; }
  function renderHero() {
    var b = heroBook();
    document.getElementById("hCover").replaceChildren(buildCover(b));
    document.getElementById("hTitle").textContent = String(b.title || "book " + b.bookId);
    document.getElementById("hAuthors").textContent = (b.authors || []).join(", ");
    reportSize();
  }
  document.getElementById("hCover").addEventListener("click", function () {
    var b = heroBook(); if (b) onCardClick(b.bookId);
  });
  document.getElementById("hOpen").addEventListener("click", function () {
    var b = heroBook(); if (b) openBook(b.bookId);
  });
  document.getElementById("hSearch").addEventListener("click", function () {
    var b = heroBook(); if (b) onSearchInside(b.bookId);
  });

  /* ================= MCP actions ================= */
  function thumbUrl(bookId) {
    var base = String(payload.serverUrl || "").replace(/\\/+$/, "");
    return base + "/get/thumb/" + bookId + "/" + encodeURIComponent(payload.libraryId) + "?sz=268x356";
  }
  function payloadQuery() {
    return (payload && payload.query) || (toolArgs && toolArgs.query) || "";
  }
  function bookById(id) {
    var books = (payload && payload.books) || [];
    for (var i = 0; i < books.length; i++) if (books[i].bookId === id) return books[i];
    return null;
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

  // Open in the local Calibre viewer — a tools/call, never a link, so it never degrades.
  function openBook(bookId) {
    rpcRequest("tools/call", { name: "calibre_open_book", arguments: { id: bookId, library: payload.libraryId } })
      .catch(function () {});
  }

  // Search-inside → ui/message. A successful send resolves {} (probe 2026-07-21, #72) —
  // a resolve is delivery, never a degrade signal; only method-not-found hides the layer.
  function onSearchInside(bookId) {
    var b = bookById(bookId);
    if (!b) return;
    var title = String(b.title || "book " + bookId);
    sendMessage('Search inside "' + title + '" (book id ' + bookId + ') for: ' + payloadQuery());
  }
  function sendMessage(text) {
    rpcRequest("ui/message", { role: "user", content: [{ type: "text", text: text }] })
      .catch(function (e) { if (e && e.code === -32601) noMsg(); });
  }
  function noMsg() { document.body.dataset.nomsg = "1"; }

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
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function openIcon() {
    var s = svgEl("svg", { class: "i", viewBox: "0 0 24 24" });
    s.appendChild(svgEl("path", { d: "M2 4h7a3 3 0 013 3v13a3 3 0 00-3-3H2zM22 4h-7a3 3 0 00-3 3v13a3 3 0 013-3h7z" }));
    return s;
  }
  function searchIcon() {
    var s = svgEl("svg", { class: "i", viewBox: "0 0 24 24" });
    s.appendChild(svgEl("circle", { cx: "11", cy: "11", r: "7" }));
    s.appendChild(svgEl("path", { d: "M21 21l-4.35-4.35" }));
    return s;
  }

  // The cover-DOM builder — identical for both variants; per-variant dimensions are CSS-only.
  function buildCover(b) {
    var title = String(b.title || "book " + b.bookId);
    var authors = (b.authors || []).join(", ");
    var h = hash(title) % 360, h2 = (h + 38) % 360, v = hash(title) % 3;

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
    return cover;
  }

  // Shared card selection: reset siblings, mark this one opening, fire calibre_get_book.
  function activateCard(root, card) {
    root.querySelectorAll(".card").forEach(function (c) {
      c.setAttribute("aria-pressed", "false"); c.setAttribute("aria-selected", "false"); c.classList.remove("is-opening");
    });
    card.setAttribute("aria-pressed", "true"); card.setAttribute("aria-selected", "true");
    card.classList.add("is-opening"); S.selected = +card.dataset.id;
    clearTimeout(S._t); S._t = setTimeout(function () { card.classList.remove("is-opening"); }, 1400);
    onCardClick(S.selected);
  }

  /* ================= state + variant switching ================= */
  function setState(st) {
    S.state = st;
    w.dataset.state = st;
    if (st === "results") showActive(); else pos.textContent = "";
    reportSize();
  }

  // Render the active variant (lazily, once per payload) or refresh its geometry.
  function showActive() {
    var v = S.variant;
    if (!S.rendered[v]) {
      S.rendered[v] = true;
      if (v === "shelf") renderShelf(); else renderFlow();
    } else {
      refreshActive();
    }
  }
  function refreshActive() {
    if (S.variant === "coverflow") {
      frow.style.paddingInline = (fscroll.clientWidth / 2 - FSTEP / 2) + "px";
      layoutFlow();
    } else {
      updateShelfPos();
    }
  }

  function setVariant(v) {
    S.variant = v;
    w.dataset.variant = v; // FIRST — coverflow geometry reads fscroll.clientWidth (zero while hidden)
    document.getElementById("vShelf").setAttribute("aria-pressed", String(v === "shelf"));
    document.getElementById("vFlow").setAttribute("aria-pressed", String(v === "coverflow"));
    if (S.state === "results") showActive();
    reportSize();
  }
  document.getElementById("vShelf").addEventListener("click", function () { setVariant("shelf"); });
  document.getElementById("vFlow").addEventListener("click", function () { setVariant("coverflow"); });

  // One shared resize listener for both variants (replaces the two per-variant ones).
  window.addEventListener("resize", function () {
    if (S.state !== "results") return;
    refreshActive();
  });

  document.getElementById("retry").addEventListener("click", function () {
    setState("loading");
    pullData(false);
  });
`;

const BOOT_JS = `  /* ================= boot: both skeletons first, then handshake ================= */
  renderShelfSkeleton();
  renderFlowSkeleton();
  setState("loading");
  setVariant(S.variant); // sync aria-pressed + dataset for the initial variant
  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    // appInfo (not the client-info field name) — the host zod-validates this shape (spike #21)
    appInfo: { name: "calibre-cover-board", version: "__VERSION__" }
  }).then(function (r) {
    // Hosts that declare capabilities but omit ui/message → hide the msg layer up front.
    var caps = r && r.hostCapabilities;
    if (caps && !caps.message) noMsg();
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

/* ============================================================================
 * Shelf JS — renderShelf / renderShelfSkeleton / updateShelfPos + interactions.
 * ==========================================================================*/

const SHELF_JS = `  /* ================= shelf rendering ================= */
  var strip = document.getElementById("strip"),
      prev = document.getElementById("prev"), next = document.getElementById("next");

  function renderShelf() {
    var books = payload.books;
    S.count = books.length;
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var title = String(b.title || "book " + b.bookId);
      var authors = (b.authors || []).join(", ");

      var li = el("li", "item");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = i === 0 ? 0 : -1;
      card.appendChild(buildCover(b));
      card.appendChild(el("span", "t", title));
      card.appendChild(el("span", "a", authors || "\\u00A0"));
      li.appendChild(card);

      // hover/focus action overlay — Open (never degrades) + Search inside (data-need="msg")
      var ov = el("span", "ov-stack");
      var open = el("button", "ov open");
      open.type = "button";
      open.dataset.open = String(b.bookId);
      open.setAttribute("aria-label", "Open " + title + " in local viewer");
      open.appendChild(openIcon());
      open.appendChild(el("span", null, "Open"));
      ov.appendChild(open);
      var si = el("button", "ov search");
      si.type = "button";
      si.dataset.searchin = String(b.bookId);
      si.dataset.need = "msg";
      si.setAttribute("aria-label", "Search this query inside " + title);
      si.appendChild(searchIcon());
      si.appendChild(el("span", null, "Search inside"));
      ov.appendChild(si);
      li.appendChild(ov);

      frag.appendChild(li);
    });
    strip.replaceChildren(frag);
    strip.scrollLeft = 0; S.focusIdx = 0; S.selected = null;
    updateShelfPos(); reportSize();
  }

  function renderShelfSkeleton() {
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
  function updateShelfPos() {
    var n = S.count, vis = Math.max(1, Math.floor(strip.clientWidth / cardStep()));
    var first = Math.min(n - vis, Math.round(strip.scrollLeft / cardStep()));
    var a = Math.max(1, first + 1), b = Math.min(n, first + vis);
    if (S.variant === "shelf") pos.textContent = a + "\\u2013" + b + " of " + n;
    var max = strip.scrollWidth - strip.clientWidth - 2;
    prev.disabled = strip.scrollLeft <= 2; next.disabled = strip.scrollLeft >= max;
  }
  strip.addEventListener("scroll", function () { requestAnimationFrame(updateShelfPos); });
  prev.addEventListener("click", function () { strip.scrollBy({ left: -strip.clientWidth + 40, behavior: "smooth" }); });
  next.addEventListener("click", function () { strip.scrollBy({ left: strip.clientWidth - 40, behavior: "smooth" }); });

  /* ================= interactions ================= */
  strip.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { e.stopPropagation(); openBook(+o.dataset.open); return; }
    var si = e.target.closest("[data-searchin]");
    if (si) { e.stopPropagation(); onSearchInside(+si.dataset.searchin); return; }
    var card = e.target.closest(".card"); if (!card) return;
    activateCard(strip, card);
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
`;

/* ============================================================================
 * Coverflow JS — renderFlow / renderFlowSkeleton / layoutFlow + interactions.
 * ==========================================================================*/

const COVERFLOW_JS = `  /* ================= coverflow rendering ================= */
  var FSTEP = 70; // px of scroll per book (matches .fsnap width)
  var fscroll = document.getElementById("fscroll"), fstage = document.getElementById("fstage"),
      frow = document.getElementById("frow"), fprev = document.getElementById("fprev"),
      fnext = document.getElementById("fnext"), ft = document.getElementById("ft"),
      fa = document.getElementById("fa");
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

  function renderFlow() {
    var books = payload.books;
    F.n = books.length; F.lastC = -1; S.count = books.length;
    frow.style.paddingInline = (fscroll.clientWidth / 2 - FSTEP / 2) + "px";
    var snaps = document.createDocumentFragment();
    for (var i = 0; i < F.n; i++) snaps.appendChild(el("div", "fsnap"));
    frow.replaceChildren(snaps);
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var li = el("li", "fitem");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = -1;
      card.appendChild(buildCover(b));
      li.appendChild(card);
      frag.appendChild(li);
    });
    fstage.replaceChildren(frag);
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
      ft.textContent = String(b.title || "book " + b.bookId);
      fa.textContent = (b.authors || []).join(", ") || "\\u2014";
    }
    fprev.disabled = cur <= 0.02; fnext.disabled = cur >= F.n - 1.02;
    if (S.variant === "coverflow") pos.textContent = (c + 1) + " of " + F.n;
  }

  function renderFlowSkeleton() {
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
    if (card) activateCard(fstage, card);
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
  // Label-bar actions act on the centered book.
  document.getElementById("fopen").addEventListener("click", function () { openBook(payload.books[centerIdx()].bookId); });
  document.getElementById("fsearch").addEventListener("click", function () { onSearchInside(payload.books[centerIdx()].bookId); });
`;

/* ============================================================================
 * Single template — both variants + shared core in one HTML document. boardHtml()
 * does a three-token replace (__TOOL__, __VERSION__, __VARIANT__).
 * ==========================================================================*/

const BOARD_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>calibre-mcp cover board</title>
<style>
${SHARED_CSS_TOP}
${COVER_CSS}
${ARROW_CSS}
${SHELF_CSS}
${COVERFLOW_CSS}
${SHARED_CSS_BOTTOM}</style>
</head>
<body>

<div class="widget" id="w" data-state="loading" data-variant="__VARIANT__" data-mode="keyword" data-lowconf="0">
  <div class="meta">
    <span class="note">Weak matches — try rephrasing your query</span>
    <span class="vswitch" role="group" aria-label="Board layout">
      <button id="vShelf" type="button" aria-pressed="true" aria-label="Shelf layout" title="Shelf">
        <svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="5" height="14" rx="1"/><rect x="10" y="5" width="5" height="14" rx="1"/><rect x="17" y="5" width="4" height="14" rx="1"/></svg></button>
      <button id="vFlow" type="button" aria-pressed="false" aria-label="Coverflow layout" title="Coverflow">
        <svg class="i" viewBox="0 0 24 24"><rect x="8" y="4" width="8" height="16" rx="1"/><path d="M4 6v12M20 6v12"/></svg></button>
    </span>
    <span class="pos" id="pos"></span>
  </div>
${BOARD_VIEWS}
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
${SHELF_JS}
${COVERFLOW_JS}
${BOOT_JS}})();
</script>
</body>
</html>
`;

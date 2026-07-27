// Figures widget for calibre_get_figures (map #109, ticket #112): the fetch mirror —
// the user sees exactly the ≤3 figures the model fetched. Visuals are the approved v2
// mockup (docs/dev/design/figures-widget-v2.html — reading pane + margin rail; devbar,
// fake data and the SVG placeholder generator removed), with the mockup seams wired to
// MCP plumbing: data comes from the ui/notifications/tool-result content[] (probe #111 —
// text/image pairs survive intact, structuredContent/_meta do not), so there is no
// re-call and no cache. List mode (tool-input without indexes) carries no images, so the
// widget collapses to zero height. Injection hygiene as in the board/card widgets:
// no console, no innerHTML for data, no template literals in the widget JS.

import { DEBUG_JS } from "./debug-js.js";

export const FIGURES_URI = "ui://calibre/figures.html";

/** Render the figures-widget template. */
export function figuresHtml(version: string, debug = false): string {
  return TEMPLATE.replaceAll("__VERSION__", version).replaceAll("__DEBUG__", debug ? DEBUG_JS : "");
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>calibre-mcp figures</title>
<style>
/* ============ tokens (shared family: cover-board, book-card) ============ */
:root{
  color-scheme: light dark;
  --bg: light-dark(#faf7f2, #262624);
  --tx: light-dark(#33302b, #ece9e3);
  --tx-muted: light-dark(#8a8378, #9c958a);
  --card: light-dark(#ffffff, #31302e);
  --line: light-dark(rgba(60,50,40,.14), rgba(255,255,255,.13));
  --accent: light-dark(#c67139, #d98d55);
  --accent-deep: light-dark(#8f4c20, #e8ab7d);
  --accent-tint: light-dark(rgba(198,113,57,.12), rgba(217,141,85,.16));
  --sage: light-dark(#7a8a5e, #95a67a);
  --sage-tint: light-dark(rgba(122,138,94,.14), rgba(149,166,122,.16));
  --btn: light-dark(rgba(255,255,255,.94), rgba(49,48,46,.94));
  --skel: light-dark(rgba(60,50,40,.08), rgba(255,255,255,.07));
  --skel-hi: light-dark(rgba(255,255,255,.65), rgba(255,255,255,.09));
  --shadow: 0 1px 2px rgba(0,0,0,.07), 0 5px 16px rgba(0,0,0,.09);
  --shadow-lg: 0 2px 4px rgba(0,0,0,.09), 0 10px 26px rgba(0,0,0,.14);
  --scrim: light-dark(rgba(255,253,250,.92), rgba(38,38,36,.92));
  /* the plate: line art is dark-on-white, so paper stays paper in both themes —
     softened in dark so a white diagram reads as an illustration, not a glowing hole */
  --plate: light-dark(#ffffff, #e9e4db);
  --plate-edge: light-dark(rgba(60,50,40,.15), rgba(0,0,0,.5));
  --plate-mat: light-dark(#f3ece1, #2c2b28);   /* mat board the plate sits on */
}
:root[data-theme="light"]{ color-scheme:light; }
:root[data-theme="dark"]{ color-scheme:dark; }

*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg); color:var(--tx);
  font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:10px}
svg.i{width:14px;height:14px;stroke:currentColor;stroke-width:2.4;fill:none;
  stroke-linecap:round;stroke-linejoin:round;flex:none}

/* ============ widget shell ============ */
.widget{position:relative; max-width:700px; margin:0 auto; padding:10px 16px 12px}
.widget.is-collapsed{padding:0;margin:0;height:0;overflow:hidden;border:0}
.widget.is-collapsed *{display:none}

/* ============ reading pane + margin rail ============ */
.reader{display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:stretch}
.reader[data-single="1"]{grid-template-columns:minmax(0,1fr)}

/* margin rail — thumbnails as small plates, like figures pinned in a page margin */
.rail{display:flex; flex-direction:column; gap:7px; width:52px; flex:none}
.reader[data-single="1"] .rail{display:none}
.tab{position:relative; height:52px; border-radius:8px; padding:3px;
  background:var(--plate-mat); border:1px solid var(--plate-edge);
  display:grid; place-items:center; overflow:hidden;
  transition:border-color .15s ease, background .15s ease}
.tab img{position:absolute; inset:3px; width:calc(100% - 6px); height:calc(100% - 6px);
  object-fit:contain; display:block; border-radius:4px}
.tab:hover{border-color:var(--accent)}
.tab[aria-selected="true"]{background:var(--accent-tint); border-color:var(--accent);
  box-shadow:inset 0 0 0 1px var(--accent)}
.tab .n{position:absolute; left:2px; top:1px; font-size:9px; font-weight:700;
  color:var(--tx-muted); background:var(--scrim); border-radius:4px; padding:0 3px}
.tab.is-stub{background:var(--sage-tint); border-style:dashed; color:var(--sage)}
.tab.is-stub svg.i{width:15px;height:15px}

/* the pane — the figure is the UI */
.pane{position:relative; min-width:0; display:flex; flex-direction:column}
.plate{position:relative; flex:none; display:flex; align-items:center; justify-content:center;
  background:var(--plate); border:1px solid var(--plate-edge); border-radius:12px;
  box-shadow:var(--shadow); overflow:hidden; padding:10px;
  height:var(--pane-h,300px); cursor:zoom-in}
.reader[data-single="1"] .plate{height:var(--pane-h,306px)}
.plate img{max-width:100%; max-height:100%; width:auto; height:auto; display:block;
  user-select:none; -webkit-user-drag:none}
/* the pv wrapper scrolls on zoom; the plate itself never scrolls, so the chip stays pinned */
.pv{display:flex; align-items:center; justify-content:center; width:100%; height:100%; min-width:0}
.plate.is-zoomed{padding:0}
.plate.is-zoomed .pv{position:absolute; inset:0; width:auto; height:auto;
  overflow:auto; align-items:flex-start; justify-content:flex-start; cursor:grab}
.plate.is-zoomed .pv.is-dragging{cursor:grabbing}
.plate.is-zoomed img{max-width:none; max-height:none}

/* zoom affordance — quiet chip, states read as "Fit" / "100%" */
.zoomchip{position:absolute; right:8px; bottom:8px; z-index:3;
  display:inline-flex; align-items:center; gap:5px;
  font-size:11px; font-weight:600; padding:3.5px 9px; border-radius:999px;
  background:var(--scrim); color:var(--tx); box-shadow:var(--shadow);
  border:1px solid var(--line); opacity:0; transform:translateY(3px);
  transition:opacity .15s ease, transform .15s ease}
.plate:hover .zoomchip, .plate:focus-visible .zoomchip, .plate.is-zoomed .zoomchip{opacity:1; transform:none}
.plate.is-zoomed .zoomchip{color:var(--accent)}

/* caption block under the pane */
.cap{margin:9px 2px 0; font-size:13px; line-height:1.4; color:var(--tx); text-wrap:pretty;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden}
.cap.is-empty{color:var(--tx-muted); font-style:italic}
.provrow{display:flex; align-items:baseline; gap:10px; margin:2px 2px 0}
.prov{font-size:11.5px; color:var(--tx-muted); font-variant-numeric:tabular-nums}
.count{margin-left:auto; font-size:11.5px; color:var(--tx-muted); font-variant-numeric:tabular-nums}

/* skipped stub — one quiet line, never a crash */
.stub{display:flex; align-items:center; gap:7px; margin:9px 0 0; padding:6px 10px;
  border:1px dashed var(--line); border-radius:9px;
  font-size:12px; color:var(--tx-muted); background:var(--sage-tint)}
.stub svg.i{width:13px;height:13px; color:var(--sage)}
.stub b{font-weight:600; color:var(--tx)}
/* the stub selected in the rail takes the pane as a calm placard, not an image */
.stubpane{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:6px; text-align:center; height:var(--pane-h,300px); padding:20px;
  border:1px dashed var(--line); border-radius:12px; background:var(--plate-mat);
  color:var(--tx-muted); font-size:12.5px}
.stubpane svg.i{width:20px;height:20px; color:var(--sage)}
.stubpane b{color:var(--tx); font-size:13px}

/* ============ skeleton ============ */
.sk{border-radius:10px; background:var(--skel); position:relative; overflow:hidden}
.sk::after{content:""; position:absolute; inset:0; transform:translateX(-100%);
  background:linear-gradient(90deg, transparent, var(--skel-hi), transparent);
  animation:sweep 1.35s infinite}
@keyframes sweep{100%{transform:translateX(100%)}}
.sk-tab{height:52px; border-radius:8px}
.sk-plate{height:300px; border-radius:12px}
.sk-line{height:11px; margin-top:9px; width:58%}
.sk-line.s{width:30%; height:9px; margin-top:6px}

/* ============ error ============ */
.err{display:flex; align-items:center; gap:7px; padding:9px 11px; border-radius:10px;
  border:1px solid var(--line); background:var(--card); color:var(--tx-muted); font-size:12.5px}
.err svg.i{color:var(--accent)}

@media (max-width:520px){
  .rail{flex-direction:row; width:auto}
  .reader{grid-template-columns:minmax(0,1fr); grid-template-areas:"pane" "rail"}
  .pane{grid-area:pane} .rail{grid-area:rail}
  .tab{width:52px}
}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{transition:none!important; animation:none!important}
}
</style>
</head>
<body>

<div class="widget" id="w"></div>

<script>
"use strict";
(function () {
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
  var w = document.getElementById("w");
  var toolArgs = null, sawResult = false;
  var M = { state: "loading", items: [] };   // items = figures then skipped stubs
  var V = { sel: 0, zoom: false };

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
    if (m.method === "ui/notifications/tool-input-partial") return;
    if (m.method === "ui/notifications/tool-input") {
      toolArgs = (m.params && m.params.arguments) || m.params || null;
      // List mode carries no images (probe #111) — collapse to zero height, board-style.
      if (!hasIndexes(toolArgs)) setState("collapsed");
      return;
    }
    if (m.method === "ui/notifications/tool-result") {
      sawResult = true;
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

  function hasIndexes(a) {
    if (!a) return false;
    var ix = a.indexes;
    if (ix === undefined || ix === null) return false;
    if (typeof ix === "string") return ix.replace(/[\\s\\[\\]]/g, "").length > 0;
    return !(ix.length === 0);
  }

  /* ================= data: parse the notification content[] =================
     Block order (probe #111): [0] header text, then (caption text, image) pairs in
     fetch order, then the anti-confabulation steering line, then Desktop's injected
     widget note. Both trailing lines stay hidden. The image mime comes from the block
     (the host transcodes to WebP), never from the mime named in the caption line. */
  var RE_FIG = /^Figure index (\\d+) \\(([^)]*)\\)(?:\\s+\\u2014\\s+([\\s\\S]*))?$/;
  var RE_SKIP = /^Figure index (\\d+) skipped: ([\\s\\S]*)$/;

  function onToolResult(res) {
    var blocks = (res && res.content) || [];
    var figures = [], stubs = [], pendingCap = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i] || {};
      if (b.type === "image") {
        if (b.data && b.mimeType) {
          var f = pendingCap || { index: null, page: "", source: "", caption: "" };
          f.url = "data:" + b.mimeType + ";base64," + b.data;
          figures.push(f);
        }
        pendingCap = null;
        continue;
      }
      if (b.type !== "text") { pendingCap = null; continue; }
      var t = String(b.text || "").trim();
      var skip = RE_SKIP.exec(t);
      if (skip) { stubs.push({ index: +skip[1], skipped: skip[2] }); pendingCap = null; continue; }
      var fig = RE_FIG.exec(t);
      pendingCap = fig ? parseCaption(fig) : null;
    }
    M.items = figures.concat(stubs);
    V = { sel: 0, zoom: false };
    if (M.items.length) { setState("results"); return; }
    // No figures and no skips: either a list call (collapse) or a genuine failure.
    setState(res && res.isError ? "error" : "collapsed");
  }

  // "Figure index 3 (p.35, raster, image/jpeg 132.0 KB) — Figure 1.1: Clean Architecture"
  function parseCaption(m) {
    var parts = String(m[2] || "").split(", ");
    return {
      index: +m[1],
      page: String(parts[0] || "").replace(/^p\\./, ""),
      source: parts[1] || "",
      caption: (m[3] || "").trim(),
      w: 0,
      h: 0,
    };
  }

  /* ================= DOM helpers (createElement + textContent only) ================= */
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgIcon(pathData, cls) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", cls || "i");
    pathData.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, d[0]);
      Object.keys(d[1]).forEach(function (k) { p.setAttribute(k, d[1][k]); });
      s.appendChild(p);
    });
    return s;
  }
  var ICON_WARN = [["path", { d: "M12 9v4M12 17h.01M10.3 3.9L2.6 17.3A2 2 0 004.3 20h15.4a2 2 0 001.7-2.7L13.7 3.9a2 2 0 00-3.4 0z" }]];
  var ICON_ZOOM_IN = [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "M20 20l-3.5-3.5M11 8v6M8 11h6" }]];
  var ICON_ZOOM_OUT = [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "M20 20l-3.5-3.5M8 11h6" }]];

  function capText(f) { return f.caption || "Untitled figure"; }
  function provText(f) {
    var s = "p." + (f.page || "?") + (f.source ? " \\u00B7 " + f.source : "");
    if (f.w && f.h) s += " \\u00B7 " + f.w + "\\u00D7" + f.h;
    return s;
  }

  /* ================= rendering ================= */
  function render() {
    w.classList.toggle("is-collapsed", M.state === "collapsed");
    if (M.state === "collapsed") { w.replaceChildren(); reportSize(); return; }
    if (M.state === "loading") { w.replaceChildren(skeleton()); reportSize(); return; }
    if (M.state === "error" || !M.items.length) { w.replaceChildren(errorBox()); reportSize(); return; }

    var items = M.items, single = items.length < 2;
    if (V.sel >= items.length) V.sel = 0;
    var cur = items[V.sel];

    var reader = el("div", "reader");
    reader.dataset.single = single ? "1" : "0";
    reader.appendChild(rail(items));
    var pane = el("div", "pane");
    if (cur.skipped) pane.appendChild(stubPane(cur));
    else figurePane(pane, cur);
    reader.appendChild(pane);

    var kids = [reader];
    // A skipped figure the user is not looking at still gets one calm line under the pane.
    if (!cur.skipped) {
      items.forEach(function (it) { if (it.skipped) kids.push(stubLine(it)); });
    }
    w.replaceChildren.apply(w, kids);
    reportSize();
  }

  function rail(items) {
    var r = el("div", "rail");
    r.setAttribute("role", "tablist");
    r.setAttribute("aria-label", "Figures");
    r.setAttribute("aria-orientation", "vertical");
    items.forEach(function (it, i) {
      var t = el("button", it.skipped ? "tab is-stub" : "tab");
      t.type = "button";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(i === V.sel));
      t.tabIndex = i === V.sel ? 0 : -1;
      t.dataset.i = String(i);
      t.appendChild(el("span", "n", it.index === null ? "?" : String(it.index)));
      if (it.skipped) {
        t.setAttribute("aria-label", "Figure " + it.index + " \\u2014 not extracted");
        t.appendChild(svgIcon(ICON_WARN, "i"));
      } else {
        t.setAttribute("aria-label", capText(it));
        var img = document.createElement("img");
        img.alt = "";
        img.src = it.url;
        t.appendChild(img);
      }
      r.appendChild(t);
    });
    return r;
  }

  function figurePane(pane, cur) {
    var plate = el("div", V.zoom ? "plate is-zoomed" : "plate");
    plate.id = "plate";
    plate.tabIndex = 0;
    plate.setAttribute("role", "button");
    plate.setAttribute("aria-label", V.zoom
      ? "Zoomed to 100 percent \\u2014 click to fit"
      : "Click to zoom to 100 percent");
    var pv = el("span", "pv");
    var img = document.createElement("img");
    img.alt = capText(cur);
    if (V.zoom && cur.w && cur.h) { img.width = cur.w; img.height = cur.h; }
    img.onload = function () {
      // Natural size is the only source for dimensions + the 100% zoom box: the tool
      // result carries no width/height (structuredContent is stripped).
      if (cur.w === img.naturalWidth && cur.h === img.naturalHeight) return;
      cur.w = img.naturalWidth;
      cur.h = img.naturalHeight;
      var prov = document.getElementById("prov");
      if (prov) prov.textContent = provText(cur);
      if (V.zoom) { img.width = cur.w; img.height = cur.h; }
      reportSize();
    };
    img.src = cur.url;
    pv.appendChild(img);
    plate.appendChild(pv);
    var chip = el("span", "zoomchip");
    chip.appendChild(svgIcon(V.zoom ? ICON_ZOOM_OUT : ICON_ZOOM_IN, "i"));
    chip.appendChild(document.createTextNode(V.zoom ? " Fit" : " 100%"));
    plate.appendChild(chip);
    pane.appendChild(plate);

    pane.appendChild(el("div", cur.caption ? "cap" : "cap is-empty", capText(cur)));
    var row = el("div", "provrow");
    var prov = el("span", "prov", provText(cur));
    prov.id = "prov";
    row.appendChild(prov);
    if (M.items.length > 1) {
      row.appendChild(el("span", "count", V.sel + 1 + " / " + M.items.length));
    }
    pane.appendChild(row);

    plate.addEventListener("click", function () { if (!pv.dataset.dragged) toggleZoom(); });
    plate.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleZoom(); }
    });
    if (V.zoom) enablePan(pv);
  }

  function stubPane(cur) {
    var s = el("div", "stubpane");
    s.appendChild(svgIcon(ICON_WARN, "i"));
    s.appendChild(el("b", null, "Figure " + cur.index + " not extracted"));
    s.appendChild(el("span", null, cur.skipped));
    return s;
  }
  function stubLine(it) {
    var d = el("div", "stub");
    d.appendChild(svgIcon(ICON_WARN, "i"));
    var span = el("span");
    span.appendChild(el("b", null, "Figure " + it.index));
    span.appendChild(document.createTextNode(" not extracted \\u2014 " + it.skipped));
    d.appendChild(span);
    return d;
  }
  function skeleton() {
    var reader = el("div", "reader");
    var r = el("div", "rail");
    for (var i = 0; i < 3; i++) r.appendChild(el("div", "sk sk-tab"));
    reader.appendChild(r);
    var pane = el("div", "pane");
    pane.appendChild(el("div", "sk sk-plate"));
    pane.appendChild(el("div", "sk sk-line"));
    pane.appendChild(el("div", "sk sk-line s"));
    reader.appendChild(pane);
    return reader;
  }
  function errorBox() {
    var e = el("div", "err");
    e.appendChild(svgIcon(ICON_WARN, "i"));
    e.appendChild(el("span", null, "Couldn\\u2019t load figures."));
    return e;
  }

  /* ================= interaction ================= */
  function setState(st) { M.state = st; render(); }
  function toggleZoom() {
    V.zoom = !V.zoom;
    render();
    var p = document.getElementById("plate");
    if (p) p.focus({ preventScroll: true });
  }
  function select(i, focus) {
    var n = M.items.length;
    if (!n) return;
    V.sel = (i + n) % n;
    V.zoom = false;
    render();
    if (focus) {
      var t = w.querySelector('.tab[data-i="' + V.sel + '"]');
      if (t) t.focus({ preventScroll: true });
    }
  }
  w.addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (t) select(+t.dataset.i, false);
  });
  w.addEventListener("keydown", function (e) {
    var t = e.target.closest(".tab");
    if (!t) return;
    var d = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1
      : (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 0;
    if (d) { e.preventDefault(); select(V.sel + d, true); }
  });
  // Zoomed view pans by drag; a drag must not read as a click that unzooms.
  function enablePan(view) {
    var down = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    view.addEventListener("pointerdown", function (e) {
      down = true; moved = false;
      sx = e.clientX; sy = e.clientY; sl = view.scrollLeft; st = view.scrollTop;
      view.setPointerCapture(e.pointerId);
      view.classList.add("is-dragging");
    });
    view.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      view.scrollLeft = sl - dx;
      view.scrollTop = st - dy;
    });
    view.addEventListener("pointerup", function () {
      down = false;
      view.classList.remove("is-dragging");
      view.dataset.dragged = moved ? "1" : "";
      setTimeout(function () { view.dataset.dragged = ""; }, 0);
    });
  }

  var lastH = 0;
  function reportSize() {
    var h = document.documentElement.scrollHeight;
    if (h === lastH) return;
    lastH = h;
    rpcNotify("ui/notifications/size-changed", { height: h, width: document.documentElement.scrollWidth });
  }
  new ResizeObserver(reportSize).observe(document.body);

  /* ================= boot ================= */
  render();
  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    // appInfo (not the client-info field name) — the host zod-validates this shape (spike #21)
    appInfo: { name: "calibre-figures", version: "__VERSION__" }
  }).then(function (r) {
    applyHostContext(r && r.hostContext);
    rpcNotify("ui/notifications/initialized", {});
    // No result after the handshake settles: a list call that never notified, or a host
    // that drops the notification — collapse rather than leave a skeleton spinning.
    setTimeout(function () {
      if (!sawResult && M.state === "loading") setState("collapsed");
    }, 15000);
  }).catch(function () { setState("error"); });
})();
</script>
</body>
</html>
`;
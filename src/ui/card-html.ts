// Book-card widget for calibre_get_book (issues #19/#22). Visuals are the approved
// mockup (assets/"Book Detail (standalone).html", bundler template — CSS/markup frozen,
// devbar + fixtures removed) with the fake layer replaced by MCP plumbing: appInfo
// handshake, data via structuredContent or a silent widget-initiated re-call (Desktop
// strips the tool-result notification), per-format Read → ui/open-link (viewer), Similar
// → ui/message with a silent tools/call fallback. Injection hygiene: every book field
// lands via textContent/createElement; comments are tag-stripped to plain paragraphs.
// The widget JS avoids template literals so this file's outer literal needs no escaping.

export const CARD_URI = "ui://calibre/book-card.html";

/** Render the book-card template. */
export function cardHtml(version: string): string {
  return TEMPLATE.replaceAll("__VERSION__", version);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>calibre-mcp book detail</title>
<style>
/* ============ tokens — shared with cover-carousel.html (frozen mockup) ============ */
:root{
  color-scheme: light dark;
  --bg:#faf7f2; --tx:#33302b; --tx-muted:#8a8378; --card:#ffffff;
  --line:rgba(60,50,40,.14); --accent:#c67139; --btn:#ffffff;
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
  /* book volume */
  --spine: light-dark(rgba(0,0,0,.16), rgba(0,0,0,.42));
  --crease: light-dark(rgba(255,255,255,.55), rgba(255,255,255,.14));
  --sheen: light-dark(rgba(255,255,255,.26), rgba(255,255,255,.05));
  --pages: light-dark(#f1ebe0, #46453f);
  --pages-line: light-dark(#d8d0c2, #2c2b28);
  --pagestack: 2px 0 0 var(--pages), 3.5px 0 0 var(--pages-line), 5.5px 0 0 var(--pages), 7px 0 0 var(--pages-line);
  /* generated cover */
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
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg); color:var(--tx);
  font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  padding:14px 0 0;
}
a{color:var(--accent)} a:hover{color:var(--tx)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}

/* ============ widget ============ */
.widget{max-width:640px; margin:0 auto; padding:0 18px}
.view{display:none}
.widget[data-state="loading"] .view-loading{display:block}
.widget[data-state="loaded"] .view-loaded{display:block}
.widget[data-state="notfound"] .view-notfound{display:flex}
.widget[data-state="error"] .view-error{display:flex}

/* layout: cover | meta */
.hero{display:flex; gap:22px; align-items:flex-start}
.coverwrap{flex:none; width:168px}
.cover{
  position:relative; display:block; width:168px; height:224px;
  border-radius:4px 12px 12px 4px; overflow:hidden;
  box-shadow:var(--pagestack), var(--shadow-lg);
}
.cover::before{
  content:""; position:absolute; inset:0; z-index:1; pointer-events:none; border-radius:inherit;
  background:
    linear-gradient(90deg, var(--spine) 0%, transparent 9%),
    linear-gradient(90deg, transparent 4.5%, var(--crease) 7%, transparent 11%),
    linear-gradient(168deg, var(--sheen) 0%, transparent 24%);
}
.ph{
  position:absolute; inset:0; display:flex; flex-direction:column;
  padding:16px 14px 12px;
  background:linear-gradient(160deg,
    oklch(var(--cov-l) var(--cov-c) var(--h)) 0%,
    oklch(var(--cov-l2) var(--cov-c2) var(--h2)) 100%);
  color:oklch(var(--cov-tx-l) var(--cov-tx-c) var(--h));
}
.ph::after{content:""; position:absolute; inset:8px; border-radius:8px;
  border:1px solid var(--cov-line); pointer-events:none}
.ph .mark{width:26px; height:26px; border-radius:50%; background:var(--cov-shine); margin-bottom:12px; flex:none}
.ph .pt{font-size:15px; line-height:1.28; font-weight:650; letter-spacing:.01em;
  display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden;
  overflow-wrap:anywhere; text-wrap:pretty}
.ph .pt.raw{font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:500; font-size:12.5px}
.ph .pa{margin-top:auto; font-size:11px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.cover img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:var(--card)}

/* meta column */
.meta{flex:1; min-width:0; padding-top:2px}
.title{font-size:19px; line-height:1.28; font-weight:700; letter-spacing:-.01em;
  margin:0 0 2px; text-wrap:pretty; overflow-wrap:anywhere}
.authors{font-size:13.5px; color:var(--tx-muted); margin:0 0 8px}
.authors b{color:var(--tx); font-weight:550}
.series{display:inline-flex; align-items:center; gap:6px; font-size:12px;
  color:var(--accent-deep); background:var(--accent-tint);
  padding:3px 10px; border-radius:999px; margin:0 0 10px}
.stars{display:inline-flex; gap:1.5px; vertical-align:-2px; margin-right:6px}
.stars svg{width:13px; height:13px; fill:var(--accent); stroke:none}
.stars svg.off{fill:var(--skel)}
/* fact rows */
.facts{display:grid; grid-template-columns:auto 1fr; gap:3px 14px;
  font-size:12.5px; margin:10px 0 0}
.facts dt{color:var(--tx-muted); white-space:nowrap}
.facts dd{margin:0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-variant-numeric:tabular-nums}
/* tags */
.tags{display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 0}
.tag{font-size:11.5px; padding:3px 10px; border-radius:999px;
  background:var(--sage-tint); color:var(--sage); font-weight:550}
/* actions */
.actions{display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0}
.act{display:inline-flex; align-items:center; gap:7px;
  font-size:12.5px; font-weight:600; padding:7px 16px; border-radius:999px}
.act svg{width:13px; height:13px; stroke:currentColor; stroke-width:2.75; fill:none;
  stroke-linecap:round; stroke-linejoin:round}
.act.primary{background:var(--accent); color:#fff}
.act.primary:hover{background:var(--accent-deep)}
.act.ghost{background:var(--btn); box-shadow:var(--shadow)}
.act.ghost:hover{background:var(--accent-tint); color:var(--accent)}
.fmt{font-size:10px; opacity:.8; font-weight:500; letter-spacing:.05em}
body[data-noread="1"] .act[data-read]{display:none}
body[data-nosimilar="1"] .act[data-similar]{display:none}
/* description */
.desc{margin:18px 0 0; border-top:1px solid var(--line); padding-top:14px}
.desc p{margin:0 0 8px; font-size:13.5px; line-height:1.6; color:var(--tx);
  text-wrap:pretty}
.desc.clamped .body{display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden}
.more{font-size:12.5px; color:var(--accent); font-weight:550; margin-top:4px}
.more:hover{color:var(--accent-deep)}
.desc[data-empty="1"]{display:none}
/* identifiers footer */
.ids{display:flex; flex-wrap:wrap; gap:5px 14px; margin:14px 0 0;
  font-size:11px; color:var(--tx-muted); font-variant-numeric:tabular-nums}
.ids span b{font-weight:550; color:var(--tx-muted); text-transform:uppercase; letter-spacing:.05em; font-size:9.5px; margin-right:4px}

/* ============ skeleton ============ */
.view-loading .hero .cover-s{width:168px; height:224px; border-radius:4px 12px 12px 4px;
  background:var(--skel); position:relative; overflow:hidden; flex:none}
.sl{height:11px; border-radius:6px; background:var(--skel)}
.cover-s::after,.sl::after{content:""; position:absolute; inset:0;
  background:linear-gradient(100deg, transparent 30%, var(--skel-hi) 50%, transparent 70%);
  transform:translateX(-100%); animation:shimmer 1.4s infinite}
.sl{position:relative; overflow:hidden}
@keyframes shimmer{to{transform:translateX(100%)}}

/* ============ flat states ============ */
.flat{align-items:center; gap:10px; padding:26px 0; font-size:13px; color:var(--tx-muted)}
.flat b{color:var(--tx); font-weight:550}
.flat .q{font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;
  background:var(--skel); padding:2px 7px; border-radius:6px}
.retry{padding:4px 13px; border-radius:999px; font-size:12.5px;
  background:var(--accent-tint); color:var(--accent); font-weight:550}
.retry:hover{background:var(--accent); color:#fff}

@media (max-width:520px){
  .hero{gap:16px}
  .coverwrap{width:118px}
  .cover{width:118px; height:157px}
  .facts dd{white-space:normal}
}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important; transition:none!important}
}
</style>
</head>
<body>

<div class="widget" id="w" data-state="loading">
  <div class="view view-loading" aria-hidden="true">
    <div class="hero">
      <div class="cover-s"></div>
      <div style="flex:1;padding-top:4px">
        <div class="sl" style="width:75%;height:15px"></div>
        <div class="sl" style="width:45%;margin-top:9px"></div>
        <div class="sl" style="width:60%;margin-top:22px"></div>
        <div class="sl" style="width:52%;margin-top:7px"></div>
        <div class="sl" style="width:57%;margin-top:7px"></div>
        <div class="sl" style="width:35%;margin-top:24px;height:26px;border-radius:999px"></div>
      </div>
    </div>
  </div>

  <div class="view view-loaded">
    <div class="hero">
      <div class="coverwrap"><span class="cover" id="cover"></span></div>
      <div class="meta">
        <h1 class="title" id="title"></h1>
        <p class="authors" id="authors"></p>
        <span class="series" id="series" hidden></span>
        <dl class="facts" id="facts"></dl>
        <div class="tags" id="tags"></div>
        <div class="actions" id="actions"></div>
      </div>
    </div>
    <div class="desc clamped" id="desc">
      <div class="body" id="descBody"></div>
      <button class="more" id="more" type="button">Show more</button>
    </div>
    <div class="ids" id="ids"></div>
  </div>

  <div class="view view-notfound flat">
    <span><b>Book not found</b>&nbsp; <span class="q" id="nfId"></span></span>
  </div>

  <div class="view view-error flat">
    <span>Couldn&rsquo;t load book</span>
    <button class="retry" id="retry" type="button">Retry</button>
  </div>
</div>

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

  var w = document.getElementById("w");
  var ready = false, afterReady = [], toolArgs = null, sawResult = false;
  var openLinksOk = true, data = null; // {book, serverUrl, libraryId}

  function whenReady(fn) { if (ready) fn(); else afterReady.push(fn); }

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

  /* ================= data flow =================
     Spec hosts keep structuredContent on the tool-result notification; Claude Desktop
     strips it, so re-call calibre_get_book from the widget (silent, cheap /ajax read). */
  function requestedId() {
    return toolArgs && (toolArgs.id !== undefined ? toolArgs.id : toolArgs.bookId);
  }

  function onToolResult(res) {
    sawResult = true;
    if (res && res.isError) { failFrom(res); return; }
    var sc = res && res.structuredContent;
    if (sc && sc.book) { gotData(sc); return; }
    pullData();
  }

  function failFrom(res) {
    var txt = "";
    try { txt = (res.content || []).map(function (c) { return c.text || ""; }).join(" "); } catch (e) { /* shape */ }
    if (/No book with/i.test(txt)) {
      var id = requestedId();
      document.getElementById("nfId").textContent = "id: " + (id === undefined ? "?" : id);
      setState("notfound");
    } else {
      setState("error");
    }
  }

  function pullData() {
    whenReady(function () {
      var id = requestedId();
      if (id === undefined || id === null) { setState("error"); return; }
      var args = { id: id };
      if (toolArgs && toolArgs.library) args.library = toolArgs.library;
      rpcRequest("tools/call", { name: "calibre_get_book", arguments: args })
        .then(function (r) {
          var sc = r && r.structuredContent;
          if (sc && sc.book) gotData(sc);
          else if (r && r.isError) failFrom(r);
          else setState("error");
        })
        .catch(function () { setState("error"); });
    });
  }

  function gotData(sc) {
    data = sc;
    setState("loaded");
  }

  /* ================= helpers ================= */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  function isRaw(t) { return /[\\/_]|\\.(pdf|dvi|djvu|epub|fb2)$/i.test(t) || /^scan|^\\d{6,}/i.test(t); }
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
    if (cls) s.setAttribute("class", cls);
    pathData.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, d[0]);
      Object.keys(d[1]).forEach(function (k) { p.setAttribute(k, d[1][k]); });
      s.appendChild(p);
    });
    return s;
  }
  var ICON_BOOK = [["path", { d: "M2 4h7a3 3 0 013 3v13a3 3 0 00-3-3H2zM22 4h-7a3 3 0 00-3 3v13a3 3 0 013-3h7z" }]];
  var ICON_SEARCH = [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "M21 21l-4.35-4.35" }]];
  var STAR = "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z";
  var LANG = { eng: "English", rus: "Russian", ukr: "Ukrainian" };

  // Comments arrive as Calibre HTML — flatten to plain-text paragraphs before textContent.
  function paragraphs(html) {
    var s = String(html || "");
    s = s.replace(/<style[^>]*>[^]*?<\\/style>/gi, " ");
    s = s.replace(/<\\/(p|div|li|h[1-6])>/gi, "\\n").replace(/<br[^>]*>/gi, "\\n");
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
         .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
    return s.split("\\n").map(function (p) { return p.replace(/\\s+/g, " ").trim(); })
      .filter(function (p) { return p.length > 0; });
  }
  function base() { return String(data.serverUrl || "").replace(/\\/+$/, ""); }
  function thumbUrl(id) {
    if (!data.serverUrl || !data.libraryId) return data.book.coverUrl || "";
    return base() + "/get/thumb/" + id + "/" + encodeURIComponent(data.libraryId) + "?sz=336x448";
  }
  function readUrl(id, fmt) {
    return base() + "/#book_id=" + id + "&fmt=" + encodeURIComponent(fmt) +
      "&library_id=" + encodeURIComponent(data.libraryId || "") + "&mode=read_book";
  }

  /* ================= MCP actions ================= */
  function onRead(fmt) {
    rpcRequest("ui/open-link", { url: readUrl(data.book.id, fmt) })
      .then(function (r) { if (r && r.isError) document.body.dataset.noread = "1"; })
      .catch(function () { document.body.dataset.noread = "1"; });
  }
  // Similar: ask the host to send a user message (keeps the model in the loop → a fresh
  // board renders); hosts without ui/message get a silent semantic tools/call fallback.
  function onSimilar() {
    var b = data.book;
    var q = "Find books similar to \\"" + (b.title || "book " + b.id) + "\\"" +
      ((b.authors || []).length ? " by " + b.authors.join(", ") : "");
    rpcRequest("ui/message", { role: "user", content: [{ type: "text", text: q }] })
      .then(function (r) { if (r && r.isError) similarFallback(b); })
      .catch(function () { similarFallback(b); });
  }
  function similarFallback(b) {
    rpcRequest("tools/call", {
      name: "calibre_semantic_search",
      arguments: { query: (b.title || "") + " " + (b.authors || []).join(" "), scope: "library" },
    }).catch(function () { document.body.dataset.nosimilar = "1"; });
  }

  var lastH = 0;
  function reportSize() {
    var h = document.documentElement.scrollHeight;
    if (h === lastH) return;
    lastH = h;
    rpcNotify("ui/notifications/size-changed", { height: h, width: document.documentElement.scrollWidth });
  }
  new ResizeObserver(reportSize).observe(document.body);

  /* ================= rendering (createElement + textContent only) ================= */
  function stars(r5) {
    var wrap = el("span", "stars");
    for (var i = 1; i <= 5; i++) {
      wrap.appendChild(svgIcon([["path", { d: STAR }]], i <= Math.round(r5) ? "" : "off"));
    }
    var out = document.createDocumentFragment();
    out.appendChild(wrap);
    out.appendChild(document.createTextNode(r5.toFixed(1)));
    return out;
  }
  function factRow(dl, label, value) {
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.appendChild(value);
    dl.appendChild(dd);
  }

  function render() {
    var b = data.book;
    var title = String(b.title || "book " + b.id);
    var authors = (b.authors || []).join(", ");
    var h = hash(title) % 360, h2 = (h + 38) % 360, raw = isRaw(title);

    var cover = document.getElementById("cover");
    cover.style.setProperty("--h", String(h));
    cover.style.setProperty("--h2", String(h2));
    var ph = el("span", "ph");
    ph.appendChild(el("span", "mark"));
    ph.appendChild(el("span", raw ? "pt raw" : "pt", title));
    ph.appendChild(el("span", "pa", authors));
    cover.replaceChildren(ph);
    var src = thumbUrl(b.id);
    if (src) {
      var img = document.createElement("img");
      img.alt = "";
      img.onerror = function () { img.remove(); }; // no/broken cover → generated placeholder
      img.src = src;
      cover.appendChild(img);
    }

    document.getElementById("title").textContent = title;
    var au = document.getElementById("authors");
    au.replaceChildren();
    if (authors) {
      au.appendChild(document.createTextNode("by "));
      au.appendChild(el("b", null, authors));
    } else {
      au.appendChild(el("i", null, "Unknown author"));
    }

    var se = document.getElementById("series");
    if (b.series) {
      se.hidden = false;
      se.textContent = b.series + (b.seriesIndex != null ? " \\u00B7 #" + b.seriesIndex : "");
    } else se.hidden = true;

    /* facts — only rows that exist */
    var dl = document.getElementById("facts");
    dl.replaceChildren();
    var r5 = typeof b.rating === "number" && b.rating > 0 ? (b.rating > 5 ? b.rating / 2 : b.rating) : 0;
    if (r5) factRow(dl, "Rating", stars(r5));
    var year = b.pubdate ? String(b.pubdate).slice(0, 4) : "";
    if (year) factRow(dl, "Published", year + (b.publisher ? " \\u00B7 " + b.publisher : ""));
    else if (b.publisher) factRow(dl, "Publisher", b.publisher);
    var langs = (b.languages || []).map(function (l) { return LANG[l] || l; }).join(", ");
    if (langs) factRow(dl, "Language", langs);
    if (b.pages) factRow(dl, "Pages", String(b.pages));
    var formats = (b.formats || []).map(function (f) { return String(f).toUpperCase(); });
    factRow(dl, "Formats", formats.join(" \\u00B7 ") || "\\u2014");

    var tags = document.getElementById("tags");
    tags.replaceChildren();
    (b.tags || []).forEach(function (t) { tags.appendChild(el("span", "tag", t)); });

    /* actions: Read per format + Similar */
    var actions = document.getElementById("actions");
    actions.replaceChildren();
    formats.forEach(function (fmt, i) {
      var btn = el("button", "act " + (i === 0 ? "primary" : "ghost"));
      btn.type = "button";
      btn.dataset.read = fmt;
      btn.appendChild(svgIcon(ICON_BOOK));
      btn.appendChild(document.createTextNode("Read "));
      btn.appendChild(el("span", "fmt", fmt));
      actions.appendChild(btn);
    });
    var sim = el("button", "act ghost");
    sim.type = "button";
    sim.dataset.similar = "1";
    sim.appendChild(svgIcon(ICON_SEARCH));
    sim.appendChild(document.createTextNode("Similar"));
    actions.appendChild(sim);
    if (!openLinksOk) document.body.dataset.noread = "1";

    /* description */
    var d = document.getElementById("desc");
    var paras = paragraphs(b.comments);
    d.dataset.empty = paras.length ? "0" : "1";
    var body = document.getElementById("descBody");
    body.replaceChildren();
    paras.forEach(function (p) { body.appendChild(el("p", null, p)); });
    d.classList.add("clamped");
    document.getElementById("more").textContent = "Show more";
    requestAnimationFrame(function () {
      document.getElementById("more").style.display =
        body.scrollHeight > body.clientHeight + 4 ? "" : "none";
      reportSize();
    });

    /* identifiers footer */
    var ids = document.getElementById("ids");
    ids.replaceChildren();
    var idSpan = el("span");
    idSpan.appendChild(el("b", null, "id"));
    idSpan.appendChild(document.createTextNode(String(b.id)));
    ids.appendChild(idSpan);
    var identifiers = b.identifiers || {};
    Object.keys(identifiers).forEach(function (k) {
      var s = el("span");
      s.appendChild(el("b", null, k));
      s.appendChild(document.createTextNode(String(identifiers[k])));
      ids.appendChild(s);
    });
  }

  function setState(st) {
    w.dataset.state = st;
    if (st === "loaded") render();
    reportSize();
  }

  /* interactions */
  document.getElementById("actions").addEventListener("click", function (e) {
    var r = e.target.closest("[data-read]");
    if (r) { onRead(r.dataset.read); return; }
    if (e.target.closest("[data-similar]")) onSimilar();
  });
  document.getElementById("more").addEventListener("click", function () {
    var d = document.getElementById("desc"), open = !d.classList.contains("clamped");
    d.classList.toggle("clamped");
    document.getElementById("more").textContent = open ? "Show more" : "Show less";
    reportSize();
  });
  document.getElementById("retry").addEventListener("click", function () {
    setState("loading");
    pullData();
  });

  /* ================= boot ================= */
  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    // appInfo (not the client-info field name) — the host zod-validates this shape (spike #21)
    appInfo: { name: "calibre-book-card", version: "__VERSION__" }
  }).then(function (r) {
    openLinksOk = !(r && r.hostCapabilities && r.hostCapabilities.openLinks === false);
    applyHostContext(r && r.hostContext);
    rpcNotify("ui/notifications/initialized", {});
    ready = true;
    afterReady.splice(0).forEach(function (fn) { fn(); });
    // Host never sent tool-result → pull once the args are known (get_book is cheap).
    setTimeout(function () {
      if (!sawResult && w.dataset.state === "loading") pullData();
    }, 2000);
  }).catch(function () { setState("error"); });
})();
</script>
</body>
</html>
`;

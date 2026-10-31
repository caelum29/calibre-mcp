/*@ Book-card JS: host handshake, data pull, action buttons with degrade layers.
   No template literals, no innerHTML, no console; every book field lands via textContent. @*/
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
  function isRaw(t) { return /[\/_]|\.(pdf|dvi|djvu|epub|fb2)$/i.test(t) || /^scan|^\d{6,}/i.test(t); }
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
  var ICON_GLOBE = [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" }]];
  var ICON_DL = [["path", { d: "M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" }]];
  var ICON_ZOOM = [["path", { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" }]];
  var STAR = "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z";
  var LANG = { eng: "English", rus: "Russian", ukr: "Ukrainian" };

  // Comments arrive as Calibre HTML — flatten to plain-text paragraphs before textContent.
  function paragraphs(html) {
    var s = String(html || "");
    s = s.replace(/<style[^>]*>[^]*?<\/style>/gi, " ");
    s = s.replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<br[^>]*>/gi, "\n");
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
         .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
    return s.split("\n").map(function (p) { return p.replace(/\s+/g, " ").trim(); })
      .filter(function (p) { return p.length > 0; });
  }
  function base() { return String(data.serverUrl || "").replace(/\/+$/, ""); }
  function libId() { return encodeURIComponent(data.libraryId || ""); }
  function bookTitle() { var b = data.book; return String(b.title || "book " + b.id); }
  function thumbUrl(id) {
    if (!data.serverUrl || !data.libraryId) return data.book.coverUrl || "";
    return base() + "/get/thumb/" + id + "/" + libId() + "?sz=336x448";
  }
  function readUrl(id, fmt) {
    return base() + "/#book_id=" + id + "&fmt=" + encodeURIComponent(fmt) +
      "&library_id=" + libId() + "&mode=read_book";
  }

  /* ================= MCP actions ================= */
  // Open in the local viewer — the never-degrading primary. It launches a native app via
  // a sanctioned tools/call, so it stays visible even when link/message channels fail.
  function onOpen(btn) {
    if (btn.dataset.busy === "1") return; // re-entry guard, no visual change
    btn.dataset.busy = "1";
    var lbl = btn.querySelector(".lbl");
    var note = document.getElementById("actNote");
    if (note) note.textContent = "";
    // The local open resolves in milliseconds; an instant label swap + disable reads as a
    // jitter (issue #70) — show the pending state only when the call outlives ~200ms.
    var t = setTimeout(function () {
      btn.classList.add("is-busy");
      if (lbl) lbl.textContent = "Opening\u2026";
    }, 200);
    // multi-format books carry the chosen format on the button; the tool defaults otherwise
    var args = { id: data.book.id, library: data.libraryId };
    if (btn.dataset.fmt) args.format = btn.dataset.fmt;
    rpcRequest("tools/call", { name: "calibre_open_book", arguments: args })
      .then(function (r) { if (r && r.isError) showActError(r); })
      .catch(function () { if (note) note.textContent = "Couldn\u2019t reach the server to open the book."; })
      .then(function () {
        clearTimeout(t);
        btn.classList.remove("is-busy");
        btn.dataset.busy = "";
        if (lbl) lbl.textContent = "Open";
      });
  }
  function showActError(r) {
    var note = document.getElementById("actNote");
    if (!note) return;
    var txt = "";
    try { txt = (r.content || []).map(function (c) { return c.text || ""; }).join(" ").trim(); } catch (e) { /* shape */ }
    note.textContent = txt || "Couldn\u2019t open the book.";
  }
  // A RESOLVED ui/open-link never degrades: Desktop replies with an isError result even when the
  // link opened / the user merely declined the dialog (probe 2026-07-21, issue #69), so the
  // reply body is meaningless as a capability signal. Only a method-not-found rejection
  // proves the host can't open links; the initialize openLinks capability stays primary.
  function linkFail(e) {
    if (e && e.code === -32601) document.body.dataset.noread = "1";
  }
  function onRead(fmt) {
    rpcRequest("ui/open-link", { url: readUrl(data.book.id, fmt) }).catch(linkFail);
  }
  function onDownload(fmt) {
    var url = base() + "/get/" + encodeURIComponent(fmt) + "/" + data.book.id + "/" + libId();
    rpcRequest("ui/open-link", { url: url }).catch(linkFail);
  }
  function onCoverZoom() {
    var url = base() + "/get/cover/" + data.book.id + "/" + libId();
    rpcRequest("ui/open-link", { url: url }).catch(linkFail);
  }
  // ui/message: a successful send resolves {} (probe, issue #72) — a resolve is delivery,
  // never a reason to hide the message affordances. Degrade only on method-not-found.
  function sendMessage(text) {
    return rpcRequest("ui/message", { role: "user", content: [{ type: "text", text: text }] })
      .catch(function (e) { if (e && e.code === -32601) document.body.dataset.nomsg = "1"; });
  }
  // Similar: ask the host to send a user message (keeps the model in the loop → a fresh
  // board renders); hosts without ui/message get a silent semantic tools/call fallback
  // BEFORE nomsg is ever set (its own data-nosimilar path handles a total failure).
  function onSimilar() {
    var b = data.book;
    var q = "Find books similar to \"" + (b.title || "book " + b.id) + "\"" +
      ((b.authors || []).length ? " by " + b.authors.join(", ") : "");
    rpcRequest("ui/message", { role: "user", content: [{ type: "text", text: q }] })
      .catch(function () { similarFallback(b); });
  }
  function similarFallback(b) {
    rpcRequest("tools/call", {
      name: "calibre_semantic_search",
      arguments: { query: (b.title || "") + " " + (b.authors || []).join(" "), scope: "library" },
    }).catch(function () { document.body.dataset.nosimilar = "1"; });
  }
  function onSearchInside() {
    var inp = document.getElementById("searchInput");
    var q = inp.value.trim();
    if (!q) { inp.focus(); return; }
    sendMessage("Search inside \"" + bookTitle() + "\" (book id " + data.book.id + ") for: " + q);
  }
  function onFix() {
    sendMessage("Recover metadata for book " + data.book.id + " (\"" + bookTitle() +
      "\") \u2014 preview first and wait for my confirmation before applying.");
  }
  function onDupes() {
    sendMessage("Find duplicates of book " + data.book.id + " (\"" + bookTitle() + "\")");
  }
  function onSummarize() {
    sendMessage("Summarize book " + data.book.id + " (\"" + bookTitle() +
      "\") from its table of contents and opening chapter.");
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
    var title = bookTitle();
    var authors = (b.authors || []).join(", ");
    var h = hash(title) % 360, h2 = (h + 38) % 360, raw = isRaw(title);

    /* cover — generated placeholder + real thumb + zoom hint chip */
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
    var zh = el("span", "zoomhint");
    zh.appendChild(svgIcon(ICON_ZOOM, "i"));
    zh.appendChild(document.createTextNode(" Full size"));
    cover.appendChild(zh);

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
      se.textContent = b.series + (b.seriesIndex != null ? " \u00B7 #" + b.seriesIndex : "");
    } else se.hidden = true;

    /* facts — only rows that exist */
    var dl = document.getElementById("facts");
    dl.replaceChildren();
    var r5 = typeof b.rating === "number" && b.rating > 0 ? (b.rating > 5 ? b.rating / 2 : b.rating) : 0;
    if (r5) factRow(dl, "Rating", stars(r5));
    var year = b.pubdate ? String(b.pubdate).slice(0, 4) : "";
    if (year) factRow(dl, "Published", year + (b.publisher ? " \u00B7 " + b.publisher : ""));
    else if (b.publisher) factRow(dl, "Publisher", b.publisher);
    var langs = (b.languages || []).map(function (l) { return LANG[l] || l; }).join(", ");
    if (langs) factRow(dl, "Language", langs);
    if (b.pages) factRow(dl, "Pages", String(b.pages));
    var formats = (b.formats || []).map(function (f) { return String(f).toUpperCase(); });
    factRow(dl, "Formats", formats.join(" \u00B7 ") || "\u2014");

    var tags = document.getElementById("tags");
    tags.replaceChildren();
    (b.tags || []).forEach(function (t) { tags.appendChild(el("span", "tag", t)); });

    /* actions: Open primary (never hides), Similar ghost, then per-format Read/⬇ pairs.
       Multi-format books get one Open per format — otherwise only formats[0] ever opens. */
    var actions = document.getElementById("actions");
    actions.replaceChildren();
    (formats.length > 1 ? formats : [""]).forEach(function (fmt, i) {
      var open = el("button", i === 0 ? "act primary" : "act ghost");
      open.type = "button";
      open.dataset.open = "1";
      if (fmt) open.dataset.fmt = fmt;
      open.appendChild(svgIcon(ICON_BOOK, "i"));
      open.appendChild(el("span", "lbl", "Open"));
      if (fmt) open.appendChild(el("span", "fmt", fmt));
      actions.appendChild(open);
    });
    var sim = el("button", "act ghost");
    sim.type = "button";
    sim.dataset.similar = "1";
    sim.dataset.need = "msg";
    sim.appendChild(svgIcon(ICON_SEARCH, "i"));
    sim.appendChild(document.createTextNode("Similar"));
    actions.appendChild(sim);
    var pairs = el("span", "pairs");
    pairs.dataset.need = "read";
    formats.forEach(function (fmt) {
      var pair = el("span", "pair");
      var pread = el("button", "pread");
      pread.type = "button";
      pread.dataset.read = fmt;
      pread.appendChild(svgIcon(ICON_GLOBE, "i"));
      pread.appendChild(document.createTextNode("Read "));
      pread.appendChild(el("span", "fmt", fmt));
      var pdl = el("button", "pdl");
      pdl.type = "button";
      pdl.dataset.dl = fmt;
      pdl.setAttribute("aria-label", "Download " + fmt);
      pdl.appendChild(svgIcon(ICON_DL, "i"));
      pair.appendChild(pread);
      pair.appendChild(pdl);
      pairs.appendChild(pair);
    });
    actions.appendChild(pairs);
    actions.appendChild(el("span", "actnote")).id = "actNote";
    if (!openLinksOk) document.body.dataset.noread = "1";
    document.getElementById("coverBtn").disabled = document.body.dataset.noread === "1";

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

  /* interactions — one delegated listener over the widget (data-* + closest) */
  w.addEventListener("click", function (e) {
    var openBtn = e.target.closest("[data-open]");
    if (openBtn) { onOpen(openBtn); return; }
    if (e.target.closest("[data-zoom]")) { onCoverZoom(); return; }
    var r = e.target.closest("[data-read]");
    if (r) { onRead(r.dataset.read); return; }
    var dl = e.target.closest("[data-dl]");
    if (dl) { onDownload(dl.dataset.dl); return; }
    if (e.target.closest("[data-similar]")) { onSimilar(); return; }
    if (e.target.closest("[data-fix]")) { onFix(); return; }
    if (e.target.closest("[data-dupes]")) { onDupes(); return; }
    if (e.target.closest("[data-sum]")) { onSummarize(); return; }
  });
  document.getElementById("searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    onSearchInside();
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
    var caps = r && r.hostCapabilities;
    openLinksOk = !(caps && caps.openLinks === false);
    // Capability-declared hosts that omit ui/message get the msg affordances hidden up
    // front — the reliable signal (Desktop advertises message:{text:{}}, probe #72).
    if (caps && !caps.message) document.body.dataset.nomsg = "1";
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

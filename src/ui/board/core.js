/*@ Board core JS — MCP plumbing + shared render/action helpers. Each variant file supplies
   renderShelf/renderFlow (etc.) and its interactions; declarations hoist, so the core may call them.
   A fragment of the IIFE in board.html: no template literals, no innerHTML, no console. @*/
  var TOOL = "__TOOL__";

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

  // The cache keys on (tool, query, library, filter) — echo the search's own library and
  // bundle filter so a same-query search elsewhere can't take over this board (#215).
  function boardDataArgs() {
    var args = { tool: TOOL };
    if (toolArgs && typeof toolArgs.query === "string") args.query = toolArgs.query;
    if (toolArgs && typeof toolArgs.library === "string") args.library = toolArgs.library;
    if (toolArgs && typeof toolArgs.filter === "string") args.filter = toolArgs.filter;
    return args;
  }

  function pullData(isRetryAfterRerun) {
    whenReady(function () {
      var args = boardDataArgs();
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
      var args = boardDataArgs();
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
    var base = String(payload.serverUrl || "").replace(/\/+$/, "");
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

  // Cover click → ui/message ("Show me book …") so the host renders the book card as a new
  // chat turn (#130). A widget-initiated tools/call result never reaches the chat in Desktop,
  // so that path stays only as the fallback for hosts without ui/message.
  function onCardClick(bookId) {
    if (document.body.dataset.nomsg === "1") {
      rpcRequest("tools/call", { name: "calibre_get_book", arguments: { id: bookId } })
        .then(clearOpening)
        .catch(clearOpening);
      return;
    }
    var b = bookById(bookId);
    var title = String((b && b.title) || "book " + bookId);
    sendMessage('Show me book ' + bookId + ' ("' + title + '")');
    clearOpening();
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
  function isRaw(t) { return /[\/_]|\.(pdf|dvi|djvu|epub|fb2)$/i.test(t) || /^scan|^\d{6,}/i.test(t); }

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
    cover.appendChild(el("span", "opening", "Opening\u2026"));
    return cover;
  }

  // Shared card selection: reset siblings, mark this one opening, ask the host to show the book.
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

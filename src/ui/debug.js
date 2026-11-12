/*@
   Probe instrumentation for the widget iframes (issues #69/#72). Injected into every
   widget template ONLY when CALIBRE_MCP_WIDGET_DEBUG is truthy — production builds get
   an empty string in its place. Shows every JSON-RPC settle (the raw host reply to
   ui/open-link / ui/message) in an on-widget <pre> AND mirrors each line to the server
   via the debug-only calibre_widget_log tool (stderr — selecting text in a Desktop
   iframe is flaky, the log file is the durable capture).
   Same hygiene rules as the widgets: no console, no innerHTML, no template literals.

   Wraps the widget's rpcRequest (must already be defined at the injection point) and
   appends a fixed log pane. The wrapper logs `-> id method params` on send and
   `<- id ok|ERR payload` on settle, plus a DOM snapshot 500ms after ui/open-link and
   ui/message settle — that snapshot is the #69 evidence (does the host re-render nuke
   the clicked button?).

   The #82 data-URI/CSP probe that used to live here is gone: the question is answered
   (data: images pass CSP, widget tools/call returns intact ImageContent) and it cost an
   extra calibre_get_figures round-trip plus an overlay in every dev bundle.

   The CSP/image probe at the end logs the host's effective CSP (meta tag or the
   securitypolicyviolation report), every widget <img> load/fail, and a one-shot set of
   img-src variants (same origin, swapped localhost/127.0.0.1, public https, data:) — the
   evidence for why the Code tab host drops Content Server covers that Desktop Chat shows.
@*/
  /* ================= probe debug (CALIBRE_MCP_WIDGET_DEBUG, issues #69/#72) ================= */
  // Collapsed by default to a corner chip, so the overlay never hides the widget it probes (#537).
  var dbgBox = document.createElement("div");
  dbgBox.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;pointer-events:none;" +
    "display:flex;flex-direction:column;align-items:flex-end";
  var dbgBtn = document.createElement("button");
  dbgBtn.type = "button";
  dbgBtn.style.cssText = "pointer-events:auto;margin:0 4px 4px 0;padding:1px 7px;border-radius:6px;" +
    "font:10px/1.4 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.72);color:#9f9;cursor:pointer";
  var dbgPre = document.createElement("pre");
  dbgPre.id = "dbgLog";
  dbgPre.style.cssText = "pointer-events:auto;align-self:stretch;margin:0;display:none;" +
    "padding:6px 8px;max-height:40vh;overflow:auto;font:10px/1.4 ui-monospace,Menlo,monospace;" +
    "background:rgba(0,0,0,.82);color:#9f9;user-select:text;white-space:pre-wrap;overflow-wrap:anywhere";
  var dbgOpen = false, dbgCount = 0;
  function dbgLabel() { dbgBtn.textContent = "dbg " + dbgCount + (dbgOpen ? " ▾" : " ▸"); }
  dbgBtn.addEventListener("click", function () {
    dbgOpen = !dbgOpen;
    dbgPre.style.display = dbgOpen ? "block" : "none";
    dbgLabel();
  });
  dbgLabel();
  dbgBox.appendChild(dbgBtn);
  dbgBox.appendChild(dbgPre);
  document.body.appendChild(dbgBox);
  function dbgJson(v) {
    try { return String(JSON.stringify(v)).slice(0, 4000); } catch (e) { return String(v); }
  }
  function dbgLine(s) {
    dbgPre.appendChild(document.createTextNode(s + "\n"));
    dbgPre.scrollTop = dbgPre.scrollHeight;
    dbgCount++;
    dbgLabel();
    // Mirror to the server log; must never recurse or break the widget.
    try {
      dbgRawRequest("tools/call", { name: "calibre_widget_log", arguments: { line: s } })
        .catch(function () {});
    } catch (e) { /* logging is best-effort */ }
  }
  function dbgSnapshot(method) {
    if (method !== "ui/open-link" && method !== "ui/message") return;
    setTimeout(function () {
      dbgLine("dom+500ms after " + method +
        " dataset=" + dbgJson(document.body.dataset) +
        " buttons=" + document.querySelectorAll("button").length);
    }, 500);
  }
  var dbgRawRequest = rpcRequest;
  rpcRequest = function (method, params) {
    if (method === "tools/call" && params && params.name === "calibre_widget_log") {
      return dbgRawRequest(method, params);
    }
    var reqId = nextId; // dbgRawRequest consumes this id next
    dbgLine("-> " + reqId + " " + method + " " + dbgJson(params));
    return dbgRawRequest(method, params).then(
      function (r) { dbgLine("<- " + reqId + " ok " + dbgJson(r)); dbgSnapshot(method); return r; },
      function (e) { dbgLine("<- " + reqId + " ERR " + dbgJson(e)); dbgSnapshot(method); throw e; }
    );
  };

  // The shape of the tool-result notification as the host delivers it (#537: the figures
  // viewer loses captions, so the host's content[] must differ from what the server sent).
  // Image data is reduced to its length; text to its first 160 chars.
  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0" || m.method !== "ui/notifications/tool-result") return;
    var p = m.params || {};
    var res = p.result || p;
    var blocks = (res && res.content) || [];
    dbgLine("<= tool-result paramsKeys=" + dbgJson(Object.keys(p)) +
      " resultKeys=" + dbgJson(Object.keys(res || {})) + " blocks=" + blocks.length);
    blocks.forEach(function (b, i) {
      b = b || {};
      var shape = { type: b.type, keys: Object.keys(b) };
      if (b.mimeType) shape.mimeType = b.mimeType;
      if (typeof b.data === "string") shape.dataLen = b.data.length;
      if (typeof b.text === "string") { shape.textLen = b.text.length; shape.text = b.text.slice(0, 160); }
      dbgLine("<=   [" + i + "] " + dbgJson(shape));
    });
  });

  /* ---- CSP / image-load probe: why covers render in Desktop Chat but not the Code tab ---- */
  // Host context: the effective CSP may come from a <meta> the host injects or from the
  // outer frame's header — securitypolicyviolation reports the full policy either way.
  (function () {
    var meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    dbgLine("ctx origin=" + location.origin + " secure=" + window.isSecureContext +
      " referrer=" + (document.referrer || "-"));
    dbgLine("csp meta=" + (meta ? meta.getAttribute("content") : "none"));
    var seenPolicy = {};
    document.addEventListener("securitypolicyviolation", function (e) {
      dbgLine("csp VIOLATION " + e.effectiveDirective + " blocked=" + e.blockedURI +
        " disposition=" + e.disposition);
      if (!seenPolicy[e.originalPolicy]) {
        seenPolicy[e.originalPolicy] = true;
        dbgLine("csp policy=" + e.originalPolicy);
      }
    });
    function watchImg(img, label) {
      var t0 = Date.now();
      img.addEventListener("load", function () {
        dbgLine("img OK " + label + " " + img.naturalWidth + "x" + img.naturalHeight +
          " " + (Date.now() - t0) + "ms " + img.src);
      });
      img.addEventListener("error", function () {
        dbgLine("img FAIL " + label + " " + (Date.now() - t0) + "ms " + img.src);
      });
    }
    // Variant probes, run once from the first real image's origin: which schemes/hosts
    // does this host's img-src actually allow?
    var probed = false;
    function probeFrom(src) {
      if (probed) return;
      var u;
      try { u = new URL(src); } catch (e) { return; }
      if (u.protocol === "data:") return;
      probed = true;
      var swapHost = u.hostname === "localhost" ? "127.0.0.1" : "localhost";
      var variants = [
        ["origin-favicon", u.origin + "/favicon.png"],
        ["swap-host", u.protocol + "//" + swapHost + (u.port ? ":" + u.port : "") + "/favicon.png"],
        ["public-https", "https://github.githubassets.com/favicons/favicon.png"],
        ["data-uri", "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"]
      ];
      variants.forEach(function (v) {
        var p = new Image();
        watchImg(p, "probe:" + v[0]);
        p.src = v[1];
      });
    }
    // Real widget images (covers, figures) are created later — observe them as they land.
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeName !== "IMG" || n.dataset.dbgWatched) return;
          n.dataset.dbgWatched = "1";
          watchImg(n, "widget");
          if (n.src) probeFrom(n.src);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  })();

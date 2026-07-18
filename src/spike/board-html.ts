// THROWAWAY SPIKE (#21) — vanilla-JS probe widget for the MCP Apps iframe.
// Never merge to main. All dynamic data arrives via ui/notifications/tool-result;
// the HTML itself is static. Widget JS avoids template literals so this file's
// outer template literal needs no escaping.

export const BOARD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: var(--color-background-primary, #ffffff);
    --fg: var(--color-text-primary, #111111);
    --border: var(--color-border-primary, #cccccc);
    --font: var(--font-sans, system-ui, sans-serif);
  }
  body { margin: 0; padding: 12px; background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 13px; }
  h3 { margin: 8px 0 4px; font-size: 13px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { border: 1px solid var(--border); border-radius: 6px; padding: 8px; width: 130px; }
  .card img { width: 110px; height: 146px; object-fit: cover; display: block; background: #8883; }
  .card .title { margin: 6px 0; height: 3em; overflow: hidden; cursor: pointer; text-decoration: underline; }
  .card button { width: 100%; }
  #dbg { margin-top: 12px; padding: 8px; border: 1px dashed var(--border); border-radius: 6px;
         font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all;
         max-height: 260px; overflow-y: auto; }
  .badge { font-size: 10px; opacity: 0.7; }
</style>
</head>
<body>
<div id="status"><b>calibre probe board</b> — waiting for ui/initialize…</div>
<div id="board"></div>
<div id="stats"></div>
<h3>Debug log</h3>
<div id="dbg"></div>
<script>
(function () {
  var pending = {};
  var nextId = 1;
  var dbg = document.getElementById("dbg");

  function logLine(s) {
    var line = document.createElement("div");
    line.textContent = new Date().toISOString().slice(11, 19) + " " + s;
    dbg.appendChild(line);
    dbg.scrollTop = dbg.scrollHeight;
  }
  function short(o) { try { return JSON.stringify(o).slice(0, 400); } catch (e) { return String(o); } }

  function rpcRequest(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
      logLine("→ req " + method);
    });
  }
  function rpcNotify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params }, "*");
  }
  function rpcRespond(id, result) {
    window.parent.postMessage({ jsonrpc: "2.0", id: id, result: result }, "*");
  }

  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.method === undefined) {
      var p = pending[m.id];
      if (p) { delete pending[m.id]; if (m.error) p.reject(m.error); else p.resolve(m.result); }
      return;
    }
    if (m.method === "ping" && m.id !== undefined) { rpcRespond(m.id, {}); return; }
    if (m.method === "ui/resource-teardown" && m.id !== undefined) { logLine("← teardown"); rpcRespond(m.id, {}); return; }
    if (m.method === "ui/notifications/tool-input") { logLine("← tool-input " + short(m.params)); return; }
    if (m.method === "ui/notifications/tool-result") {
      logLine("← tool-result keys=" + short(Object.keys(m.params || {})));
      render(m.params);
      return;
    }
    if (m.method === "ui/notifications/host-context-changed") { logLine("← host-context-changed " + short(m.params)); return; }
    logLine("← " + m.method + " " + short(m.params));
  });

  var host = null;
  var fallbackTried = false;

  // Claude Desktop strips structuredContent from the tool-result notification (learned
  // live). Probe the escape routes: widget-initiated tools/call, direct fetch(), plus
  // baked img/open-link tests so Q3-Q5 answer even if both routes fail.
  function fallbackProbe() {
    document.getElementById("status").innerHTML =
      "<b>calibre probe board</b> — structuredContent stripped; probing fallbacks…";
    var board = document.getElementById("board");

    logLine("→ tools/call calibre_probe_board (fallback: does the RESPONSE keep structuredContent?)");
    rpcRequest("tools/call", { name: "calibre_probe_board", arguments: {} })
      .then(function (r) {
        logLine("fallback tools/call keys=" + short(Object.keys(r || {})));
        if (r && r.structuredContent) {
          logLine("structuredContent SURVIVES widget-initiated tools/call — rendering board");
          render(r);
        } else {
          logLine("structuredContent stripped on this path too");
        }
      })
      .catch(function (e) { logLine("fallback tools/call ERROR: " + short(e)); });

    fetch("http://localhost:8080/ajax/library-info")
      .then(function (r) { return r.json(); })
      .then(function (j) { logLine("fetch localhost OK (connectDomains honored): " + short(j)); })
      .catch(function (e) { logLine("fetch localhost BLOCKED: " + String(e)); });

    var img = document.createElement("img");
    img.onload = function () { logLine("IMG OK [url fallback] 796 " + img.naturalWidth + "x" + img.naturalHeight); };
    img.onerror = function () { logLine("IMG ERROR [url fallback] 796"); };
    img.src = "http://localhost:8080/get/thumb/796/Programming_Books?sz=300x400";
    img.style.width = "110px";
    board.appendChild(img);

    var btn = document.createElement("button");
    btn.textContent = "Test ui/open-link (book 796)";
    btn.onclick = function () {
      logLine("→ ui/open-link (book 796)");
      rpcRequest("ui/open-link", { url: "http://localhost:8080/#book_id=796&library_id=Programming_Books&panel=book_details" })
        .then(function (r) { logLine("open-link OK: " + short(r)); })
        .catch(function (e) { logLine("open-link ERROR: " + short(e)); });
    };
    board.appendChild(btn);

    var btn2 = document.createElement("button");
    btn2.textContent = "Test tools/call calibre_get_book 796";
    btn2.onclick = function () {
      logLine("→ tools/call calibre_get_book id=796");
      rpcRequest("tools/call", { name: "calibre_get_book", arguments: { id: 796 } })
        .then(function (r) { logLine("get_book OK keys=" + short(Object.keys(r || {})) + " " + short(r).slice(0, 250)); })
        .catch(function (e) { logLine("get_book ERROR: " + short(e)); });
    };
    board.appendChild(btn2);
  }

  function render(params) {
    // Hedge on the notification shape: result may be the CallToolResult itself or nested.
    var res = params && (params.result || params);
    var sc = res && res.structuredContent;
    if (!sc || !sc.books) {
      logLine("no structuredContent.books — raw: " + short(res));
      if (!fallbackTried) { fallbackTried = true; fallbackProbe(); }
      return;
    }
    document.getElementById("status").innerHTML = "<b>calibre probe board</b> — lib: " + sc.libId;

    var board = document.getElementById("board");
    board.innerHTML = "";
    ["url", "data"].forEach(function (mode) {
      var h = document.createElement("h3");
      h.textContent = mode === "url"
        ? "A: <img> from localhost:8080 (CSP resourceDomains test)"
        : "B: <img> from base64 data: URI (default-CSP test)";
      board.appendChild(h);
      var row = document.createElement("div");
      row.className = "row";
      sc.books.forEach(function (b) {
        var card = document.createElement("div");
        card.className = "card";
        var img = document.createElement("img");
        img.onload = function () { logLine("IMG OK    [" + mode + "] id=" + b.id + " " + img.naturalWidth + "x" + img.naturalHeight); };
        img.onerror = function () { logLine("IMG ERROR [" + mode + "] id=" + b.id); };
        img.src = mode === "url" ? b.thumbUrl : b.thumbData;
        card.appendChild(img);
        var t = document.createElement("div");
        t.className = "title";
        t.textContent = b.title;
        t.title = "click → tools/call calibre_get_book";
        t.onclick = function () {
          logLine("→ tools/call calibre_get_book id=" + b.id);
          rpcRequest("tools/call", { name: "calibre_get_book", arguments: { id: b.id } })
            .then(function (r) { logLine("tools/call OK: " + short(r).slice(0, 250)); })
            .catch(function (e) { logLine("tools/call ERROR: " + short(e)); });
        };
        card.appendChild(t);
        var btn = document.createElement("button");
        var openOk = !host || !host.hostCapabilities || host.hostCapabilities.openLinks !== false;
        btn.textContent = openOk ? "Read" : "Read (host: no openLinks)";
        btn.onclick = function () {
          logLine("→ ui/open-link " + b.readUrl);
          rpcRequest("ui/open-link", { url: b.readUrl })
            .then(function (r) { logLine("open-link OK: " + short(r)); })
            .catch(function (e) { logLine("open-link ERROR: " + short(e)); });
        };
        card.appendChild(btn);
        var badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = "id " + b.id + " · " + Math.round(b.thumbBytes / 102.4) / 10 + "KB";
        card.appendChild(badge);
        row.appendChild(card);
      });
      board.appendChild(row);
    });

    if (sc.payloadStats) {
      document.getElementById("stats").innerHTML =
        "<h3>Payload stats (" + sc.serverUrl + ")</h3><pre>" + JSON.stringify(sc.payloadStats, null, 2) + "</pre>";
    }
  }

  // REQUIRED for flexible-height containers: report our size to the host.
  var lastH = 0;
  new ResizeObserver(function () {
    var h = document.documentElement.scrollHeight;
    if (h !== lastH) { lastH = h; rpcNotify("ui/notifications/size-changed", { height: h, width: document.documentElement.scrollWidth }); }
  }).observe(document.body);

  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    // NOT clientInfo — host zod-validates params.appInfo {name, version} (learned live)
    appInfo: { name: "calibre-probe-board", version: "0.0.0" },
  }).then(function (r) {
    host = r;
    logLine("ui/initialize OK");
    logLine("hostCapabilities=" + short(r && r.hostCapabilities));
    logLine("hostContext=" + short(r && r.hostContext));
    document.getElementById("status").innerHTML = "<b>calibre probe board</b> — initialized, waiting for tool-result…";
    rpcNotify("ui/notifications/initialized", {});
  }).catch(function (e) {
    logLine("ui/initialize FAILED: " + short(e));
  });
})();
</script>
</body>
</html>
`;

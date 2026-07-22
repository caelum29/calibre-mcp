// Probe instrumentation for the widget iframes (issues #69/#72, #82). Injected into both
// widget templates ONLY when CALIBRE_MCP_WIDGET_DEBUG is truthy — production builds get
// an empty string in its place. Shows every JSON-RPC settle (the raw host reply to
// ui/open-link / ui/message) in an on-widget <pre> AND mirrors each line to the server
// via the debug-only calibre_widget_log tool (stderr — selecting text in a Desktop
// iframe is flaky, the log file is the durable capture).
// Same hygiene rules as the widgets: no console, no innerHTML, no template literals.

/**
 * Wraps the widget's rpcRequest (must already be defined at the injection point) and
 * appends a fixed log pane. The wrapper logs `-> id method params` on send and
 * `<- id ok|ERR payload` on settle, plus a DOM snapshot 500ms after ui/open-link and
 * ui/message settle — that snapshot is the #69 evidence (does the host re-render nuke
 * the clicked button?).
 */
export const DEBUG_JS = `  /* ================= probe debug (CALIBRE_MCP_WIDGET_DEBUG, issues #69/#72) ================= */
  var dbgPre = document.createElement("pre");
  dbgPre.id = "dbgLog";
  dbgPre.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;margin:0;" +
    "padding:6px 8px;max-height:40vh;overflow:auto;font:10px/1.4 ui-monospace,Menlo,monospace;" +
    "background:rgba(0,0,0,.82);color:#9f9;user-select:text;white-space:pre-wrap;overflow-wrap:anywhere";
  document.body.appendChild(dbgPre);
  function dbgJson(v) {
    try { return String(JSON.stringify(v)).slice(0, 4000); } catch (e) { return String(v); }
  }
  function dbgLine(s) {
    dbgPre.appendChild(document.createTextNode(s + "\\n"));
    dbgPre.scrollTop = dbgPre.scrollHeight;
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
  /* ================= data-URI CSP probe (issue #82) ================= */
  // Answers: does ext-apps CSP allow data: images in the widget iframe, and does a
  // widget-side tools/call to calibre_get_figures return usable ImageContent blocks?
  var p82 = document.createElement("div");
  p82.style.cssText = "position:fixed;right:0;top:0;z-index:9999;padding:4px 6px;max-width:45vw;" +
    "background:rgba(0,0,0,.82);color:#ff9;font:10px/1.4 ui-monospace,Menlo,monospace;" +
    "user-select:text;white-space:pre-wrap;overflow-wrap:anywhere";
  document.body.appendChild(p82);
  function p82Line(s) {
    p82.appendChild(document.createTextNode(s + "\\n"));
    dbgLine("[#82] " + s);
  }
  window.addEventListener("securitypolicyviolation", function (ev) {
    p82Line("CSP violation: " + ev.violatedDirective + " blocked " + String(ev.blockedURI).slice(0, 80));
  });
  function p82Img(label, src) {
    var img = document.createElement("img");
    img.style.cssText = "display:block;max-width:140px;max-height:100px;border:1px solid #ff9;margin-top:2px";
    img.onload = function () { p82Line(label + " LOADED " + img.naturalWidth + "x" + img.naturalHeight); };
    img.onerror = function () { p82Line(label + " ERROR (CSP block or bad src)"); };
    img.src = src;
    p82.appendChild(img);
  }
  // Part 1: hardcoded 1x1 PNG — the pure CSP verdict, no server round-trip involved.
  p82Img("inline-1x1", "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
  // Part 2: the real pattern — widget tools/call -> base64 -> img src. Card widget only
  // (needs a book id from tool-input); on the board it self-reports as skipped.
  var p82Tries = 0;
  function p82BookId() {
    try { return toolArgs && (toolArgs.id !== undefined ? toolArgs.id : toolArgs.bookId); } catch (e) { return undefined; }
  }
  (function p82Figure() {
    var id = p82BookId();
    if (id === undefined || id === null) {
      p82Tries++;
      if (p82Tries < 20) { setTimeout(p82Figure, 500); return; }
      p82Line("figure probe skipped: no book id (board widget or no tool-input)");
      return;
    }
    var p82Args = { id: id };
    try { if (toolArgs && toolArgs.library) p82Args.library = toolArgs.library; } catch (e) { /* board */ }
    dbgRawRequest("tools/call", { name: "calibre_get_figures", arguments: p82Args })
      .then(function (r) {
        if (r && r.isError) { p82Line("list figures isError — see dbg log"); return; }
        var entries = (r && r.structuredContent && r.structuredContent.entries) || [];
        if (!entries.length) { p82Line("book " + id + " has no figures — inline-1x1 verdict still stands"); return; }
        return dbgRawRequest("tools/call", {
          name: "calibre_get_figures",
          arguments: Object.assign({ indexes: [entries[0].index] }, p82Args),
        }).then(function (rf) {
          var blocks = (rf && rf.content) || [];
          var imgBlock = null;
          for (var i = 0; i < blocks.length; i++) {
            if (blocks[i].type === "image") { imgBlock = blocks[i]; break; }
          }
          if (!imgBlock) { p82Line("fetch returned NO image block — host strips images from widget tools/call?"); return; }
          p82Line("image block ok: " + imgBlock.mimeType + " b64len=" + imgBlock.data.length);
          p82Img("figure#" + entries[0].index, "data:" + imgBlock.mimeType + ";base64," + imgBlock.data);
        });
      })
      .catch(function (e) { p82Line("figure probe ERR " + dbgJson(e)); });
  })();
`;

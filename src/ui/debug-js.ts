// Probe instrumentation for the widget iframes (issues #69/#72). Injected into both
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
`;

/*@ JSON-RPC plumbing shared by the board, card and figures widgets (#271): request/notify/respond
   over postMessage, the pending-call table and the host theme hook. A fragment of each widget's
   IIFE; the per-widget message listener stays in the widget (its tool-input handling differs).
   Included before __DEBUG__, whose probe wraps rpcRequest. @*/
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

  // light/dark follows the host; no theme in the context hands control back to prefers-color-scheme
  function applyHostContext(ctx) {
    if (!ctx) return;
    var t = ctx.theme;
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
    else if (t) delete document.documentElement.dataset.theme;
  }

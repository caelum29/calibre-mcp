/*@ Board boot JS — render both skeletons first, then run the host handshake (IIFE fragment). @*/
  /* ================= boot: both skeletons first, then handshake ================= */
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

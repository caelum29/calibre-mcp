// Builds the McpServer and registers tools + resources. This is the ONLY layer that
// imports the MCP SDK (DESIGN §7) — tool logic, the calibre clients, and domain code
// stay SDK-free so the SDK can be swapped behind this seam. Transport lives in run-stdio.ts.

import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { Config } from "./config.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { CalibreClient } from "./calibre/client.js";
import { LibraryBusyTracker } from "./calibre/busy.js";
import { ContentServerClient } from "./calibre/content-server.js";
import { FullTextSearch } from "./calibre/fts.js";
import { Extractor } from "./calibre/extract.js";
import { FigureInventoryService } from "./calibre/figure-inventory.js";
import { TransformersEmbedder } from "./semantic/embedder.js";
import { TransformersReranker } from "./semantic/reranker.js";
import { SqliteIndexStore } from "./semantic/store/index.js";
import { computeSemanticStatus } from "./semantic/status.js";
import { parseBookResourceId, readBookResource } from "./resources/book.js";
import { allTools, assertWriteClassification } from "./tools/registry.js";
import { isListed, refuseWriteCall, sessionAnnotations } from "./tools/write-gate.js";
import { toolError } from "./tools/result.js";
import type { ToolContext } from "./tools/types.js";
import type { ToolDeps } from "./tools/deps.js";
import { OperationCancelledError } from "./domain/errors.js";
import { createProgressReporter } from "./progress.js";
import { BoardCache } from "./ui/board-cache.js";
import { boardHtml, BOARD_KEYWORD_URI, BOARD_SEMANTIC_URI } from "./ui/board-html.js";
import { cardHtml, CARD_URI } from "./ui/card-html.js";
import { figuresHtml, FIGURES_URI } from "./ui/figures-html.js";
import { log } from "./logging.js";
import { withCallLog } from "./call-log.js";
import { VERSION } from "./version.js";
import { defaultHint, errorCodeFor } from "./domain/error-codes.js";

// Structural stand-in for ext-apps' McpUiToolMeta — the root package entry's types break
// under NodeNext (ext-apps#704); only the /server entry resolves, and it doesn't re-export this.
interface UiToolMeta {
  resourceUri?: string;
  visibility?: Array<"model" | "app">;
}

// MCP Apps wiring (issues #19/#22) — always-attach per issue #24 (per-call suppression is
// not spec-legal): non-Apps hosts ignore _meta.ui entirely, so degradation stays text-only.
// calibre_board_data is the widget's data endpoint, hidden from the model where honored.
const UI_TOOL_META: Record<string, UiToolMeta> = {
  calibre_search: { resourceUri: BOARD_KEYWORD_URI },
  calibre_semantic_search: { resourceUri: BOARD_SEMANTIC_URI },
  calibre_get_book: { resourceUri: CARD_URI },
  calibre_get_figures: { resourceUri: FIGURES_URI },
  calibre_board_data: { visibility: ["app"] },
  calibre_open_book: { visibility: ["app"] },
};

export interface BuildServerOptions {
  /** Environment to read config from (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /**
   * Run the boot-time background probes — extraction-backend detection (spawns
   * ebook-convert / pdftotext / python3) and the Content Server reachability check (HTTP).
   * Default true; the tool-catalog generator turns them off so building the server for a
   * tools/list touches no subprocess, network or library.
   */
  probes?: boolean;
  /** Pre-loaded config (run-stdio loads it once for the log sink); overrides `env`. */
  config?: Config;
}

/** Build the MCP server: load config, wire deps, register every tool/resource, and disable write tools when the write gate is off. */
export function buildServer(options: BuildServerOptions = {}): McpServer {
  const config = options.config ?? loadRuntimeConfig(options.env);
  const figures = new FigureInventoryService(config);
  // One breaker shared by both Calibre paths: a stall seen on either fails both fast.
  const busy = new LibraryBusyTracker();
  const content = new ContentServerClient(config, busy);
  const extractor = new Extractor(config, figures); // figures dep = inline image markers (#84)
  const deps: ToolDeps = {
    config,
    content,
    calibre: new CalibreClient(config, busy),
    fts: new FullTextSearch(content),
    libraryBusy: busy,
    extractor,
    figures,
    embedder: new TransformersEmbedder(config), // lazy: no model load until first embed
    reranker: new TransformersReranker(config), // lazy: no model load until first rerank
    // lazy: no db file until first index op; the store's own owner guard covers #388/#414
    index: new SqliteIndexStore(config, log),
    boardCache: new BoardCache(), // cover-board widget re-pull cache (issue #22)
    log,
  };

  if (options.probes !== false) startBootProbes(deps, extractor);

  const server = new McpServer(
    { name: "calibre-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  // Tag later log lines with the client (Desktop vs Code vs …) — the same file is shared.
  // Also re-checked per call: a client that pipelines `initialized` before the initialize
  // reply lands would otherwise leave it unset.
  let clientTagged = false;
  const tagClient = (): void => {
    if (clientTagged) return;
    const c = server.server.getClientVersion();
    if (!c) return;
    clientTagged = true;
    log.setClient(c.name);
    log.info("client initialized", {
      client: c.name,
      clientVersion: c.version,
      serverVersion: VERSION,
      // the client's own log never prints the MCP revision it negotiated (#124)
      protocolVersion: server.server.getNegotiatedProtocolVersion(),
    });
  };
  server.server.oninitialized = tagClient;
  type Extra = ServerContext;
  // Every tool call runs inside one logged call context.
  const logged = (tool: string, args: unknown, extra: Extra, run: () => Promise<CallToolResult>) => {
    tagClient();
    // W3C trace context arrives unprefixed in params._meta (OTel MCP semconv, SEP-414).
    const traceparent = extra.mcpReq._meta?.traceparent;
    return withCallLog(
      log,
      { tool, args, rpcId: extra.mcpReq.id, ...(typeof traceparent === "string" ? { traceparent } : {}) },
      run,
    );
  };

  // Fail loud at boot if any non-read-only tool is unclassified (no write / localWrite).
  assertWriteClassification();

  // Register every descriptor; bridge the SDK-free ToolResult ⇄ CallToolResult. Handlers
  // already return-not-throw; the try/catch here is a defense-in-depth safety net (DESIGN §3).
  for (const t of allTools) {
    const toolConfig = {
      title: t.title,
      description: t.description,
      // v2 takes Standard Schemas, not raw Zod shapes: wrap the descriptor's shapes here (the
      // seam) so tool modules keep their SDK-agnostic raw shapes.
      inputSchema: z.object(t.inputSchema),
      outputSchema: t.outputSchema && z.object(t.outputSchema),
      annotations: sessionAnnotations(t, config.writeEnabled),
    };
    // ToolResult is structurally a CallToolResult minus the SDK's loose index signature;
    // cast once here (the seam) rather than weaken the shared ToolResult type.
    const handler = async (args: unknown, extra: Extra): Promise<CallToolResult> =>
      logged(t.name, args, extra, async () => {
        // The write gate per call (#435): refuse a Write call before its handler ever runs.
        const refused = refuseWriteCall(t, args, config.writeEnabled);
        if (refused) return refused as CallToolResult;
        try {
          return (await t.handler(args, deps, toolContext(extra))) as CallToolResult;
        } catch (err) {
          if (err instanceof OperationCancelledError) {
            // The client cancelled; the SDK drops this response anyway. Keep it a result.
            return toolError("cancelled", `${t.name} was cancelled.`) as CallToolResult;
          }
          const name = err instanceof Error ? err.name : "Error";
          const msg = err instanceof Error ? err.message : String(err);
          const code = errorCodeFor(err);
          const hint = defaultHint(code);
          log.error("tool threw", {
            name,
            msg,
            errorCode: code,
            ...(hint === undefined ? {} : { hint }),
            stack: err instanceof Error ? err.stack : undefined,
          });
          // Surface the error NAME + message to the model (issue #73): domain errors keep
          // their messages host-path-free by contract (domain/errors.ts), so this is safe
          // to show and gives the agent something actionable instead of a blind retry.
          return toolError(code, `internal error in ${t.name} — ${name}: ${msg}`) as CallToolResult;
        }
      });
    // UI-bearing tools go through registerAppTool (normalizes _meta.ui for older hosts);
    // everything else registers exactly as before.
    const ui = UI_TOOL_META[t.name];
    const reg = ui
      ? registerAppTool(server, t.name, { ...toolConfig, _meta: { ui } }, handler)
      : server.registerTool(t.name, toolConfig, handler);
    // Gate off: hide write tools that have no call writing nothing (#435, D-028).
    if (!isListed(t, config.writeEnabled)) reg.disable();
  }

  registerUiResources(server, config);

  // Probe capture for the widget iframes (issues #69/#72) — registered ONLY under
  // CALIBRE_MCP_WIDGET_DEBUG. The injected widget debug layer mirrors every RPC settle
  // here; stderr is the durable record (stdout stays sacred on stdio).
  if (config.widgetDebug) {
    registerAppTool(
      server,
      "calibre_widget_log",
      {
        title: "Widget probe log",
        description: "Debug-only sink for widget probe lines (CALIBRE_MCP_WIDGET_DEBUG).",
        inputSchema: z.object({ line: z.string().max(4000) }),
        annotations: { readOnlyHint: true },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ line }) => {
        log.info("widget-probe", line);
        return { content: [{ type: "text", text: "ok" }] };
      },
    );
    log.warn("widget debug ON — probe pane injected into widgets, calibre_widget_log registered");
  }

  // calibre://book/{libId}/{id} — the target of search/get_book resource_links. RESOURCE CONTRACT:
  // the read handler THROWS on failure (the SDK turns it into a protocol error), unlike tools.
  server.registerResource(
    "book",
    new ResourceTemplate("calibre://book/{libId}/{id}", { list: undefined }),
    { title: "Calibre book", description: "Full metadata for one book." },
    async (_uri, variables) => {
      // {libId} is the library ID; resolveLibraryId also accepts a display name and throws
      // UnknownLibraryError (valid ids named) for anything else. The id is checked before any request.
      const id = parseBookResourceId(variables.id);
      const libId = await deps.content.resolveLibraryId(decodeSegment(String(variables.libId)));
      const r = await readBookResource(deps.content, id, libId);
      return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] };
    },
  );

  const toolNames = allTools.map((t) => t.name);
  log.info("server built", {
    // One string, not an array: the logger caps arrays at 20 items and we have more tools.
    toolCount: toolNames.length,
    tools: toolNames.join(","),
    writeEnabled: config.writeEnabled,
    serverUrl: config.serverUrl,
  });
  return server;
}

// The SDK hands template variables back still percent-encoded (bookResourceUri encodes the libId),
// so decode once. Malformed encoding stays as typed and ends in the same unknown-library error.
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Adapt the SDK's per-request extra into the SDK-free ToolContext handlers receive: the
 * cancellation signal as-is, and a throttled monotonic progress callback only when the
 * client sent a progressToken (otherwise there is nobody to notify).
 */
function toolContext(extra: ServerContext): ToolContext {
  const progressToken = extra.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return { signal: extra.mcpReq.signal };
  return {
    signal: extra.mcpReq.signal,
    progress: createProgressReporter({
      progressToken,
      // spread: v2's notify params carry an index signature our ProgressNotification lacks
      send: (params) => extra.mcpReq.notify({ method: "notifications/progress", params: { ...params } }),
      onError: (err) => log.debug("progress notification failed", { msg: String(err) }),
    }),
  };
}

/**
 * Background boot probes (stderr only). Detect extraction backends and log the chosen path;
 * the first calibre_get_content call awaits the same memoized promise (DESIGN open item).
 * Then tell a first-time user whether the Content Server is up before the first tool call
 * fails — which also warms the library-map cache.
 */
function startBootProbes(deps: ToolDeps, extractor: Extractor): void {
  const { config } = deps;
  // Semantic availability at boot — otherwise only ping reveals a missing optional dep.
  const sem = computeSemanticStatus(deps);
  if (sem.available) log.info("semantic search available", { model: sem.model });
  else log.warn("semantic search unavailable", { reason: sem.reason });
  // Backend detection is adapter-only (not on the TextExtractor port), so the root passes it in.
  void extractor
    .detectBackends()
    .then((r) => log.info("extractor backends", r))
    .catch((e) => log.warn("extractor detection failed", { msg: String(e) }));

  void deps.content
    .libraryInfo()
    .then((info) =>
      log.info("content server reachable", {
        url: config.serverUrl,
        libraries: Object.keys(info.libraryMap).length,
        default: info.defaultLibrary,
      }),
    )
    .catch((err) =>
      log.warn("content server unreachable at boot", {
        url: config.serverUrl,
        hint: "start it in Calibre (Connect/share → Start Content server) or set CALIBRE_MCP_SERVER_URL",
        err,
      }),
    );
}

/**
 * Register the three ui:// widget resources (issue #22). Covers load straight from the
 * Content Server, so the CSP must whitelist its origin (hosts default img-src to
 * 'self' data: otherwise); the widget's onerror → generated-placeholder path absorbs a
 * blocked or unreachable origin.
 */
function registerUiResources(server: McpServer, config: Config): void {
  const { serverUrl, boardStyle, widgetDebug } = config;
  let origin: string;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    origin = serverUrl;
  }
  const cspMeta = { ui: { csp: { resourceDomains: [origin] } } };

  const widgets: Array<{ name: string; uri: string; description: string; html: string }> = [
    {
      name: "Cover board (search)",
      uri: BOARD_KEYWORD_URI,
      description: "In-chat cover board for calibre_search results.",
      html: boardHtml("calibre_search", VERSION, boardStyle, widgetDebug),
    },
    {
      name: "Cover board (semantic search)",
      uri: BOARD_SEMANTIC_URI,
      description: "In-chat cover board for calibre_semantic_search results.",
      html: boardHtml("calibre_semantic_search", VERSION, boardStyle, widgetDebug),
    },
    {
      name: "Book card",
      uri: CARD_URI,
      description: "In-chat book details card for calibre_get_book.",
      html: cardHtml(VERSION, widgetDebug),
    },
    {
      name: "Book figures",
      uri: FIGURES_URI,
      description: "Reading pane for the figures calibre_get_figures fetched.",
      html: figuresHtml(VERSION, widgetDebug),
    },
  ];
  for (const wdg of widgets) {
    registerAppResource(server, wdg.name, wdg.uri, { description: wdg.description, _meta: cspMeta }, async () => ({
      contents: [{ uri: wdg.uri, mimeType: RESOURCE_MIME_TYPE, text: wdg.html, _meta: cspMeta }],
      _meta: cspMeta,
    }));
  }
}

// Builds the McpServer and registers tools + resources. This is the ONLY layer that
// imports the MCP SDK (DESIGN §7) — tool logic, the calibre clients, and domain code
// stay SDK-free so the SDK can be swapped behind this seam. Transport lives in run-stdio.ts.

import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { loadConfig, type Config } from "./config.js";
import { CalibreClient } from "./calibre/client.js";
import { ContentServerClient } from "./calibre/content-server.js";
import { Extractor } from "./calibre/extract.js";
import { FigureInventoryService } from "./calibre/figure-inventory.js";
import { TransformersEmbedder } from "./semantic/embedder.js";
import { TransformersReranker } from "./semantic/reranker.js";
import { SqliteIndexStore } from "./semantic/store.js";
import { computeSemanticStatus, formatSemanticStatusLine } from "./semantic/status.js";
import { readBookResource } from "./resources/book.js";
import { allTools, assertWriteClassification } from "./tools/registry.js";
import { toolError } from "./tools/result.js";
import type { ToolDeps } from "./tools/types.js";
import { BoardCache } from "./ui/board-cache.js";
import { boardHtml, BOARD_KEYWORD_URI, BOARD_SEMANTIC_URI } from "./ui/board-html.js";
import { cardHtml, CARD_URI } from "./ui/card-html.js";
import { log } from "./logging.js";
import { VERSION } from "./version.js";

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
  calibre_board_data: { visibility: ["app"] },
  calibre_open_book: { visibility: ["app"] },
};

export function buildServer(): McpServer {
  const config = loadConfig();
  const figures = new FigureInventoryService(config);
  const deps: ToolDeps = {
    config,
    content: new ContentServerClient(config),
    calibre: new CalibreClient(config),
    extractor: new Extractor(config, figures), // figures dep = inline image markers (#84)
    figures,
    embedder: new TransformersEmbedder(config), // lazy: no model load until first embed
    reranker: new TransformersReranker(config), // lazy: no model load until first rerank
    index: new SqliteIndexStore(config, log), // lazy: no db file until first index op
    boardCache: new BoardCache(), // cover-board widget re-pull cache (issue #22)
    log,
  };

  // Detect extraction backends in the background and log the chosen path to stderr;
  // the first calibre_get_content call awaits the same memoized promise (DESIGN open item).
  void deps.extractor
    .detectBackends()
    .then((r) => log.info("extractor backends", r))
    .catch((e) => log.warn("extractor detection failed", { msg: String(e) }));

  // Onboarding probe (stderr only): tell a first-time user whether the Content Server
  // is up before the first tool call fails. Also warms the library-map cache.
  void deps.content
    .libraryInfo()
    .then((info) =>
      log.info("content server reachable", {
        url: config.serverUrl,
        libraries: Object.keys(info.libraryMap).length,
        default: info.defaultLibrary,
      }),
    )
    .catch(() =>
      log.warn(
        `Calibre Content Server not reachable at ${config.serverUrl} — start it in ` +
          "Calibre (Connect/share → Start Content server) or set CALIBRE_MCP_SERVER_URL",
      ),
    );

  const server = new McpServer(
    { name: "calibre-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Fail loud at boot if any non-read-only tool is unclassified (no write / localWrite).
  assertWriteClassification();

  // Register every descriptor; bridge the SDK-free ToolResult ⇄ CallToolResult. Handlers
  // already return-not-throw; the try/catch here is a defense-in-depth safety net (DESIGN §3).
  for (const t of allTools) {
    const toolConfig = {
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
    };
    // ToolResult is structurally a CallToolResult minus the SDK's loose index signature;
    // cast once here (the seam) rather than weaken the shared ToolResult type.
    const handler = async (args: unknown): Promise<CallToolResult> => {
      try {
        return (await t.handler(args, deps)) as CallToolResult;
      } catch (err) {
        const name = err instanceof Error ? err.name : "Error";
        const msg = err instanceof Error ? err.message : String(err);
        log.error("tool threw", {
          tool: t.name,
          name,
          msg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        // Surface the error NAME + message to the model (issue #73): domain errors keep
        // their messages host-path-free by contract (domain/errors.ts), so this is safe
        // to show and gives the agent something actionable instead of a blind retry.
        return toolError(`internal error in ${t.name} — ${name}: ${msg}`, {
          errorCode: name,
        }) as CallToolResult;
      }
    };
    // UI-bearing tools go through registerAppTool (normalizes _meta.ui for older hosts);
    // everything else registers exactly as before.
    const ui = UI_TOOL_META[t.name];
    const reg = ui
      ? registerAppTool(server, t.name, { ...toolConfig, _meta: { ui } }, handler)
      : server.registerTool(t.name, toolConfig, handler);
    // Disable (not reject) write tools when the gate is off (DESIGN §4) — wired now so
    // tool #11 drops in later with no change to this seam.
    if (t.write && !config.writeEnabled) reg.disable();
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
        inputSchema: { line: z.string().max(4000) },
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

  // calibre://book/{id} — the target of search/get_book resource_links. RESOURCE CONTRACT:
  // the read handler THROWS on failure (the SDK turns it into a protocol error), unlike tools.
  server.registerResource(
    "book",
    new ResourceTemplate("calibre://book/{id}", { list: undefined }),
    { title: "Calibre book", description: "Full metadata for one book." },
    async (_uri, variables) => {
      const raw = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const id = Number(raw);
      const r = await readBookResource(deps, id);
      return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] };
    },
  );

  // Connectivity probe — proves the SUBPROCESS path (calibredb --with-library URL) works,
  // complementary to calibre_list_libraries which proves the HTTP /ajax path. Also carries a
  // semantic-search self-diagnosis block (#48) so "why is semantic search off" is one call.
  server.registerTool(
    "calibre_ping",
    {
      title: "Calibre ping",
      description:
        "Health check: confirms the MCP server can reach the running Calibre " +
        "Content Server via calibredb, and reports semantic-search status " +
        "(embedding model, dependency, index vector count). Returns library categories on success.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      // Resolve the libId (needed for both calibredb and the index vector count) first —
      // --with-library needs the ID, not the display name. A failure here is non-fatal to the
      // semantic diagnosis (it reads local disk/state), so keep it and still report semantics.
      let libId: string | undefined;
      let listOut: string | undefined;
      let pingError: string | undefined;
      try {
        libId = await deps.content.resolveLibraryId();
        listOut = await deps.calibre.listLibraries(libId);
      } catch (err) {
        pingError = err instanceof Error ? err.message : String(err);
        log.error("ping failed", pingError);
      }

      const semantic = computeSemanticStatus(deps, libId);
      const semLine = formatSemanticStatusLine(semantic);

      if (pingError !== undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: `Calibre unreachable: ${pingError}\n${semLine}` }],
          structuredContent: { ok: false, error: pingError, serverUrl: config.serverUrl, semantic },
        };
      }
      return {
        content: [{ type: "text", text: `ok\n${(listOut ?? "").slice(0, 500)}\n${semLine}` }],
        structuredContent: { ok: true, serverUrl: config.serverUrl, semantic },
      };
    },
  );

  log.info("server built", {
    tools: [...allTools.map((t) => t.name), "calibre_ping"],
    writeEnabled: config.writeEnabled,
    serverUrl: config.serverUrl,
  });
  return server;
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
  ];
  for (const wdg of widgets) {
    registerAppResource(
      server,
      wdg.name,
      wdg.uri,
      { description: wdg.description, _meta: cspMeta },
      async () => ({
        contents: [{ uri: wdg.uri, mimeType: RESOURCE_MIME_TYPE, text: wdg.html, _meta: cspMeta }],
        _meta: cspMeta,
      }),
    );
  }
}

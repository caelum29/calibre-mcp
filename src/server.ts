// Builds the McpServer and registers tools + resources. This is the ONLY layer that
// imports the MCP SDK (DESIGN §7) — tool logic, the calibre clients, and domain code
// stay SDK-free so the SDK can be swapped behind this seam. Transport lives in run-stdio.ts.

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { CalibreClient } from "./calibre/client.js";
import { ContentServerClient } from "./calibre/content-server.js";
import { Extractor } from "./calibre/extract.js";
import { TransformersEmbedder } from "./semantic/embedder.js";
import { TransformersReranker } from "./semantic/reranker.js";
import { SqliteIndexStore } from "./semantic/store.js";
import { readBookResource } from "./resources/book.js";
import { allTools } from "./tools/registry.js";
import { toolError } from "./tools/result.js";
import type { ToolDeps } from "./tools/types.js";
import { log } from "./logging.js";
import { VERSION } from "./version.js";

export function buildServer(): McpServer {
  const config = loadConfig();
  const deps: ToolDeps = {
    config,
    content: new ContentServerClient(config),
    calibre: new CalibreClient(config),
    extractor: new Extractor(config),
    embedder: new TransformersEmbedder(config), // lazy: no model load until first embed
    reranker: new TransformersReranker(config), // lazy: no model load until first rerank
    index: new SqliteIndexStore(config, log), // lazy: no db file until first index op
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

  // Register every descriptor; bridge the SDK-free ToolResult ⇄ CallToolResult. Handlers
  // already return-not-throw; the try/catch here is a defense-in-depth safety net (DESIGN §3).
  for (const t of allTools) {
    const reg = server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
      },
      // ToolResult is structurally a CallToolResult minus the SDK's loose index signature;
      // cast once here (the seam) rather than weaken the shared ToolResult type.
      async (args: unknown): Promise<CallToolResult> => {
        try {
          return (await t.handler(args, deps)) as CallToolResult;
        } catch (err) {
          log.error("tool threw", {
            tool: t.name,
            msg: err instanceof Error ? err.message : String(err),
          });
          return toolError(`internal error in ${t.name}`) as CallToolResult;
        }
      },
    );
    // Disable (not reject) write tools when the gate is off (DESIGN §4) — wired now so
    // tool #11 drops in later with no change to this seam.
    if (t.write && !config.writeEnabled) reg.disable();
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
  // complementary to calibre_list_libraries which proves the HTTP /ajax path.
  server.registerTool(
    "calibre_ping",
    {
      title: "Calibre ping",
      description:
        "Health check: confirms the MCP server can reach the running Calibre " +
        "Content Server via calibredb. Returns library categories on success.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        // Resolve the libId first — --with-library needs the ID, not the display name.
        const libId = await deps.content.resolveLibraryId();
        const out = await deps.calibre.listLibraries(libId);
        return {
          content: [{ type: "text", text: `ok\n${out.slice(0, 500)}` }],
          structuredContent: { ok: true, serverUrl: config.serverUrl },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("ping failed", message);
        return {
          isError: true,
          content: [{ type: "text", text: `Calibre unreachable: ${message}` }],
          structuredContent: { ok: false, error: message },
        };
      }
    },
  );

  log.info("server built", {
    tools: [...allTools.map((t) => t.name), "calibre_ping"],
    writeEnabled: config.writeEnabled,
    serverUrl: config.serverUrl,
  });
  return server;
}

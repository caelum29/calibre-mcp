// THROWAWAY SPIKE (#21) — MCP Apps live probe: capability logging, ui:// resource,
// scratch board tool. Never merge to main. Deliberately violates the SDK-free seam
// (imports ext-apps outside server.ts) — acceptable for a dead-end branch.

import {
  registerAppTool,
  registerAppResource,
  getUiCapability,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../tools/types.js";
import { log } from "../logging.js";
import { BOARD_HTML } from "./board-html.js";

const BOARD_URI = "ui://calibre/probe-board.html";
const CSP_META = {
  ui: {
    csp: {
      resourceDomains: ["http://localhost:8080"],
      connectDomains: ["http://localhost:8080"], // fetch() escape hatch probe
    },
  },
};

interface Thumb {
  data: string;
  bytes: number;
}

export function registerUiProbe(server: McpServer, deps: ToolDeps): void {
  // SPIKE Q1 (kill-switch): does Claude Desktop send the ui extension over stdio?
  server.server.oninitialized = () => {
    const caps = server.server.getClientCapabilities();
    log.info("SPIKE clientInfo", server.server.getClientVersion() ?? null);
    log.info("SPIKE client capabilities (raw)", caps ?? null);
    log.info("SPIKE ui capability", getUiCapability(caps) ?? "ABSENT — widget path dead on this host");
  };

  registerAppResource(
    server,
    "Probe cover board",
    BOARD_URI,
    { description: "Throwaway spike widget (#21)", _meta: CSP_META },
    async () => {
      log.info("SPIKE resources/read", { uri: BOARD_URI });
      return {
        contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: BOARD_HTML, _meta: CSP_META }],
        _meta: CSP_META,
      };
    },
  );

  registerAppTool(
    server,
    "calibre_probe_board",
    {
      title: "Probe cover board",
      description:
        "SPIKE #21: renders a tiny cover-board widget (3 covers, Read buttons) to probe " +
        "MCP Apps in this host. Call once with no arguments when asked to run the probe.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async () => {
      const base = deps.config.serverUrl.replace(/\/+$/, "");
      const libId = await deps.content.resolveLibraryId();

      const thumbUrl = (id: number, sz: string): string =>
        `${base}/get/thumb/${id}/${encodeURIComponent(libId)}?sz=${sz}`;
      const fetchThumb = async (id: number, sz: string): Promise<Thumb> => {
        const r = await fetch(thumbUrl(id, sz));
        if (!r.ok) throw new Error(`thumb ${id} → HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get("content-type") ?? "image/jpeg";
        return { data: `data:${mime};base64,${buf.toString("base64")}`, bytes: buf.byteLength };
      };

      const page = await deps.content.search({ query: "", num: 40 });
      const ids = page.bookIds;
      const boardIds = ids.slice(0, 3);
      const meta = await deps.content.booksByIds(boardIds);

      const books = await Promise.all(
        boardIds.map(async (id) => {
          const b = meta.get(id);
          const t = await fetchThumb(id, "300x400");
          return {
            id,
            title: b?.title ?? `book ${id}`,
            authors: b?.authors ?? [],
            thumbUrl: thumbUrl(id, "300x400"),
            thumbData: t.data,
            thumbBytes: t.bytes,
            readUrl: `${base}/#book_id=${id}&library_id=${encodeURIComponent(libId)}&panel=book_details`,
          };
        }),
      );

      // SPIKE Q3 measurement: real base64 payload for up to 40 covers, two thumb sizes.
      const measure = async (sz: string) => {
        const rs = await Promise.all(ids.map((id) => fetchThumb(id, sz).catch(() => null)));
        const ok = rs.filter((r): r is Thumb => r !== null);
        const raw = ok.reduce((s, r) => s + r.bytes, 0);
        const b64 = ok.reduce((s, r) => s + r.data.length, 0);
        return {
          covers: ok.length,
          failed: rs.length - ok.length,
          rawKB: Math.round(raw / 1024),
          base64KB: Math.round(b64 / 1024),
          avgBase64KB: ok.length ? Math.round((b64 / ok.length / 1024) * 10) / 10 : 0,
        };
      };
      const payloadStats = {
        "150x200": await measure("150x200"),
        "300x400": await measure("300x400"),
      };
      log.info("SPIKE payload stats", payloadStats);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Probe board data for ${books.length} covers attached (lib ${libId}). ` +
              `Payload stats for ${ids.length} covers logged. If no widget rendered, this host has no MCP Apps support.`,
          },
        ],
        structuredContent: { libId, serverUrl: base, books, payloadStats },
      };
    },
  );

  log.info("SPIKE ui-probe registered", { tool: "calibre_probe_board", resource: BOARD_URI });
}

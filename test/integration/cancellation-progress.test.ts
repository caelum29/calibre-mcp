// End-to-end cancellation + progress through the real server (buildServer) and the SDK
// Client: a fake Content Server (node:http) serves book metadata and an EPUB download, and a
// fake `ebook-convert` (a node script beside a fake calibredb) either sleeps — so the call can
// be cancelled mid-conversion — or writes text immediately. No Calibre, no network.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProgressNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "../../src/server.js";

const posix = process.platform !== "win32";
const LIB = "Test_Lib";

let dir: string;
let http: Server;
let baseUrl: string;
let pidFile: string;

/** A unique lastModified per test run defeats the extractor's on-disk text cache. */
const runStamp = `2026-01-01T00:00:${String(Date.now() % 60).padStart(2, "0")}.${Date.now()}`;

function rawBook(id: number) {
  return {
    application_id: id,
    title: `Book ${id}`,
    authors: ["A. Author"],
    formats: ["EPUB"],
    identifiers: {},
    tags: [],
    languages: ["eng"],
    last_modified: `${runStamp}-${id}`,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "cancel-progress-"));
  pidFile = path.join(dir, "convert.pid");
  // ebook-convert <src> <dest> …: record our pid, then either sleep (SLOW) or write text.
  const convert = path.join(dir, "ebook-convert");
  writeFileSync(
    convert,
    `#!${process.execPath}\n` +
      `const fs = require("node:fs");\n` +
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
      `if (process.env.FAKE_CONVERT_SLOW === "1") setTimeout(() => {}, 60000);\n` +
      `else fs.writeFileSync(process.argv[3], "Chapter 1\\n\\n" + "Ownership and borrowing. ".repeat(200));\n`,
  );
  chmodSync(convert, 0o755);
  // Only its directory matters: ebook-convert is looked up beside calibredb.
  writeFileSync(path.join(dir, "calibredb"), "");

  http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/ajax/library-info")
      return json({ library_map: { [LIB]: "Test Lib" }, default_library: LIB });
    const book = /^\/ajax\/book\/(\d+)\//.exec(url.pathname);
    if (book) return json(rawBook(Number(book[1])));
    if (url.pathname.startsWith("/ajax/search/")) {
      return json({ total_num: 3, book_ids: [1, 2, 3], num: 3, offset: 0, sort: "title", library_id: LIB });
    }
    if (url.pathname.startsWith("/get/")) {
      res.setHeader("content-type", "application/epub+zip");
      return res.end("not really an epub");
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.FAKE_CONVERT_SLOW;
  await new Promise<void>((resolve) => http.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

async function connect() {
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: baseUrl,
      CALIBRE_MCP_CALIBREDB_PATH: path.join(dir, "calibredb"),
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "cancel-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return {
    client,
    close: () => Promise.allSettled([client.close(), server.close()]),
  };
}

/** Dead = gone (ESRCH) or a zombie awaiting a reaper (PID 1 in some containers never reaps). */
function isDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z") ?? false;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => boolean, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

describe.runIf(posix)("cancellation", () => {
  it("cancelling calibre_get_content kills the converter and the handler returns isError", async () => {
    process.env.FAKE_CONVERT_SLOW = "1";
    rmSync(pidFile, { force: true });
    const { client, close } = await connect();
    try {
      const controller = new AbortController();
      const call = client.callTool({ name: "calibre_get_content", arguments: { id: 7 } }, undefined, {
        signal: controller.signal,
      });
      // Cancel once the converter is actually running.
      expect(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "")).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8"));
      controller.abort("user cancelled");
      // The client side rejects (the SDK sends notifications/cancelled and drops the response).
      await expect(call).rejects.toThrow();
      // Server side: the converter's process group was killed.
      expect(await waitFor(() => isDead(pid))).toBe(true);
    } finally {
      delete process.env.FAKE_CONVERT_SLOW;
      await close();
    }
  }, 20_000);

  it("a cancelled handler returns an isError result instead of throwing", async () => {
    process.env.FAKE_CONVERT_SLOW = "1";
    rmSync(pidFile, { force: true });
    // Drive the handler directly through the registry to observe its return value — over
    // the wire the SDK discards a cancelled request's response.
    const { buildIndexTool } = await import("../../src/tools/calibre_build_index.js");
    const { loadConfig } = await import("../../src/config.js");
    const { ContentServerClient } = await import("../../src/calibre/content-server.js");
    const { Extractor } = await import("../../src/calibre/extract.js");
    const { SqliteIndexStore } = await import("../../src/semantic/store.js");
    const { log } = await import("../../src/logging.js");
    const config = loadConfig({
      CALIBRE_MCP_SERVER_URL: baseUrl,
      CALIBRE_MCP_CALIBREDB_PATH: path.join(dir, "calibredb"),
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    });
    const deps = {
      config,
      content: new ContentServerClient(config),
      calibre: {} as never,
      extractor: new Extractor(config),
      figures: {} as never,
      embedder: {} as never,
      index: new SqliteIndexStore(config, log),
      log,
    };
    const controller = new AbortController();
    try {
      const pending = buildIndexTool.handler(
        { query: "all", force: true, keywordOnly: true, enableFts: false, prune: false },
        deps,
        { signal: controller.signal },
      );
      expect(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "")).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8"));
      controller.abort();
      const r = await pending;
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ cancelled: true, booksRequested: 3, booksIndexed: 0 });
      expect(r.content[0]?.type === "text" && r.content[0].text).toContain("cancelled");
      expect(await waitFor(() => isDead(pid))).toBe(true);
    } finally {
      delete process.env.FAKE_CONVERT_SLOW;
      deps.index.close();
    }
  }, 20_000);
});

describe.runIf(posix)("progress", () => {
  it("calibre_build_index sends monotonic progress notifications when asked", async () => {
    const { client, close } = await connect();
    try {
      const seen: Array<{ progress: number; total?: number; message?: string }> = [];
      const r = (await client.callTool(
        {
          name: "calibre_build_index",
          arguments: { query: "all", force: true, keywordOnly: true },
        },
        undefined,
        { onprogress: (p) => seen.push(p) },
      )) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({ booksRequested: 3, booksIndexed: 3 });
      expect(seen.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]!.progress).toBeGreaterThan(seen[i - 1]!.progress);
      }
      // The final notification (completion) always goes out, despite the throttle.
      expect(seen.at(-1)).toMatchObject({ progress: 3, total: 3 });
    } finally {
      await close();
    }
  }, 20_000);

  it("sends no progress notifications without a progressToken", async () => {
    const { client, close } = await connect();
    let notified = 0;
    // Replace the SDK's own progress handler (the fallback handler never sees progress
    // notifications, so counting there could not fail).
    client.setNotificationHandler(ProgressNotificationSchema, async () => {
      notified++;
    });
    try {
      const r = (await client.callTool({
        name: "calibre_build_index",
        arguments: { query: "all", force: true, keywordOnly: true },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(notified).toBe(0);
    } finally {
      await close();
    }
  }, 20_000);
});

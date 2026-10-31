// A read-only health probe (noBreaker) must not flag a library busy when the count times out (#304).
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { loadConfig } from "../../src/config.js";
import { CalibreHttpTimeoutError } from "../../src/domain/errors.js";

let server: Server | undefined;
afterEach(() => server?.close());

/** library-info answers; /ajax/search hangs, like a Calibre busy with FTS. */
async function hangingSearchServer(): Promise<string> {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/ajax/library-info")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ library_map: { Lib: "Lib" }, default_library: "Lib" }));
    }
    // search: never answered
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("ContentServerClient.search noBreaker", () => {
  it("times out without marking the library busy", async () => {
    const url = await hangingSearchServer();
    const busy = new LibraryBusyTracker();
    const c = new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: url }), busy);
    await expect(
      c.search({ query: "", library: "Lib", num: 0, timeoutMs: 200, noBreaker: true }),
    ).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("still marks busy on a normal (breaker) search timeout", async () => {
    const url = await hangingSearchServer();
    const busy = new LibraryBusyTracker();
    const c = new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: url }), busy);
    await expect(c.search({ query: "", library: "Lib", num: 0, timeoutMs: 200 })).rejects.toBeInstanceOf(
      CalibreHttpTimeoutError,
    );
    expect(busy.busyLibraries().map((b) => b.libraryId)).toEqual(["Lib"]);
  });
});

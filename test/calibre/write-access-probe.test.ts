// #439: the write-access probe is one HTTP POST that can never run a write — it targets
// set_metadata at module version 999, which Calibre rejects after its write check and before
// reading args or opening the library. Fakes only; no live server.

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { asLibId } from "../../src/calibre/lib-id.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () => new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9" }));

describe("ContentServerClient.probeWriteAccess", () => {
  it("should_POST_to_a_nonexistent_module_version_so_nothing_is_written", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not available in version: 999", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await client().probeWriteAccess(asLibId("My Books"));
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect({ calls: fetch.mock.calls.length, url, method: init.method }).toEqual({
      calls: 1,
      url: "http://127.0.0.1:9/cdb/cmd/set_metadata/999?library_id=My%20Books",
      method: "POST",
    });
  });

  it("should_report_refused_on_403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Anonymous users are not allowed to make changes", { status: 403 })),
    );
    expect(await client().probeWriteAccess(asLibId("My_Books"))).toEqual({ access: "refused" });
  });

  it("should_report_allowed_on_the_unknown_version_404", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("The module set_metadata is not available in version: 999", { status: 404 })),
    );
    expect(await client().probeWriteAccess(asLibId("My_Books"))).toEqual({ access: "allowed" });
  });

  it("should_report_unknown_when_the_server_does_not_answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await client().probeWriteAccess(asLibId("My_Books"))).toEqual({ access: "unknown", reason: "no reply" });
  });

  it("should_report_unknown_on_a_timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) =>
            init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))),
          ),
      ),
    );
    expect(await client().probeWriteAccess(asLibId("My_Books"), { timeoutMs: 20 })).toEqual({
      access: "unknown",
      reason: "timed out",
    });
  });
});

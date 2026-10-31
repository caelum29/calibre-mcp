import { describe, it, expect, vi, afterEach } from "vitest";
import { getBytes } from "../../src/calibre/http.js";
import { CalibreHttpError } from "../../src/domain/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getBytes", () => {
  it("returns the body bytes and content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("abc", { headers: { "content-type": "image/png" } })),
    );
    const { data, contentType } = await getBytes("http://x/get/thumb/1/Lib");
    expect(data.toString("utf8")).toBe("abc");
    expect(contentType).toBe("image/png");
  });

  it("maps non-2xx to CalibreHttpError with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(getBytes("http://x/missing")).rejects.toMatchObject({ status: 404 });
    await expect(getBytes("http://x/missing")).rejects.toBeInstanceOf(CalibreHttpError);
  });

  it("maps a stalled request to a timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) =>
            init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))),
          ),
      ),
    );
    await expect(getBytes("http://x/hung", { timeoutMs: 20 })).rejects.toThrow("Content Server request timed out");
  });
});

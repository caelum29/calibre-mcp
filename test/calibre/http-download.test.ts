import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToFile } from "../../src/calibre/http.js";
import { CalibreHttpError } from "../../src/domain/errors.js";

// fetch is the system boundary; stub it with real Web Response objects (Node 24 global).
function dest(): string {
  return path.join(tmpdir(), `dl-test-${randomUUID()}.bin`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadToFile", () => {
  it("streams the body to disk and reports bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("hello world")));
    const out = dest();
    try {
      const { bytes } = await downloadToFile("http://x/get/EPUB/1/Lib", out);
      expect(bytes).toBe(11);
      expect(await readFile(out, "utf8")).toBe("hello world");
    } finally {
      await unlink(out).catch(() => {});
    }
  });

  it("throws CalibreHttpError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(downloadToFile("http://x/missing", dest())).rejects.toBeInstanceOf(CalibreHttpError);
  });

  it("aborts and throws when the stream exceeds maxBytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("hello")));
    await expect(downloadToFile("http://x/big", dest(), { maxBytes: 3 })).rejects.toBeInstanceOf(
      CalibreHttpError,
    );
  });
});

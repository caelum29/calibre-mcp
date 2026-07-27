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

  // The timeout bounds STALL, not total elapsed (#100): a genuinely huge PDF takes minutes
  // from cold disk and used to be killed mid-transfer by a fixed elapsed cap.
  it("completes a slow-but-progressing download that outlives the timeout window", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(drip(["ab", "cd", "ef", "gh"], 25))));
    const out = dest();
    try {
      const { bytes } = await downloadToFile("http://x/big", out, { timeoutMs: 60 });
      expect(bytes).toBe(8); // ~100 ms of transfer under a 60 ms stall timeout
    } finally {
      await unlink(out).catch(() => {});
    }
  });

  it("aborts with a stall message when the stream goes quiet", async () => {
    // Mirror real fetch: the abort signal errors the body stream.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
        Promise.resolve(new Response(drip(["ab"], 10_000, init?.signal))),
      ),
    );
    await expect(downloadToFile("http://x/hung", dest(), { timeoutMs: 30 })).rejects.toThrow(
      /Download stalled/,
    );
  });
});

/** A body that emits one chunk every `gapMs`, then closes — a slow but progressing transfer. */
function drip(chunks: string[], gapMs: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]!));
          else controller.close();
          resolve();
        }, gapMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            controller.error(new DOMException("aborted", "AbortError"));
            resolve();
          },
          { once: true },
        );
      });
    },
  });
}

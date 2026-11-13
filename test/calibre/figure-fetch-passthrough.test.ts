// encodeSmallest pass-through (#486): without sips the original bytes are returned untouched, so the
// mimeType must follow the real image format (magic bytes), not a hardcoded image/png. findBin is
// stubbed to null so the test runs the same on macOS and Linux CI.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/calibre/binaries.js", () => ({ findBin: () => null }));

import { encodeSmallest, type Runner } from "../../src/calibre/figure-fetch.js";

let scratch = "";
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const noRun: Runner = async () => {
  throw new Error("no subprocess expected without sips");
};

async function passThrough(name: string, bytes: number[]) {
  scratch = mkdtempSync(path.join(tmpdir(), "fig-pass-"));
  const file = path.join(scratch, name);
  writeFileSync(file, Buffer.from(bytes));
  return encodeSmallest(noRun, file, 1024);
}

describe("encodeSmallest without sips (#486)", () => {
  it("should_label_jpeg_bytes_as_image_jpeg", async () => {
    const bytes = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46];
    const out = await passThrough("a.jpg", bytes);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.data).toBe(Buffer.from(bytes).toString("base64"));
    expect(out.bytes).toBe(bytes.length);
  });

  it("should_label_png_bytes_as_image_png", async () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const out = await passThrough("a.png", bytes);
    expect(out.mimeType).toBe("image/png");
    expect(out.bytes).toBe(bytes.length);
  });

  it("should_label_gif_bytes_as_image_gif", async () => {
    const out = await passThrough("a.gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0]);
    expect(out.mimeType).toBe("image/gif");
  });

  it("should_label_webp_bytes_as_image_webp", async () => {
    // RIFF <size> WEBP
    const out = await passThrough("a.webp", [0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(out.mimeType).toBe("image/webp");
  });
});

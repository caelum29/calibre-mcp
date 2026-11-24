// #655 / ADR-0033: the extractor cleans the converter's text BEFORE figure-marker injection, caches
// the cleaned text (text cache v9) and returns the final-text → raw offset map, cached with it.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Extractor, parseTextCacheEnvelope } from "../../src/calibre/extract.js";
import { loadConfig } from "../../src/config.js";
import { decodeOffsetMap, toRaw } from "../../src/domain/normalise/offset-map.js";

const RAW =
  "# Chapter 1\n\nThe ﬁrst ﬁle is here.\n\nFigure 1.1: A ﬂow diagram\n\nMore text dis-\nplayed here.\n\fNext\u00a0page\n";

let dir: string;
let http: Server;
let baseUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "extract-655-"));
  const convert = path.join(dir, "ebook-convert");
  writeFileSync(
    convert,
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.argv[3], ${JSON.stringify(RAW)});\n`,
  );
  chmodSync(convert, 0o755);
  writeFileSync(path.join(dir, "calibredb"), ""); // ebook-convert is looked up beside calibredb
  http = createServer((_req, res) => res.end("not really an epub"));
  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    http.close(() => resolve());
  });
  rmSync(dir, { recursive: true, force: true });
});

const inventories = {
  getInventory: async () => ({
    cached: true,
    inventory: {
      entries: [
        { index: 0, page: 1, captioned: true, label: "1.1", caption: "A flow diagram", source: "raster" as const },
      ],
      pageCount: 1,
      scanned: false,
      counts: { figures: 1, uncaptioned: 0, pageRender: 0 },
    },
  }),
};

describe("Extractor normalisation (#655)", () => {
  it("cleans before marker injection and maps the final text back to the raw text", async () => {
    const cfg = loadConfig({
      CALIBRE_MCP_SERVER_URL: baseUrl,
      CALIBRE_MCP_CALIBREDB_PATH: path.join(dir, "calibredb"),
    });
    const ex = new Extractor(cfg, inventories);
    const args = { bookId: 1, format: "epub", downloadUrl: `${baseUrl}/get/EPUB/1/L`, cacheKey: `655:${randomUUID()}` };
    const got = await ex.getText(args);

    expect(got.text).toContain("The first file is here.");
    expect(got.text).toContain("More text displayed here.");
    expect(got.text).toContain("\fNext page\n");
    expect(got.text).not.toMatch(/[ﬁﬂ\u00a0]/u);
    // the marker was placed on the cleaned caption line, in final-text coordinates
    expect(got.markers).toHaveLength(1);
    const at = got.markers[0]!.charOffset;
    expect(got.text.slice(at)).toMatch(/^\[image #0: "Figure 1\.1: A flow diagram"\]\nFigure 1\.1: A flow diagram\n/);

    const map = got.offsetMap!;
    // text the rules leave alone maps back onto the same text in RAW
    for (const probe of ["Figure 1.1", "More text", "played here", "\fNext"]) {
      expect(toRaw(map, got.text.indexOf(probe))).toBe(RAW.indexOf(probe));
    }
    expect(toRaw(map, at)).toBe(RAW.indexOf("Figure 1.1")); // the marker sits on its caption's raw spot
    expect(toRaw(map, got.text.length)).toBe(RAW.length);

    const again = await ex.getText(args);
    expect(again.backend).toBe("cache");
    expect(again.text).toBe(got.text);
    expect(again.offsetMap).toEqual(map);
  });

  it("caches as envelope v9 with the encoded map; a v8 envelope is never served", () => {
    const env = { v: 9, backend: "ebook-convert", text: "t", markers: [], offsetMap: "m1:1,1,2" };
    expect(parseTextCacheEnvelope(JSON.stringify(env))).toEqual(env);
    expect(decodeOffsetMap(env.offsetMap)?.edits).toHaveLength(1);
    expect(parseTextCacheEnvelope(JSON.stringify({ ...env, v: 8 }))).toBeNull();
    // a v9 envelope without a valid map is re-extracted, not served with a guessed map
    expect(parseTextCacheEnvelope(JSON.stringify({ v: 9, backend: "x", text: "t", markers: [] }))).toBeNull();
  });
});

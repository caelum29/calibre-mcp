// scanEpubFile on a broken EPUB (#485): a missing container.xml, or a container pointing at a
// missing OPF, must surface as FiguresError("SCAN_FAILED") — not a raw ENOENT carrying the
// scratch path — and the scratch dir must still be removed. Real zip/unzip, no Calibre.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FigureInventoryService } from "../../src/calibre/figure-inventory.js";
import { unzipBinary } from "../../src/calibre/epub-toc.js";
import { loadConfig } from "../../src/config.js";
import { FiguresError } from "../../src/domain/errors.js";

const ZIP = ["/usr/bin/zip", "/opt/homebrew/bin/zip"].find(existsSync);
const UNZIP = unzipBinary();
const CONTAINER = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/missing.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const scratchDirs = (): string[] => {
  const root = path.join(tmpdir(), "calibre-mcp-cache");
  return existsSync(root) ? readdirSync(root).filter((n) => n.startsWith("ep-")) : [];
};

describe.runIf(ZIP && UNZIP)("scanEpubFile broken EPUBs (#485)", () => {
  let dir = "";
  const build = (name: string, files: Record<string, string>): string => {
    const src = path.join(dir, `${name}-src`);
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
      writeFileSync(path.join(src, f), body);
    }
    const epub = path.join(dir, `${name}.epub`);
    execFileSync(ZIP!, ["-q", "-X", "-r", epub, "."], { cwd: src });
    return epub;
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "epub-485-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const cases: Array<[string, Record<string, string>]> = [
    ["no_container_xml", { mimetype: "application/epub+zip", "OEBPS/ch1.xhtml": "<html/>" }],
    ["container_points_to_missing_opf", { mimetype: "application/epub+zip", "META-INF/container.xml": CONTAINER }],
  ];

  for (const [name, files] of cases) {
    it(`should_throw_SCAN_FAILED_without_a_path_and_clean_scratch_when_${name}`, async () => {
      const epub = build(name, files);
      const before = scratchDirs();

      const err = await new FigureInventoryService(loadConfig({})).scanEpubFile(UNZIP!, epub).then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(FiguresError);
      expect((err as FiguresError).code).toBe("SCAN_FAILED");
      expect((err as FiguresError).message).not.toMatch(/ENOENT|calibre-mcp-cache|ep-/);
      expect(scratchDirs().filter((n) => !before.includes(n))).toEqual([]);
    });
  }
});

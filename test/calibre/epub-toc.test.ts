import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEpubToc, unzipBinary } from "../../src/calibre/epub-toc.js";

// A minimal EPUB 3 built at test time (zip + unzip ship with macOS and every CI image we use).
const ZIP = ["/usr/bin/zip", "/opt/homebrew/bin/zip"].find(existsSync);
const UNZIP = unzipBinary();

const FILES: Record<string, string> = {
  mimetype: "application/epub+zip",
  "META-INF/container.xml": `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  "OEBPS/content.opf": `<?xml version="1.0"?><package version="3.0"><manifest>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  "OEBPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol>
    <li><a href="ch1.xhtml">Loomings</a></li><li><a href="ch2.xhtml">The Carpet-Bag</a></li>
  </ol></nav></body></html>`,
  "OEBPS/ch1.xhtml": `<html><body><h1>Loomings</h1><p>Call me Ishmael. Some years ago, never mind how long precisely.</p></body></html>`,
  "OEBPS/ch2.xhtml": `<html><body><h1>The Carpet-Bag</h1><p>I stuffed a shirt or two into my old carpet-bag, tucked it under my arm.</p></body></html>`,
};

const TEXT =
  "# Loomings\n\nCall me Ishmael. Some years ago, never mind how long precisely.\n\n" +
  "# The Carpet-Bag\n\nI stuffed a shirt or two into my old carpet-bag, tucked it under my arm.\n";

describe.runIf(ZIP && UNZIP)("readEpubToc", () => {
  let dir = "";
  let epub = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "epub-toc-test-"));
    const src = path.join(dir, "src");
    for (const [name, body] of Object.entries(FILES)) {
      mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
      writeFileSync(path.join(src, name), body);
    }
    epub = path.join(dir, "book.epub");
    execFileSync(ZIP!, ["-q", "-X", "-r", epub, "mimetype", "META-INF", "OEBPS"], { cwd: src });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the nav TOC and anchors the spine docs in the extracted text", async () => {
    const toc = await readEpubToc(UNZIP!, epub, TEXT, { scratchRoot: dir });
    expect(toc).toEqual({
      entries: [
        { title: "Loomings", level: 1, href: "OEBPS/ch1.xhtml" },
        { title: "The Carpet-Bag", level: 1, href: "OEBPS/ch2.xhtml" },
      ],
      anchors: [
        { href: "OEBPS/ch1.xhtml", start: 0 },
        { href: "OEBPS/ch2.xhtml", start: TEXT.indexOf("# The Carpet-Bag") },
      ],
    });
  });

  it("returns null for a file that is not a zip", async () => {
    const junk = path.join(dir, "junk.epub");
    writeFileSync(junk, "not a zip");
    expect(await readEpubToc(UNZIP!, junk, TEXT, { scratchRoot: dir })).toBeNull();
  });
});

// PyMuPDF bridge output shape (#133): pages must be `\f`-separated like pdftotext's, so
// page↔offset mapping doesn't depend on which PDF backend is installed. Runs the real
// script against a stub `fitz` module — PyMuPDF itself isn't a test dependency.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPageStarts } from "../../src/domain/page-offsets.js";

const SCRIPT = fileURLToPath(new URL("../../scripts/pymupdf_extract.py", import.meta.url));
const PAGES = ["Page one text\n", "Сторінка два\n", "Page three\n"];

// Minimal stand-in for fitz.open(): iterable pages with get_text("text").
const FITZ_STUB = `
PAGES = ${JSON.stringify(PAGES)}
class _Page:
    def __init__(self, t): self._t = t
    def get_text(self, kind): return self._t
class _Doc(list):
    def close(self): pass
def open(src): return _Doc(_Page(t) for t in PAGES)
`;

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!hasPython)("pymupdf_extract.py", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pymupdf-test-"));
    writeFileSync(path.join(dir, "fitz.py"), FITZ_STUB, "utf8");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("separates pages with \\f so pageStarts maps every page", () => {
    const out = path.join(dir, "out.txt");
    const res = spawnSync("python3", [SCRIPT, path.join(dir, "in.pdf"), out], {
      env: { ...process.env, PYTHONPATH: dir },
    });
    expect(res.status, res.stderr.toString()).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text.split("\f")).toEqual(PAGES);
    const starts = scanPageStarts(text);
    expect(starts.length).toBeGreaterThan(1);
    expect(starts).toHaveLength(PAGES.length);
    expect(text.slice(starts[1])).toMatch(/^Сторінка два/);
  });
});

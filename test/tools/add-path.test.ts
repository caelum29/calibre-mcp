import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateAddPath } from "../../src/tools/add-path.js";

// Real filesystem fixtures — validateAddPath uses realpathSync, so it needs actual files/links.
let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "addroot-"));
  outside = mkdtempSync(path.join(tmpdir(), "outside-"));
  writeFileSync(path.join(root, "book.epub"), "x");
  mkdirSync(path.join(root, "sub"));
  writeFileSync(path.join(root, "sub", "nested.pdf"), "x");
  writeFileSync(path.join(outside, "secret.epub"), "x");
  // A symlink INSIDE the root pointing OUT of it — must be rejected (real target compared).
  symlinkSync(path.join(outside, "secret.epub"), path.join(root, "escape.epub"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("validateAddPath", () => {
  it("accepts a file directly inside a root", () => {
    const r = validateAddPath(path.join(root, "book.epub"), [root]);
    expect(r.ok).toBe(true);
  });

  it("accepts a file in a subdirectory of a root", () => {
    const r = validateAddPath(path.join(root, "sub", "nested.pdf"), [root]);
    expect(r.ok).toBe(true);
  });

  it("rejects a file outside every root", () => {
    const r = validateAddPath(path.join(outside, "secret.epub"), [root]);
    expect(r.ok).toBe(false);
  });

  it("rejects a symlink whose real target escapes the root", () => {
    const r = validateAddPath(path.join(root, "escape.epub"), [root]);
    expect(r.ok).toBe(false);
  });

  it("rejects a .. traversal that climbs out of the root", () => {
    const r = validateAddPath(path.join(root, "..", path.basename(outside), "secret.epub"), [root]);
    expect(r.ok).toBe(false);
  });

  it("rejects a missing file", () => {
    const r = validateAddPath(path.join(root, "nope.epub"), [root]);
    expect(r.ok).toBe(false);
  });

  it("rejects a directory", () => {
    const r = validateAddPath(path.join(root, "sub"), [root]);
    expect(r.ok).toBe(false);
  });
});

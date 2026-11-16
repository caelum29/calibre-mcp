// leak-guard.ts keeps a copy of snippet.ts's stop-word list (#359): this fails when they drift,
// so the guard and the snippet window always agree on what a content word is.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEAK_GUARD_STOPWORDS } from "./leak-guard.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("leak-guard stop words", () => {
  it("equal the STOPWORDS literal in src/semantic/snippet.ts", () => {
    const src = readFileSync(path.join(HERE, "../../../src/semantic/snippet.ts"), "utf8");
    const literal = /const STOPWORDS = new Set\(\s*\(([\s\S]*?)\)\s*\.split\(" "\)/.exec(src)?.[1];
    expect(literal).toBeDefined();
    const words = literal!
      .replace(/"\s*\+\s*"/g, "")
      .replace(/"/g, "")
      .trim()
      .split(" ")
      .map((w) => w.replace(/ё/g, "е"));
    expect([...LEAK_GUARD_STOPWORDS].sort()).toEqual([...new Set(words)].sort());
  });
});

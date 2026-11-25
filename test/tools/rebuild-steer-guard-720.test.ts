// #720 review: the phrase guard in rebuild-steer-720.test.ts misses a drifted copy of the
// rebuild steer (e.g. the original "Rebuild with calibre_build_index force=true" bug text). This
// guard flags every `calibre_build_index … force=true|force: true` in src/ outside the one
// source, except a short list of rebuilds of a COMPATIBLE index, pinned by count.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Every .ts file under src/, as [repo-relative path, source]. */
function srcFiles(root = "src"): [string, string][] {
  return readdirSync(root).flatMap((n) => {
    const p = path.join(root, n);
    if (statSync(p).isDirectory()) return srcFiles(p);
    return p.endsWith(".ts") ? [[p, readFileSync(p, "utf8")] as [string, string]] : [];
  });
}

// a force rebuild named within ~80 chars, across string concatenation and line breaks
const FORCE_REBUILD = /calibre_build_index[\s\S]{0,80}?(?:force=true|force: true)/g;

/** Legit force-rebuild mentions: none is an incompatible index, so a plain force build works. */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "src/tools/calibre_semantic_search.ts": {
    count: 4,
    reason: "a keyword-only index is compatible: a force rebuild adds the embeddings",
  },
  "src/domain/library-id-collision.ts": {
    count: 1,
    reason: "after the folder rename, the owner's compatible index is force-rebuilt to drop the other library's books",
  },
};

describe("no drifted copy of the rebuild steer in src/ (#720 review)", () => {
  it("names a force rebuild only in src/domain/index-steers.ts and the allowlisted files", () => {
    const found: Record<string, number> = {};
    for (const [p, src] of srcFiles()) {
      if (p === "src/domain/index-steers.ts") continue;
      const n = src.match(FORCE_REBUILD)?.length ?? 0;
      if (n > 0) found[p] = n;
    }
    const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([p, a]) => [p, a.count]));
    expect(found).toEqual(allowed);
  });
});

// "v1" now reads as the SDK era, so unimplemented-feature copy must not say "deferred in v1" (#306).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("stale 'deferred in v1' copy (#306)", () => {
  it.each(["calibre_find_duplicates", "calibre_quality_report"])("%s says 'not implemented yet'", (tool) => {
    const src = readFileSync(`src/tools/${tool}.ts`, "utf8");
    expect(src).not.toContain("deferred in v1");
    expect(src).toContain("not implemented yet");
  });
});

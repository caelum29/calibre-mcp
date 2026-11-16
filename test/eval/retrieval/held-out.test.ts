// The frozen held-out query set (#632): 20 fixture queries tuning scorers never read, reported
// apart. The ids were drawn once by folds.ts `stratifiedSample` (seed 0x358, stratified by kind,
// over the 66 non-diagnostic queries) and are pinned here: never re-drawn, never edited.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { heldOutIds, type GoldenQuery } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const queries = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as GoldenQuery[];

const FROZEN = [
  "fig-02",
  "fig-05",
  "figneg-01",
  "fmt-02",
  "fmt-06",
  "id-02",
  "id-06",
  "id-10",
  "idb-01",
  "neg-03",
  "neg-05",
  "ru-03",
  "ru-06",
  "sp-08",
  "sp-11",
  "sp-12",
  "sp-13",
  "spb-02",
  "xl-06",
  "xl-07",
];

describe("held-out set (#632)", () => {
  it("is exactly the 20 frozen ids", () => {
    expect([...heldOutIds()].sort()).toEqual(FROZEN);
  });

  it("has the declared per-kind counts", () => {
    const held = queries.filter((q) => q.heldOut === true);
    const counts: Record<string, number> = {};
    for (const q of held) counts[q.kind] = (counts[q.kind] ?? 0) + 1;
    expect(counts).toEqual({
      "semantic-paraphrase": 5,
      "exact-identifier": 4,
      "figure-caption": 2,
      "cross-lingual": 2,
      "ru-monolingual": 2,
      "front-matter-trap": 2,
      negative: 2,
      "figure-negative": 1,
    });
  });

  it("holds out no diagnostic query", () => {
    expect(queries.filter((q) => q.diagnostic === true && q.heldOut === true).map((q) => q.id)).toEqual([]);
  });

  it("uses only `true` as the flag value", () => {
    expect(queries.filter((q) => "heldOut" in q && q.heldOut !== true).map((q) => q.id)).toEqual([]);
  });
});

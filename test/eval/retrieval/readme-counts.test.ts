// Pins the golden-set counts that test/eval/README.md states against queries.json, so the next
// baseline re-freeze can't leave the README stale (#677). Also pins every baseline report path
// of thresholds.json and the fixture book count (#689).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.join(HERE, "..", "README.md"), "utf8");
const queries = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as {
  heldOut?: boolean;
}[];
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as {
  baselineReport: string;
  fusionOnly: { baselineReport: string };
  hashGate: { baselineReport: string };
};
const corpus = JSON.parse(readFileSync(path.join(HERE, "corpus.json"), "utf8")) as {
  books: unknown[];
};

describe("test/eval/README.md golden-set counts", () => {
  it("states the query count of queries.json in the intro and the Layout section", () => {
    const n = queries.length;
    expect(README).toContain(`runs ${n} labeled golden queries`);
    expect(README).toContain(`\`queries.json\` — ${n} golden queries`);
  });

  it("states the held-out count of queries.json", () => {
    const held = queries.filter((q) => q.heldOut === true).length;
    expect(README).toContain(`${held} fixture queries carry \`"heldOut": true\``);
  });

  it("names every baseline report that thresholds.json points at (#689)", () => {
    const baselines = {
      baselineReport: thresholds.baselineReport,
      "fusionOnly.baselineReport": thresholds.fusionOnly.baselineReport,
      "hashGate.baselineReport": thresholds.hashGate.baselineReport,
    };
    for (const [key, file] of Object.entries(baselines)) {
      expect(
        README.includes(file),
        `update test/eval/README.md: thresholds.json ${key} is now "${file}" but the README does not name it (rename the stale baseline there)`,
      ).toBe(true);
    }
  });

  it("names the current fusion-only baseline in the fusion-only pass paragraph (#689)", () => {
    const start = README.indexOf("second, **fusion-only pass**");
    expect(start, "README lost its fusion-only pass paragraph").toBeGreaterThan(-1);
    const paragraph = README.slice(start, README.indexOf("\n\n", start));
    const file = thresholds.fusionOnly.baselineReport;
    expect(
      paragraph.includes(file),
      `update test/eval/README.md: the fusion-only pass paragraph must name baseline "${file}" (thresholds.fusionOnly.baselineReport), not an older one`,
    ).toBe(true);
  });

  it("states the fixture book count of corpus.json (#689)", () => {
    const n = corpus.books.length;
    expect(
      README.includes(`${n} self-authored fixture "books"`),
      `update test/eval/README.md: corpus.json holds ${n} books; the Layout section must say \`${n} self-authored fixture "books"\``,
    ).toBe(true);
  });

  it("names every baselineReport anywhere in thresholds.json (#689)", () => {
    for (const file of collectBaselinePaths(thresholds)) {
      expect(
        README.includes(file),
        `update test/eval/README.md: thresholds.json names baseline "${file}" but the README does not`,
      ).toBe(true);
    }
  });

  it("collects baselineReport strings at any depth, so a new tier is not missed", () => {
    const synthetic = {
      baselineReport: "a.json",
      tier: { baselineReport: "b.json", deeper: [{ baselineReport: "c.json" }, { other: "x" }] },
      note: { baselineReport: 7 },
    };
    expect(collectBaselinePaths(synthetic)).toEqual(["a.json", "b.json", "c.json"]);
  });
});

/** Every string-valued `baselineReport` in a JSON tree, at any depth, in document order. */
function collectBaselinePaths(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectBaselinePaths);
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) =>
    k === "baselineReport" && typeof v === "string" ? [v] : collectBaselinePaths(v),
  );
}

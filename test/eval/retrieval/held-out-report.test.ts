// The held-out section every fixture `pnpm eval` run prints and writes to its md report (#632):
// per mode n, Hit@1 and nDCG@10 over the frozen held-out queries, each with a 95% percentile
// bootstrap interval (a set of 20 is noisy, so the interval is part of the number).

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EvalReport, PerQueryRow, QueryKind } from "./harness.js";
import { hashEmbedder } from "./hash-embedder.js";
import { heldOutLines } from "./held-out.js";
import { parseArgs, runPass } from "./run.js";

function row(id: string, kind: QueryKind, over: Partial<PerQueryRow>): PerQueryRow {
  return { id, kind, scope: "library", mode: "hybrid", ru: false, retrieved: [], ...over };
}
const m = (hit1: number, ndcg10: number) => ({ metrics: { hit1, recall5: 1, rr: hit1, ndcg10 } });

const report = (live: boolean): EvalReport =>
  ({
    meta: { modes: ["hybrid"], live },
    perQuery: [
      row("sp-08", "semantic-paraphrase", m(1, 1)), // held out
      row("xl-06", "cross-lingual", m(0, 0.5)), // held out
      row("sp-01", "semantic-paraphrase", m(0, 0)), // not held out
      row("neg-03", "negative", { flagged: true }), // held out
      row("figneg-01", "figure-negative", { flagged: false }), // held out
      row("neg-01", "negative", { flagged: false }), // not held out
    ],
  }) as unknown as EvalReport;

describe("heldOutLines", () => {
  it("reports n, Hit@1 and nDCG@10 with bootstrap intervals over the held-out rows only", () => {
    expect(heldOutLines(report(false))).toEqual([
      "held-out (#632): 28 frozen queries, report-only; 95% percentile bootstrap CI (seed 0x358)",
      "held-out hybrid: n 2, Hit@1 0.500 [0.000, 1.000], nDCG@10 0.750 [0.500, 1.000]; negatives flagged 1/2",
    ]);
  });

  it("prints nothing for a live run (live labels are another set)", () => {
    expect(heldOutLines(report(true))).toEqual([]);
  });
});

describe("runPass prints and writes the held-out section", () => {
  it("stdout and the md report carry it on a fixture run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eval-heldout-"));
    const args = parseArgs([
      "--modes",
      "keyword",
      "--rerank",
      "off",
      "--work-dir",
      dir,
      "--out-dir",
      dir,
      "--tag",
      "h",
    ]);
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
    let mdPath = "";
    try {
      ({ mdPath } = await runPass(args, {
        rerankOff: true,
        tag: "h",
        protectedPaths: [],
        deps: { embedder: hashEmbedder, log: () => {} },
      }));
    } finally {
      write.mockRestore();
    }
    const stdout = out.join("");
    expect(stdout).toMatch(
      /^held-out keyword: n 23, Hit@1 \d\.\d{3} \[\d\.\d{3}, \d\.\d{3}\], nDCG@10 .*negatives flagged \d\/5$/m,
    );
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("## Held-out (#632)");
    expect(md).toMatch(/^held-out keyword: n 23, /m);
  }, 30_000);
});

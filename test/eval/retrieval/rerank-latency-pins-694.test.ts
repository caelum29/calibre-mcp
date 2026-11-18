// #694 (from #682): the pre-registered `thresholds.rerankLatency` protocol and quality baseline are
// pinned value by value, like its rule numbers, so an edit after the fact fails here instead of
// passing the gate-guards shape check.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const block = (JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Record<string, unknown>)
  .rerankLatency as { protocol: Record<string, string>; qualityBaseline: Record<string, string> };

describe("rerankLatency decided values (#694 / #682)", () => {
  it("should_keep_the_protocol_steps_declared_before_the_arms_ran", () => {
    expect(Object.keys(block.protocol)).toEqual([
      "$comment",
      "machine",
      "index",
      "warm",
      "cold",
      "order",
      "driftCheck",
      "judging",
      "report",
    ]);
  });

  it("should_keep_the_row_order_and_the_drift_rule", () => {
    expect([block.protocol.order, block.protocol.driftCheck]).toEqual([
      "baseline first, then the candidate arms, then any combination row, then the pool50 reference, then baseline again.",
      "If the two baseline rows' warm medians differ by more than 10%, the session is discarded and re-run.",
    ]);
  });

  it("should_keep_the_warm_and_cold_protocol", () => {
    expect([block.protocol.warm, block.protocol.cold]).toEqual([
      "Per arm: a fresh in-process server; 3 warm-up queries outside the judged set (discarded) so both models are loaded and the candidate cache is built; then the 120 pre-registered judged queries one at a time (parallel calls share the CPU and skip the rerank with RERANKER_BUSY). The rule reads warm numbers.",
      "Per arm: 5 fresh processes, first call only, reported per stage; not read by the rule.",
    ]);
  });

  it("should_name_the_quality_baseline_run", () => {
    const { $comment: _comment, ...named } = block.qualityBaseline;
    expect(named).toEqual({
      runId: "semantic-judged-blind-2026-11",
      dumpedAt: "b7ad7d4, 2026-11-16",
      judgedBy: "judged-blind Workflow wf_6ac2641c-e8c, judges A = opus, B = sonnet",
      queries: "120 pre-registered queries (queries.json sha256 efaa88b1...86e2), 110 positives",
      store: "docs/dev/evals/judgments/3f335e5122b8.jsonl (736 records at the 2026-11-17 wave start)",
    });
  });
});

// Allow-file hygiene for the top-10 list diff (#387 review): a stale entry fails the gate, and
// malformed or duplicate entries are rejected up front before any eval pass runs.

import { describe, expect, it } from "vitest";
import { evaluateListDiff, type AllowEntry } from "./gate.js";
import { loadAllowEntries } from "./gate-guards.js";
import type { EvalReport, PerQueryRow } from "./harness.js";

const TOP = ["105", "101", "102"];
const row = (id: string, retrieved: string[]): PerQueryRow => ({
  id,
  kind: "semantic-paraphrase",
  scope: "library",
  mode: "hybrid",
  ru: false,
  retrieved,
});
const report = (rows: PerQueryRow[]): EvalReport =>
  ({
    meta: { modes: ["hybrid"] },
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: rows,
  }) as unknown as EvalReport;

describe("stale allow entries", () => {
  it("fail the gate with a delete instruction when they allow no current change", () => {
    const base = report([row("sp-01", TOP)]);
    const allow: AllowEntry[] = [
      { tier: "on", mode: "hybrid", id: "sp-01", retrieved: ["101", "105", "102"], reason: "old change" },
    ];
    const res = evaluateListDiff(base, base, { tier: "on", topK: 10, allow });
    expect(res.pass).toBe(false);
    expect(res.checks[1]).toEqual({
      name: "allow-file entries (on)",
      active: true,
      pass: false,
      detail: "1 entries, 1 stale (allow no current change — delete them): hybrid/sp-01",
    });
  });

  it("an entry that is used is not stale", () => {
    const allow: AllowEntry[] = [
      { tier: "on", mode: "hybrid", id: "sp-01", retrieved: ["101", "105", "102"], reason: "intended" },
    ];
    const res = evaluateListDiff(report([row("sp-01", ["101", "105", "102"])]), report([row("sp-01", TOP)]), {
      tier: "on",
      topK: 10,
      allow,
    });
    expect(res.pass).toBe(true);
    expect(res.checks[1]!.detail).toBe("1 entries, all with a reason");
  });
});

describe("loadAllowEntries shape validation", () => {
  const cfg = { topK: 10, allowFile: "list-diff-allow.json" };
  const load = (entries: unknown[]) => () => loadAllowEntries(cfg, () => JSON.stringify({ entries }));
  const ok = { tier: "on", mode: "hybrid", id: "sp-01", retrieved: ["101"], reason: "x" };

  it("accepts a well-formed entry", () => {
    expect(load([ok])()).toEqual([ok]);
  });
  it("rejects a missing reason", () => {
    const { reason: _r, ...e } = ok;
    expect(load([e])).toThrow("list-diff-allow.json entry #0: reason must be a string");
  });
  it("rejects a missing retrieved list", () => {
    const { retrieved: _r, ...e } = ok;
    expect(load([e])).toThrow("list-diff-allow.json entry #0: retrieved must be an array of result keys");
  });
  it("rejects an unknown tier", () => {
    expect(load([{ ...ok, tier: "nightly" }])).toThrow(
      "list-diff-allow.json entry #0: tier must be one of on, fusionOnly, hash",
    );
  });
  it("rejects an unknown mode", () => {
    expect(load([{ ...ok, mode: "bm25" }])).toThrow(
      "list-diff-allow.json entry #0: mode must be one of hybrid, vector, keyword",
    );
  });
  it("rejects an empty id", () => {
    expect(load([{ ...ok, id: "" }])).toThrow("list-diff-allow.json entry #0: id must be a non-empty string");
  });
  it("rejects a non-object entry", () => {
    expect(load(["sp-01"])).toThrow("list-diff-allow.json entry #0: must be an object");
  });
  it("rejects duplicate (tier, mode, id) entries instead of last-wins", () => {
    expect(load([ok, { ...ok, retrieved: ["102"] }])).toThrow(
      "list-diff-allow.json entry #1: duplicate entry for on/hybrid/sp-01",
    );
  });
  it("the same id in another tier is not a duplicate", () => {
    expect(load([ok, { ...ok, tier: "hash" }])()).toHaveLength(2);
  });
});

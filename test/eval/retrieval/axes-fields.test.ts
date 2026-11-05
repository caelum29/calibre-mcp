// #408 review: literal fixtures for the #363 row fields (spanHit, snippetHasMarker,
// lowConfidence) and the confidence axis on pre-#363 reports that lack lowConfidence/top2Rerank.

import { describe, expect, it } from "vitest";
import { computeAxes, renderAxes } from "./axes.js";
import { localise, toRow, type EvalReport, type GoldenQuery, type PerQueryRow, type SpanLabel } from "./harness.js";

const LABEL: SpanLabel = { bookId: 101, charStart: 1000, charEnd: 1100, marker: "MARKER-X" };
const FILLER = "Lorem ipsum dolor sit amet, filler words only here. ".repeat(12); // ~624 chars, no query terms

/** A passage at [start, start + body.length). */
const passage = (charStart: number, body: string) => ({ hit: { charStart, charEnd: charStart + body.length, body } });

describe("localise (book-scope span hit + snippet window)", () => {
  it("the marker right after the query term sits inside the snippet window → true", () => {
    const body = `Raft consensus elects a leader MARKER-X. ${FILLER}`;
    expect(localise([passage(990, body)], [LABEL], "raft consensus")).toEqual({ spanHit: 1, snippetHasMarker: true });
  });

  it("the marker far from the query term falls outside the 320-char window → false", () => {
    const body = `Raft consensus elects a leader. ${FILLER} MARKER-X`;
    expect(localise([passage(500, body)], [LABEL], "raft consensus")).toEqual({ spanHit: 1, snippetHasMarker: false });
  });

  it("the second of two passages holds the marker → spanHit 2", () => {
    const hits = [passage(0, "Raft without the label."), passage(1000, "Raft consensus MARKER-X.")];
    expect(localise(hits, [LABEL], "raft")).toEqual({ spanHit: 2, snippetHasMarker: true });
  });

  it("a passage with the marker text but outside the labelled span doesn't count", () => {
    expect(localise([passage(5000, "Raft MARKER-X")], [LABEL], "raft")).toEqual({ spanHit: null });
  });
});

describe("toRow lowConfidence", () => {
  const q = { id: "q", kind: "semantic-paraphrase", scope: "library", query: "x", relevant: [101] } as GoldenQuery;
  const out = (lowConfidence: boolean | undefined, count: number) => ({
    rel: { matches: [["book-101"]], relevantCount: 1 },
    retrieved: ["101"],
    count,
    ...(lowConfidence !== undefined ? { lowConfidence } : {}),
  });

  it("a flagged positive → lowConfidence true", () => {
    expect(toRow(q, "hybrid", out(true, 1)).lowConfidence).toBe(true);
  });

  it("an unflagged positive → lowConfidence false", () => {
    expect(toRow(q, "hybrid", out(false, 1)).lowConfidence).toBe(false);
  });

  it("no results → no lowConfidence field (the tool sends none)", () => {
    expect("lowConfidence" in toRow(q, "hybrid", out(undefined, 0))).toBe(false);
  });
});

describe("confidence axis on a pre-#363 report (no lowConfidence / top2Rerank)", () => {
  const row = (id: string, hit1: number, maxRerank: number): PerQueryRow => ({
    id,
    kind: "semantic-paraphrase",
    scope: "library",
    mode: "hybrid",
    ru: false,
    retrieved: [],
    maxRerank,
    metrics: { hit1, recall5: hit1, rr: hit1, ndcg10: hit1 },
  });
  const old: EvalReport = {
    meta: { modes: ["hybrid"] } as EvalReport["meta"],
    overall: {},
    ruInvolved: {},
    byKind: {},
    negatives: {},
    figureNegatives: {},
    perQuery: [row("a", 1, 0.9), row("b", 0, 0.2)],
  };
  const c = computeAxes(old).hybrid!.confidence!;

  it("false-flag and margin count only rows that carry the field", () => {
    expect([c.n, c.hit1Positives, c.falseFlagged, c.marginN, c.aucMaxRerank]).toEqual([2, 0, 0, 0, 1]);
    expect(c.aucMargin).toBeNaN();
  });

  it("renders n/a instead of 0/N or a margin that is really maxRerank", () => {
    const lines = renderAxes(computeAxes(old), { confidence: { gate: false, trend: "t" } });
    expect(lines).toContain(
      "    hybrid: false-flag n/a (no lowConfidence), AUC maxRerank 1.000, AUC margin n/a (no top2Rerank) (n=2)",
    );
  });

  it("a partial margin says over how many rows", () => {
    const mixed = { ...old, perQuery: [{ ...old.perQuery[0]!, top2Rerank: 0.1 }, old.perQuery[1]!] };
    const lines = renderAxes(computeAxes(mixed), { confidence: { gate: false, trend: "t" } });
    expect(lines).toContain(
      "    hybrid: false-flag n/a (no lowConfidence), AUC maxRerank 1.000, AUC margin n/a (m=1) (n=2)",
    );
  });
});

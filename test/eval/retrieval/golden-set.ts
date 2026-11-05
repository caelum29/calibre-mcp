// Golden-set hash (#392 decision 2, thresholds.goldenSet): every frozen baseline records which
// queries.json it was measured on, so a relevance-label edit that leaves every top-10 list
// identical still fails the gate instead of silently re-defining "correct".

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, refreezeHint, type GateResult, type ListDiffTier } from "./gate.js";
import type { EvalReport } from "./harness.js";

const QUERIES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "queries.json");

/**
 * `sha256:<hex>` of the canonical golden set: queries.json parsed and re-serialized, so a
 * reformat keeps the hash while any query, kind or relevance-label change moves it.
 */
export function goldenSetHash(queriesJson: string): string {
  const canonical = JSON.stringify(JSON.parse(queriesJson));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** Hash of the committed queries.json — what the harness stamps into every fixture report. */
export function currentGoldenSetHash(): string {
  return goldenSetHash(readFileSync(QUERIES_PATH, "utf8"));
}

const short = (h: string) => `${h.slice(0, 19)}…`;

/**
 * One active check: the run's golden set must be the one the baseline was frozen on. A baseline
 * without a hash fails too: it can't prove which labels its Hit@1/list rows were scored against.
 */
export function evaluateGoldenSet(current: EvalReport, baseline: EvalReport, tier: ListDiffTier): GateResult {
  const was = baseline.meta.goldenSetHash;
  const now = current.meta.goldenSetHash;
  const detail = !was
    ? `baseline has no golden-set hash; ${refreezeHint(tier)}`
    : !now
      ? `current run has no golden-set hash (live run?); compare fixture runs only`
      : was === now
        ? `matches baseline (${short(was)})`
        : `baseline ${short(was)} ≠ current ${short(now)} — queries.json or its relevance labels changed since the freeze; ${refreezeHint(tier)}`;
  return gateResult(
    [{ name: `golden set (${tier})`, active: true, pass: Boolean(was && now && was === now), detail }],
    [],
  );
}

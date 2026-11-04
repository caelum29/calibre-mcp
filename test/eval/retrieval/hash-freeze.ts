// Freezes hash-baseline.json for the tier-0 gate (#357): one hash-embedder run, all modes,
// written as per-query ranks. Run only after the thresholds.json hashGate rule is committed (D-012).
//
// Usage: pnpm eval:hash-freeze

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHashEval, toRankBaseline } from "./hash-gate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = execSync("git rev-parse --short HEAD", { cwd: HERE, encoding: "utf8" }).trim();
const out = path.join(HERE, "hash-baseline.json");

const report = await runHashEval({ gitSha: sha });
writeFileSync(out, JSON.stringify(toRankBaseline(report), null, 2) + "\n");
process.stderr.write(`[hash-freeze] wrote ${out} (${report.perQuery.length} rows, git ${sha})\n`);

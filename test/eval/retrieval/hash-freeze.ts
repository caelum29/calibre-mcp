// Freezes hash-baseline.json for the tier-0 gate (#357) in one command (#392 decision 1): one
// hash-embedder run, all modes, written as per-query ranks + the golden-set hash; hash-tier
// allow entries the new baseline makes stale are dropped. Run only after any thresholds.json
// rule change is committed (D-012): it refuses while thresholds.json has uncommitted changes and
// records `<sha>-dirty` when other files do.
//
// Usage: pnpm eval:hash-freeze

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Thresholds } from "./gate.js";
import { freezeTreeCheck, pruneHashAllowEntries } from "./hash-freeze-lib.js";
import { runHashEval, toRankBaseline } from "./hash-gate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const log = (msg: string) => process.stderr.write(`[hash-freeze] ${msg}\n`);
const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: HERE, encoding: "utf8" });
const root = git("rev-parse --show-toplevel").trim();
const tree = freezeTreeCheck(
  execSync("git status --porcelain", { cwd: root, encoding: "utf8" }),
  git("rev-parse --short HEAD").trim(),
);
if (tree.refuse) {
  log(`REFUSED: ${tree.refuse}`);
  process.exit(1);
}
// the recorded sha must name the tree the ranks came from
if (tree.dirty.length) log(`WARNING: dirty tree, recording gitSha ${tree.gitSha}: ${tree.dirty.join(", ")}`);
const sha = tree.gitSha;
const thresholds = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8")) as Thresholds;
const out = path.join(HERE, thresholds.hashGate?.baselineReport ?? "hash-baseline.json");

const report = await runHashEval({ gitSha: sha });
writeFileSync(out, JSON.stringify(toRankBaseline(report), null, 2) + "\n");
log(`wrote ${out} (${report.perQuery.length} rows, git ${sha}, golden set ${report.meta.goldenSetHash})`);

if (thresholds.listDiff) {
  const allowPath = path.join(HERE, thresholds.listDiff.allowFile);
  const { file, removed } = pruneHashAllowEntries(JSON.parse(readFileSync(allowPath, "utf8")));
  if (removed.length) {
    writeFileSync(allowPath, JSON.stringify(file, null, 2) + "\n");
    log(`dropped ${removed.length} hash-tier allow entries now in the baseline: ${removed.join(", ")}`);
  }
}

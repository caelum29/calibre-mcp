// Blind judged eval, step 4: compare two judged runs of one query set, both graded from the judgment
// store. Prints per-mode paired NDCG@5 / hit@5 rows (bootstrap CI, permutation p, sign test, MDE) plus
// both run names and the query-set and store sha256, so re-running on the same store snapshot reproduces it.
// Run: pnpm eval:judged:compare <runA> <runB> --store <file> [--strict-text] — #361
// Exit 1 = refused (different query sets, or unjudged hits in a top 5 — the message names the fix).

import { readFileSync } from "node:fs";
import { compareJudgedRuns, compareRefusal, renderJudgedCompare } from "./judged-compare-lib.js";
import { loadRunDir, querySetHash, readStore, sha256, storePathError } from "./judged-store.js";

const argv = process.argv.slice(2);
const storeIdx = argv.indexOf("--store");
const storeFile = storeIdx >= 0 ? argv[storeIdx + 1] : undefined;
const [dirA, dirB] = argv.filter((x, i) => !x.startsWith("--") && i !== storeIdx + 1);
if (!dirA || !dirB || !storeFile) {
  process.stderr.write("usage: pnpm eval:judged:compare <runA> <runB> --store <file> [--strict-text]\n");
  process.exit(2);
}
const opts = { strictText: argv.includes("--strict-text") };

const [a, b] = [loadRunDir(dirA), loadRunDir(dirB)];
const store = readStore(storeFile);
// query set first, then the store's name (a wrong store would only show up as holes everywhere), then holes
const sameSet = querySetHash(a.queriesJson) === querySetHash(b.queriesJson);
const pathError = sameSet ? storePathError(storeFile, a.queriesJson) : undefined;
const refusal = pathError ? `refusing: ${pathError}` : compareRefusal(a, b, store, storeFile, opts);
if (refusal) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}

const report = renderJudgedCompare(compareJudgedRuns(a, b, store, opts), {
  a: a.name,
  b: b.name,
  querySetSha256: querySetHash(a.queriesJson),
  storeFile,
  storeSha256: sha256(readFileSync(storeFile, "utf8")),
  records: store.length,
});
process.stdout.write(`${report}\n`);

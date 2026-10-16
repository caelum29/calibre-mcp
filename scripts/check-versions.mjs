#!/usr/bin/env node
// Fails if any shipped manifest disagrees with package.json — the single source of truth
// for the version (src/version.ts reads it at runtime). Run before publishing
// (prepublishOnly) and in CI: the release must ship the versions that are in the commit,
// not ones patched in by the release job.
//
//   node scripts/check-versions.mjs
//
// Diagnostics go to stderr. Exit 0 = all aligned, 1 = drift.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

const pkg = read("package.json");
const server = read("server.json");
const manifest = read("manifest.json");
const plugin = read(".claude-plugin/plugin.json");
const marketplace = read(".claude-plugin/marketplace.json");

/** [what, actual, expected] */
const checks = [
  ["server.json version", server.version, pkg.version],
  ["server.json packages[0].version", server.packages?.[0]?.version, pkg.version],
  ["server.json name (== package.json mcpName)", server.name, pkg.mcpName],
  ["server.json packages[0].identifier (== package.json name)", server.packages?.[0]?.identifier, pkg.name],
  ["manifest.json version", manifest.version, pkg.version],
  [
    "manifest.json compatibility.runtimes.node (== engines.node)",
    manifest.compatibility?.runtimes?.node,
    pkg.engines?.node,
  ],
  [".claude-plugin/plugin.json version", plugin.version, pkg.version],
];
// marketplace.json entries carry no version today; check any that start to.
for (const [i, entry] of (marketplace.plugins ?? []).entries()) {
  if (entry.version !== undefined) {
    checks.push([`.claude-plugin/marketplace.json plugins[${i}].version`, entry.version, pkg.version]);
  }
}

const bad = checks.filter(([, actual, expected]) => actual !== expected);
for (const [what, actual, expected] of bad) {
  process.stderr.write(`x ${what} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
}
if (bad.length > 0) process.exit(1);
process.stderr.write(`ok: ${checks.length} manifest fields aligned with package.json ${pkg.version}\n`);

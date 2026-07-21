// Build the Claude Desktop one-click bundle (.mcpb). Stages a curated copy of the
// package in build/mcpb because `mcpb pack` zips node_modules verbatim — pnpm's
// symlinked layout can't be zipped, so the staging dir gets a real `npm install`.
// Embeddings (@huggingface/transformers) are EXCLUDED to keep the bundle small
// (DISTRIBUTION: opt-in); npx users get them via optionalDependencies instead.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staging = path.join(root, "build", "mcpb");
const outDir = path.join(root, "dist-mcpb");

const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
if (pkg.version !== manifest.version) {
  console.error(
    `version mismatch: package.json ${pkg.version} != manifest.json ${manifest.version}`,
  );
  process.exit(1);
}

// --dev: stamp a `X.Y.Z-dev.<short-sha>[.dirty]` version into the STAGED copies only
// (repo files untouched), so a test bundle is never confused with the released one.
const devMode = process.argv.includes("--dev");
let version = pkg.version;
if (devMode) {
  const sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
  const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim() ? ".dirty" : "";
  version = `${pkg.version}-dev.${sha}${dirty}`;
  console.log(`dev bundle version: ${version}`);
}

run("pnpm build");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// Curated bundle contents; node_modules is materialized by npm below.
cpSync(path.join(root, "dist"), path.join(staging, "dist"), { recursive: true });
mkdirSync(path.join(staging, "scripts"));
cpSync(
  path.join(root, "scripts", "pymupdf_extract.py"),
  path.join(staging, "scripts", "pymupdf_extract.py"),
);
for (const f of ["manifest.json", "package.json", "LICENSE", "README.md"]) {
  if (existsSync(path.join(root, f))) cpSync(path.join(root, f), path.join(staging, f));
}

// Dev mode: rewrite the staged manifest + package.json versions (Desktop shows the
// manifest version in Extensions, so `-dev.<sha>` is visible at a glance).
if (devMode) {
  for (const f of ["package.json", "manifest.json"]) {
    const p = path.join(staging, f);
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.version = version;
    writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  }
}

// Real (non-symlinked) prod deps, minus the optional embeddings stack.
run("npm install --omit=dev --omit=optional --no-audit --no-fund --no-package-lock", staging);

mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `calibre-mcp-${version}.mcpb`);
rmSync(out, { force: true });
run(`npx --yes @anthropic-ai/mcpb@2.1.2 pack "${staging}" "${out}"`);

const mb = (statSync(out).size / (1024 * 1024)).toFixed(1);
console.log(`\npacked ${out} (${mb} MB)`);

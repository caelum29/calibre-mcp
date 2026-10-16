#!/usr/bin/env node
// Generates docs/tool-catalog.json — the exact tools/list a client receives — and keeps every
// tool count stated in the docs and manifests in sync with it.
//
//   node scripts/gen-tool-catalog.mjs           # rewrite the catalog + count sites
//   node scripts/gen-tool-catalog.mjs --check   # exit 1 on any drift, write nothing
//
// Requires a build (imports dist/). The server is built with writes ENABLED so the gated
// tools are advertised, with the boot probes OFF and a fixed env, so nothing spawns, nothing
// hits the network and nothing reads a library. tools/list goes through the real SDK Client
// over an in-memory transport, then through the same wire-compat rewrite the stdio transport
// applies — so the catalog is the wire form, not the registry's view of it.
//
// Counts maintained (see COUNT_SITES):
//   registered   every tool in tools/list (writes enabled, widget debug off)
//   modelFacing  registered minus app-only tools (_meta.ui.visibility without "model")
//   appOnly      the widget-internal tools hosts hide from the model
//   task         modelFacing minus calibre_ping (the health check)
// Markdown body text uses <!-- tool-count:KIND -->N<!-- /tool-count:KIND --> markers;
// JSON strings, YAML front matter, headings and shell defaults use an anchored regex.
//
// Diagnostics go to stderr.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = "docs/tool-catalog.json";
const check = process.argv.includes("--check");
const err = (msg) => process.stderr.write(`${msg}\n`);

if (!existsSync(path.join(root, "dist", "server.js"))) {
  err("dist/ is missing — run `pnpm build` first (or `pnpm catalog`).");
  process.exit(1);
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { buildServer } = await import("../dist/server.js");
const { stripOutputSchemaDollarSchema } = await import("../dist/wire-compat.js");

// A fixed env: the catalog must not depend on the developer's shell (e.g. a local
// CALIBRE_MCP_WIDGET_DEBUG would register the debug-only widget log tool). The server URL
// is unroutable and the calibredb path explicit, so config loading probes nothing.
const env = {
  CALIBRE_MCP_ENABLE_WRITE: "1",
  CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
  CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
  CALIBRE_MCP_INDEX_DIR: ":memory:",
};

async function listTools() {
  const server = buildServer({ env, probes: false });
  const client = new Client({ name: "tool-catalog", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.listTools();
    stripOutputSchemaDollarSchema(result);
    return result.tools;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

/** Recursively sort object keys (arrays keep their order) for a stable, diffable file. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

const isAppOnly = (tool) => {
  const visibility = tool._meta?.ui?.visibility;
  return Array.isArray(visibility) && !visibility.includes("model");
};

const tools = (await listTools()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const appOnly = tools.filter(isAppOnly).map((t) => t.name);
const modelFacing = tools.filter((t) => !isAppOnly(t)).map((t) => t.name);
const counts = {
  registered: tools.length,
  modelFacing: modelFacing.length,
  appOnly: appOnly.length,
  task: modelFacing.filter((n) => n !== "calibre_ping").length,
};

const catalogText = `${JSON.stringify({ counts, tools: canonical(tools) }, null, 2)}\n`;

/** One place in the repo that states a tool count. `re` has exactly one capture group. */
const marker = (kind) => new RegExp(`(?<=<!-- tool-count:${kind} -->)(\\d+)(?=<!-- /tool-count:${kind} -->)`, "g");
const COUNT_SITES = [
  { file: "README.md", kind: "modelFacing", re: marker("modelFacing") },
  { file: "docs/TOOLS.md", kind: "modelFacing", re: marker("modelFacing") },
  { file: "docs/TOOLS.md", kind: "appOnly", re: marker("appOnly") },
  { file: "CLAUDE.md", kind: "modelFacing", re: marker("modelFacing") },
  { file: "CLAUDE.md", kind: "task", re: marker("task") },
  { file: "CLAUDE.md", kind: "appOnly", re: marker("appOnly") },
  { file: ".claude-plugin/plugin.json", kind: "modelFacing", re: /(?<=metadata curation — )(\d+)(?= tools\))/g },
  { file: ".claude-plugin/marketplace.json", kind: "modelFacing", re: /(?<=metadata curation — )(\d+)(?= tools\))/g },
  { file: "skills/calibre-mcp/SKILL.md", kind: "modelFacing", re: /(?<=the calibre-mcp server \()(\d+)(?= tools\))/g },
  { file: "skills/calibre-mcp/SKILL.md", kind: "task", re: /(?<=^## Tool map \()(\d+)(?=\)$)/gm },
  { file: "scripts/demo-gif.sh", kind: "modelFacing", re: /(?<=…and )(\d+)(?= tools in total)/g },
  {
    file: "src/tools/registry.ts",
    kind: "task",
    re: /(?<=model-facing surface stays at )(\d+)(?= tools \(\+ ping\))/g,
  },
];

const drift = [];
const writes = new Map(); // file -> new text

const catalogPath = path.join(root, CATALOG);
const prevCatalog = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
if (prevCatalog !== catalogText) {
  drift.push(`${CATALOG} is stale`);
  writes.set(CATALOG, catalogText);
}

for (const site of COUNT_SITES) {
  const file = path.join(root, site.file);
  const text = writes.get(site.file) ?? readFileSync(file, "utf8");
  const want = String(counts[site.kind]);
  const found = [...text.matchAll(site.re)].map((m) => m[1]);
  if (found.length === 0) {
    drift.push(`${site.file}: no ${site.kind} tool-count site found (pattern ${site.re})`);
    continue;
  }
  const wrong = found.filter((n) => n !== want);
  if (wrong.length > 0) {
    drift.push(`${site.file}: ${site.kind} tool count says ${wrong.join(", ")}, catalog has ${want}`);
    writes.set(site.file, text.replace(site.re, want));
  }
}

// manifest.json (MCPB) lists the model-facing tools by name with hand-written blurbs; the
// generator cannot write the blurbs, so it only checks the name set.
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const manifestNames = (manifest.tools ?? []).map((t) => t.name).sort();
const missing = modelFacing.filter((n) => !manifestNames.includes(n));
const extra = manifestNames.filter((n) => !modelFacing.includes(n));
if (missing.length > 0 || extra.length > 0) {
  drift.push(
    `manifest.json tools[] != model-facing tools (missing: ${missing.join(", ") || "none"}; ` +
      `extra: ${extra.join(", ") || "none"}) — edit by hand`,
  );
}

if (check) {
  if (drift.length > 0) {
    for (const d of drift) err(`x ${d}`);
    err("Run `pnpm catalog` to regenerate.");
    process.exit(1);
  }
  err(`ok: ${CATALOG} and ${COUNT_SITES.length} tool-count sites match (${JSON.stringify(counts)})`);
  process.exit(0);
}

for (const [rel, text] of writes) writeFileSync(path.join(root, rel), text);
for (const d of drift) err(`${writes.size > 0 ? "fixed" : "!"}: ${d}`);
const manual = drift.filter((d) => d.includes("edit by hand") || d.includes("no "));
if (manual.length > 0) process.exit(1);
err(`ok: ${CATALOG} written (${JSON.stringify(counts)}); ${writes.size} file(s) updated`);

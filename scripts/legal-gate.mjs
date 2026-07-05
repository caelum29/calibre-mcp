#!/usr/bin/env node
// D1.4 legal-gate CLI — runs the mechanical verifier (src/domain/distill/legal-gate.ts) over a
// generated distill skill dir against its source books' extracted text. Reads the shareable
// files + distill.manifest.yaml, pulls each source's text via the Content Server + Extractor,
// detects chapters, and prints a per-check PASS/FAIL report. Writes nothing. Exit 0 = all pass.
//
//   node scripts/legal-gate.mjs <skill-dir> --book <id> [--book <id>…]
//
// Requires a build (imports from dist/). All diagnostics go to stderr; only the report is on
// stdout. Book ids are given explicitly (--book); manifest ISBNs supply the shingle allowlist.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { ContentServerClient } from "../dist/calibre/content-server.js";
import { Extractor } from "../dist/calibre/extract.js";
import { chooseExtractFormat } from "../dist/calibre/extract.js";
import { detectChapters } from "../dist/domain/structure/chapters.js";
import { runLegalGate, estimateTokens, extractProse } from "../dist/domain/distill/legal-gate.js";

const err = (...a) => process.stderr.write(a.join(" ") + "\n");

function parseArgs(argv) {
  const books = [];
  let dir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--book") books.push(Number(argv[++i]));
    else if (!dir) dir = argv[i];
  }
  return { dir, books };
}

/** Collect ATX headings from a markdown string. */
function headings(md) {
  const out = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * Best-effort allowlist from the manifest: every title / author / edition-note / work value
 * (the D1.7 finding-a exemption — bibliography reprints these verbatim). Zero-dep line scan,
 * not a full YAML parse.
 */
function allowlistFromManifest(yaml) {
  const phrases = [];
  for (const raw of yaml.split("\n")) {
    const m = /^\s*(title|authors|topic|work|edition_note|fallback_key):\s*(.+)$/.exec(raw);
    if (!m) continue;
    const val = m[2].trim();
    // Pull every quoted string; fall back to the bare value.
    const quoted = [...val.matchAll(/["']([^"']+)["']/g)].map((q) => q[1]);
    if (quoted.length) phrases.push(...quoted);
    else phrases.push(val.replace(/^[[\]]+|[[\]]+$/g, ""));
  }
  return phrases.filter(Boolean);
}

async function extractBook(deps, id) {
  const book = await deps.content.getBook(id);
  const fmt = chooseExtractFormat(book.formats);
  if (!fmt) throw new Error(`book ${id} has no extractable format`);
  const libId = await deps.content.resolveLibraryId();
  const base = deps.config.serverUrl.replace(/\/+$/, "");
  const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${id}/${encodeURIComponent(libId)}`;
  const cacheKey = `${id}:${fmt}:${book.lastModified ?? ""}`;
  const { text } = await deps.extractor.getText({ bookId: id, format: fmt, downloadUrl, cacheKey });
  return { book, text };
}

async function main() {
  const { dir, books } = parseArgs(process.argv.slice(2));
  if (!dir) {
    err("usage: node scripts/legal-gate.mjs <skill-dir> --book <id> [--book <id>…]");
    process.exit(2);
  }
  if (books.length === 0) err("warning: no --book ids given; shingle/compression run against 0 sources");

  const config = loadConfig();
  const deps = { config, content: new ContentServerClient(config), extractor: new Extractor(config) };

  // Shareable markdown files (skip the provenance manifest). Only .md is shareable.
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const skillText = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n\n");
  const skillHeadings = files.flatMap((f) => headings(readFileSync(path.join(dir, f), "utf8")));

  let allowlist = [];
  try {
    allowlist = allowlistFromManifest(readFileSync(path.join(dir, "distill.manifest.yaml"), "utf8"));
    err(`manifest allowlist: ${allowlist.length} phrase(s)`);
  } catch {
    err("no distill.manifest.yaml — running with an empty allowlist");
  }

  err(`extracting ${books.length} source book(s) via ${config.serverUrl} …`);
  const sources = [];
  const detectedChapters = [];
  for (const id of books) {
    try {
      const { book, text } = await extractBook(deps, id);
      sources.push({ label: `book ${id} (${book.title})`, text });
      const { chapters } = detectChapters(text);
      for (const c of chapters) detectedChapters.push(c.heading);
      err(`  book ${id}: ${text.length} chars, ${chapters.length} chapters`);
    } catch (e) {
      err(`  book ${id}: extraction failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const skillTokens = estimateTokens(extractProse(skillText));
  const sourceTokensRead = sources.reduce((n, s) => n + estimateTokens(s.text), 0);

  const result = runLegalGate({
    skillText,
    sources,
    allowlist,
    skillHeadings,
    detectedChapters,
    skillTokens,
    sourceTokensRead,
  });

  // Report → stdout only.
  const lines = [];
  lines.push(`Legal gate: ${path.basename(dir)}`);
  lines.push(`  files: ${files.join(", ")} | sources: ${sources.length} | skill≈${skillTokens} tok`);
  lines.push("");
  for (const f of result.findings) {
    lines.push(`  ${f.pass ? "PASS" : "FAIL"}  ${f.check.padEnd(18)} ${f.detail}`);
  }
  lines.push("");
  lines.push(`  RESULT: ${result.pass ? "PASS" : "FAIL"}`);
  process.stdout.write(lines.join("\n") + "\n");

  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  err(`legal-gate error: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(2);
});

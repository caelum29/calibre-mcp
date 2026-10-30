// Mechanical guards for architecture invariants from CLAUDE.md, so violations fail CI
// instead of relying on the model reading the docs. (The user-regex rule lives in
// .oxlintrc.json as a `no-restricted-globals` override on src/tools/**.)
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

// The transport/registration layer is the only place allowed to touch the SDK —
// keeps handlers, schemas and domain code SDK-free for the v2 migration.
const SDK_ALLOWLIST = new Set(["src/server.ts", "src/run-stdio.ts"]);

// Static `import … from`, side-effect `import "…"`, `export … from`, dynamic `import()`, `require()`.
const SDK_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]@modelcontextprotocol\/sdk(?:[/"'`])/;

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

// Comments may name the package (e.g. src/tools/types.ts explains the seam) — only code counts.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Repo-relative paths of files outside the allowlist that import the MCP SDK. */
function findSdkImportViolations(files: ReadonlyArray<{ path: string; source: string }>): string[] {
  return files.filter((f) => !SDK_ALLOWLIST.has(f.path) && SDK_IMPORT.test(stripComments(f.source))).map((f) => f.path);
}

describe("SDK-free seam", () => {
  it("only server.ts and run-stdio.ts import @modelcontextprotocol/sdk", () => {
    const files = listTsFiles(SRC).map((abs) => ({
      path: relative(ROOT, abs).split("\\").join("/"),
      source: readFileSync(abs, "utf8"),
    }));
    expect(files.length).toBeGreaterThan(0);
    expect(findSdkImportViolations(files)).toEqual([]);
  });

  it("detects every import form and ignores comments", () => {
    const sdk = "@modelcontextprotocol/sdk";
    const cases: Array<[string, boolean]> = [
      [`import { McpServer } from "${sdk}/server/mcp.js";`, true],
      [`import type { CallToolResult } from '${sdk}/types.js';`, true],
      [`export type { CallToolResult } from "${sdk}/types.js";`, true],
      [`import "${sdk}/server/stdio.js";`, true],
      [`const m = await import("${sdk}/types.js");`, true],
      [`const m = require("${sdk}");`, true],
      [`// handlers never import ${sdk}`, false],
      [`/* see "${sdk}/types.js" */`, false],
      [`import { x } from "@modelcontextprotocol/ext-apps";`, false],
    ];
    for (const [source, violates] of cases) {
      expect(findSdkImportViolations([{ path: "src/tools/x.ts", source }]), source).toEqual(
        violates ? ["src/tools/x.ts"] : [],
      );
    }
    expect(findSdkImportViolations([{ path: "src/server.ts", source: cases[0]![0] }])).toEqual([]);
  });
});

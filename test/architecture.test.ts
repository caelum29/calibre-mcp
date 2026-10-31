// Mechanical guards for architecture invariants from CLAUDE.md, so violations fail CI
// instead of relying on the model reading the docs. (The user-regex rule lives in
// .oxlintrc.json as a `no-restricted-globals` override on src/tools/**.)
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
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

// ── layer directions (#217, #260, #261) ──────────────────────────────────────────────

interface SourceFile {
  path: string;
  source: string;
}

function readSources(dir: string, ext: RegExp): SourceFile[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => {
      const abs = join(e.parentPath, e.name);
      return { path: relative(ROOT, abs).split("\\").join("/"), source: readFileSync(abs, "utf8") };
    });
}

const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)["'](\.{1,2}\/[^"']+)["']/gm;

/** Repo-relative `.ts` targets of a file's relative imports (`./x.js` → `src/…/x.ts`). */
function importTargets(file: SourceFile): string[] {
  const dir = file.path.split("/").slice(0, -1).join("/");
  return [...stripComments(file.source).matchAll(RELATIVE_IMPORT)].map((m) =>
    relative(ROOT, join(ROOT, dir, m[1]!))
      .split("\\")
      .join("/")
      .replace(/\.js$/, ".ts"),
  );
}

interface LayerRule {
  name: string;
  from: RegExp;
  forbidden: RegExp;
}

// Inner layers stay free of adapters and MCP plumbing so they can be tested and moved alone.
const LAYER_RULES: LayerRule[] = [
  { name: "domain is pure", from: /^src\/domain\//, forbidden: /^src\/(?!domain\/|types\/)/ },
  {
    name: "config imports no adapters",
    from: /^src\/config\.ts$/,
    forbidden: /^src\/(calibre|tools|ui|semantic|enrich|resources)\//,
  },
  { name: "ui does not import tools", from: /^src\/ui\//, forbidden: /^src\/tools\// },
  { name: "resources take ports, not tools", from: /^src\/resources\//, forbidden: /^src\/tools\// },
  { name: "scripts do not reach into tools", from: /^scripts\//, forbidden: /^src\/tools\// },
];

// Known breaks, each owned by an open refactor issue. Shrink-only: a fixed edge must be removed.
const LAYER_ALLOWLIST = new Set([
  "src/config.ts -> src/calibre/discover.ts", // #261
  "src/resources/book.ts -> src/tools/types.ts", // #261
  "src/resources/book.ts -> src/tools/result.ts", // #261
  "src/resources/book.ts -> src/tools/resource-link.ts", // #261
  "scripts/reindex.ts -> src/tools/index-book.ts", // #260
  "scripts/reindex.ts -> src/tools/types.ts", // #260
]);

/** `"<file> -> <target> (<rule>)"` for every import that crosses a forbidden layer edge. */
function findLayerViolations(files: SourceFile[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    for (const rule of LAYER_RULES.filter((r) => r.from.test(f.path))) {
      for (const t of importTargets(f)) if (rule.forbidden.test(t)) out.add(`${f.path} -> ${t}`);
    }
  }
  return [...out].sort();
}

describe("layer directions", () => {
  const files = [...readSources("src", /\.ts$/), ...readSources("scripts", /\.(ts|mjs)$/)];
  const violations = findLayerViolations(files);

  it("no new import crosses a forbidden layer edge", () => {
    expect(violations.filter((v) => !LAYER_ALLOWLIST.has(v))).toEqual([]);
  });

  it("the allowlist has no stale entries (fixed edges are removed)", () => {
    expect([...LAYER_ALLOWLIST].filter((a) => !violations.includes(a))).toEqual([]);
  });

  it("resolves relative imports and flags each rule", () => {
    const at = (path: string, source: string) => findLayerViolations([{ path, source }]);
    expect(at("src/domain/x.ts", `import { a } from "../calibre/client.js";`)).toEqual([
      "src/domain/x.ts -> src/calibre/client.ts",
    ]);
    expect(at("src/domain/a/x.ts", `import type { B } from "../book.js";`)).toEqual([]);
    expect(at("src/ui/x.ts", `const m = await import("../tools/result.js");`)).toEqual([
      "src/ui/x.ts -> src/tools/result.ts",
    ]);
    expect(at("scripts/x.mjs", `import { y } from "../src/tools/index-book.js";`)).toEqual([
      "scripts/x.mjs -> src/tools/index-book.ts",
    ]);
    expect(at("src/domain/x.ts", `// import { a } from "../calibre/client.js";`)).toEqual([]);
  });
});

// ── one home per mechanism (twin paths: #219, #221, #223, #241) ──────────────────────

interface TwinRule {
  name: string;
  pattern: RegExp;
  home: string[];
}

// A second copy of these drifts: the fix lands in one copy and misses the other.
const TWIN_RULES: TwinRule[] = [
  {
    name: "accent folding lives in foldAccents (NFKD + mark strip folds Cyrillic й → и, #241)",
    pattern: /\.normalize\(\s*["']NFK?D["']\s*\)/,
    home: ["src/domain/curation/normalize.ts"],
  },
  {
    name: "HTTP goes through the http clients (timeouts, abort, error wrapping)",
    pattern: /(?<![.\w])fetch\s*\(/,
    home: ["src/calibre/http.ts", "src/enrich/http.ts"],
  },
  {
    name: "external-binary candidate paths live in calibre/binaries.ts (#219)",
    pattern: /["'`]\/(?:opt\/homebrew|usr\/local|usr)\/bin\//,
    home: ["src/calibre/binaries.ts", "src/calibre/discover.ts"], // discover: calibredb lookup, injectable
  },
];

function findTwinViolations(files: SourceFile[]): string[] {
  return TWIN_RULES.flatMap((r) =>
    files
      .filter((f) => !r.home.includes(f.path) && r.pattern.test(stripComments(f.source)))
      .map((f) => `${f.path}: ${r.name}`),
  );
}

describe("one home per mechanism", () => {
  it("no copy of a shared mechanism outside its home", () => {
    expect(findTwinViolations(readSources("src", /\.ts$/))).toEqual([]);
  });

  it("detects each twin and ignores comments and method names", () => {
    const at = (source: string) => findTwinViolations([{ path: "src/tools/x.ts", source }]);
    expect(at(`const k = s.normalize("NFKD").replace(/\\p{M}/gu, "");`)).toHaveLength(1);
    expect(at(`const r = await fetch(url);`)).toHaveLength(1);
    expect(at(`const c = ["/opt/homebrew/bin/pdftotext"];`)).toHaveLength(1);
    expect(at(`const k = s.normalize("NFC");`)).toEqual([]);
    expect(at(`await deps.content.fetchBook(1); // fetch(url)`)).toEqual([]);
  });
});

// ── JSDoc on the public surface (#224) ───────────────────────────────────────────────

/** Names a top-level statement exports as a function or class (incl. function-valued consts). */
function exportedCallableNames(st: ts.Statement, sf: ts.SourceFile): string[] {
  const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return [];
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
  if (!ts.isVariableStatement(st)) return [];
  return st.declarationList.declarations
    .filter((d) => d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
    .map((d) => d.name.getText(sf));
}

/** `"<path> <name>"` for every exported function, class or function-valued const without JSDoc. */
function findUndocumentedExports(files: SourceFile[]): string[] {
  return files.flatMap((f) => {
    const sf = ts.createSourceFile(f.path, f.source, ts.ScriptTarget.Latest, true);
    return sf.statements
      .filter((st) => ts.getJSDocCommentsAndTags(st).length === 0)
      .flatMap((st) => exportedCallableNames(st, sf).map((name) => `${f.path} ${name}`));
  });
}

describe("JSDoc on exported functions and classes", () => {
  it("every exported function, class and function-valued const has JSDoc", () => {
    expect(findUndocumentedExports(readSources("src", /\.ts$/))).toEqual([]);
  });

  it("flags undocumented exports and accepts documented or private ones", () => {
    const at = (source: string) => findUndocumentedExports([{ path: "src/x.ts", source }]);
    expect(at(`export function a() {}\nexport class B {}\nexport const c = () => 1;`)).toEqual([
      "src/x.ts a",
      "src/x.ts B",
      "src/x.ts c",
    ]);
    expect(at(`/** Doc. */\nexport function a() {}\nfunction b() {}\nexport const N = 1;`)).toEqual([]);
  });
});

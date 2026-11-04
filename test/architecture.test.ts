// Mechanical guards for architecture invariants from CLAUDE.md, so violations fail CI
// instead of relying on the model reading the docs. (The user-regex rule lives in
// .oxlintrc.json as a `no-restricted-globals` override on src/tools/**.)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

// The transport/registration layer is the only place allowed to touch the SDK —
// keeps handlers, schemas and domain code SDK-free for the v2 migration.
const SDK_ALLOWLIST = new Set(["src/server.ts", "src/run-stdio.ts"]);

// Static `import … from`, side-effect `import "…"`, `export … from`, dynamic `import()`, `require()`.
// v1 ships one package (`sdk`); v2 splits it into `server` / `client` / `core` (#123).
const SDK_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]@modelcontextprotocol\/(?:sdk|server|client|core)(?:[/"'`])/;

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
  it("only server.ts and run-stdio.ts import the MCP SDK (v1 sdk or v2 server/client/core)", () => {
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
      [`import { McpServer } from "@modelcontextprotocol/server";`, true],
      [`import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";`, true],
      [`import type { CallToolResult } from "@modelcontextprotocol/core";`, true],
      [`import { Client } from "@modelcontextprotocol/client";`, true],
      [`import { x } from "@modelcontextprotocol/ext-apps";`, false],
      [`import { x } from "@modelcontextprotocol/servers-extra";`, false],
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
  // neutral helpers both tools/ and resources/ import (#261): they may lean on domain only
  { name: "shared imports only domain", from: /^src\/shared\//, forbidden: /^src\/(?!domain\/|shared\/)/ },
  // use-cases (#260): domain + ports only — no MCP result types, no tool modules, no UI.
  // tools/deps.ts is the port bundle — the one tools/ module app/ may import (#346).
  {
    name: "app imports no MCP plumbing",
    from: /^src\/app\//,
    forbidden: /^src\/(tools\/(?!deps\.ts$)|ui\/|server\.ts$|resources\/)/,
  },
  // the SDK-free protocol mirror every tool module imports stays free of infra types (#258)
  {
    name: "tool protocol mirror imports no adapters",
    from: /^src\/tools\/types\.ts$/,
    forbidden: /^src\/(calibre|semantic|enrich|ui)\//,
  },
];

// Known breaks, each owned by an open refactor issue. Shrink-only: a fixed edge must be removed.
const LAYER_ALLOWLIST = new Set<string>([]);

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
    expect(at("src/shared/x.ts", `import { fence } from "../tools/result.js";`)).toEqual([
      "src/shared/x.ts -> src/tools/result.ts",
    ]);
    expect(at("src/shared/x.ts", `import type { Book } from "../domain/book.js";`)).toEqual([]);
    expect(at("src/tools/types.ts", `import type { Extractor } from "../calibre/extract.js";`)).toEqual([
      "src/tools/types.ts -> src/calibre/extract.ts",
    ]);
    expect(at("src/tools/types.ts", `import type { ToolDeps } from "./deps.js";`)).toEqual([]);
    expect(at("src/app/x.ts", `import { toolError } from "../tools/result.js";`)).toEqual([
      "src/app/x.ts -> src/tools/result.ts",
    ]);
    expect(at("src/app/x.ts", `import type { ToolResult } from "../tools/types.js";`)).toEqual([
      "src/app/x.ts -> src/tools/types.ts",
    ]);
    expect(at("src/app/x.ts", `import type { ToolDeps } from "../tools/deps.js";`)).toEqual([]);
    expect(at("src/app/x.ts", `import { resolveNumericId } from "../tools/resolve-id.js";`)).toEqual([
      "src/app/x.ts -> src/tools/resolve-id.ts",
    ]);
    expect(at("src/app/x.ts", `import { bookProgress } from "../tools/book-progress.js";`)).toEqual([
      "src/app/x.ts -> src/tools/book-progress.ts",
    ]);
    expect(at("src/config.ts", `import { discoverCalibredb } from "./calibre/discover.js";`)).toEqual([
      "src/config.ts -> src/calibre/discover.ts",
    ]);
  });
});

// ── ToolDeps on ports (#258) ─────────────────────────────────────────────────────────

// Handlers see narrow ports; only server.ts (the composition root) names the adapter classes.
const ADAPTER_CLASSES = /\b(ContentServerClient|CalibreClient|Extractor|FigureInventoryService|BoardCache)\b/g;

// Value imports (`import { X }`, not `import type`) and `new X(` — how a handler would build its own adapter.
const VALUE_IMPORT = /\bimport\s+(?!type\b)\{([^}]*)\}\s*from/g;
const ADAPTER_NAME = /^(ContentServerClient|CalibreClient|Extractor|FigureInventoryService|BoardCache)$/;
const ADAPTER_NEW = /\bnew\s+(ContentServerClient|CalibreClient|Extractor|FigureInventoryService|BoardCache)\b/g;

/** `"<file>: <Class>"` for every adapter class a file value-imports or constructs. */
function findAdapterUses(files: SourceFile[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const code = stripComments(f.source);
    for (const m of code.matchAll(VALUE_IMPORT)) {
      for (const raw of m[1]!.split(",")) {
        const name = raw.trim();
        // `type X` inside a value import is still type-only; `X as Y` keeps X as the imported name
        if (name.startsWith("type ")) continue;
        const imported = name.split(/\s+as\s+/)[0]!;
        if (ADAPTER_NAME.test(imported)) out.add(`${f.path}: ${imported}`);
      }
    }
    for (const m of code.matchAll(ADAPTER_NEW)) out.add(`${f.path}: ${m[1]}`);
  }
  return [...out].sort();
}

describe("ToolDeps on ports", () => {
  it("tools/deps.ts names no concrete adapter class", () => {
    const source = stripComments(readFileSync(join(SRC, "tools", "deps.ts"), "utf8"));
    expect([...new Set(source.match(ADAPTER_CLASSES) ?? [])]).toEqual([]);
  });

  // No exceptions: server.ts is the only composition root and sits outside src/tools/ and src/app/.
  it("no tool or use-case module value-imports or constructs a concrete adapter", () => {
    expect(findAdapterUses([...readSources("src/tools", /\.ts$/), ...readSources("src/app", /\.ts$/)])).toEqual([]);
  });

  it("flags value imports and construction, not type-only imports", () => {
    const at = (source: string) => findAdapterUses([{ path: "src/tools/x.ts", source }]);
    expect(at(`import { ContentServerClient } from "../calibre/content-server.js";`)).toEqual([
      "src/tools/x.ts: ContentServerClient",
    ]);
    expect(at(`import { log, BoardCache as BC } from "../ui/board-cache.js";`)).toEqual(["src/tools/x.ts: BoardCache"]);
    expect(at(`const e = new Extractor(cfg, figs);`)).toEqual(["src/tools/x.ts: Extractor"]);
    expect(at(`import type { CalibreClient } from "../calibre/client.js";`)).toEqual([]);
    expect(at(`import { type FigureInventoryService, x } from "../calibre/figure-inventory.js";`)).toEqual([]);
    expect(at(`// import { CalibreClient } from "../calibre/client.js";`)).toEqual([]);
  });
});

// ── use-cases take ports, not adapters (#354) ────────────────────────────────────────

/** Infrastructure trees: every module is an adapter (class-less helpers like http.ts reach I/O via spawn/binaries). */
const ADAPTER_TREES = ["src/calibre/", "src/enrich/", "src/ui/"];
/** Mixed tree (ranking/pure logic beside the store and model adapters): a module is an adapter only if it shows it. */
const MIXED_TREES = ["src/semantic/"];

function parseTs(source: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", source, ts.ScriptTarget.ES2022, true);
}

/** Exported non-Error classes: ContentServerClient, SqliteIndexStore, TransformersEmbedder, … */
function exportsAdapterClass(source: string): boolean {
  return parseTs(source).statements.some(
    (st) =>
      ts.isClassDeclaration(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true &&
      !st.heritageClauses?.some((h) => h.types.some((t) => t.expression.getText().endsWith("Error"))),
  );
}

/** Node modules that mean real I/O: filesystem, subprocess, SQLite, network. */
const IO_MODULE = /^(?:node:)?(?:fs|fs\/promises|child_process|sqlite|net|http|https|http2|tls|dns|dgram)$/;

/** True if the module value-imports Node I/O or calls the global `fetch(` — it does its own I/O. */
function doesIo(source: string): boolean {
  if (valueImports(source).some((spec) => IO_MODULE.test(spec))) return true;
  // a module typed against the SQLite handle (store/shared.ts) is store code even if it only names the type
  if (valueImports(source, true).some((spec) => /^(?:node:)?sqlite$/.test(spec))) return true;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetch") found = true;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(parseTs(source));
  return found;
}

/**
 * Concrete adapter modules, found rather than listed so a new adapter is covered the day it lands:
 * every module under calibre/, enrich/, ui/, plus any semantic/ module that exports a class OR
 * value-imports Node I/O (fs, child_process, sqlite, net, http…) OR calls `fetch(` itself.
 */
function adapterModules(files: SourceFile[]): Set<string> {
  return new Set(
    files
      .filter(
        (f) =>
          ADAPTER_TREES.some((d) => f.path.startsWith(d)) ||
          (MIXED_TREES.some((d) => f.path.startsWith(d)) && (exportsAdapterClass(f.source) || doesIo(f.source))),
      )
      .map((f) => f.path),
  );
}

/**
 * Module specifiers a file pulls in as a VALUE: `import x|{ a }|* as n from`, `import "m"`, `export … from`,
 * `export * from`, dynamic `import("m")`, `import x = require("m")`, `require("m")`. Only `import type` /
 * `export type … from` is skipped: under verbatimModuleSyntax an inline-`type` clause still emits an import.
 */
function valueImports(source: string, includeTypes = false): string[] {
  const out: string[] = [];
  const isLiteral = (n: ts.Node | undefined): n is ts.StringLiteralLike => n !== undefined && ts.isStringLiteralLike(n);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && isLiteral(n.moduleSpecifier)) {
      // verbatimModuleSyntax keeps `import { type A } from "m"` as a side-effect `import {} from "m"`,
      // so only `import type …` is erased
      const typeOnly = !includeTypes && n.importClause?.isTypeOnly === true;
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && isLiteral(n.moduleSpecifier)) {
      const typeOnly = !includeTypes && n.isTypeOnly; // `export { type A } from "m"` stays a runtime re-export
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      isLiteral(n.moduleReference.expression)
    ) {
      if (!n.isTypeOnly) out.push(n.moduleReference.expression.text);
    } else if (ts.isCallExpression(n) && isLiteral(n.arguments[0])) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        out.push((n.arguments[0] as ts.StringLiteralLike).text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parseTs(source));
  return out;
}

/** `"<file> -> <adapter module>"` for every value import of a concrete adapter module from src/app/. */
function findAppAdapterImports(files: SourceFile[], adapters: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const f of files.filter((x) => x.path.startsWith("src/app/"))) {
    const dir = f.path.split("/").slice(0, -1).join("/");
    for (const spec of valueImports(f.source)) {
      if (!spec.startsWith(".")) continue;
      const target = relative(ROOT, join(ROOT, dir, spec))
        .split("\\")
        .join("/")
        .replace(/\.js$/, ".ts");
      if (adapters.has(target)) out.add(`${f.path} -> ${target}`);
    }
  }
  return [...out].sort();
}

describe("use-cases take ports, not adapters (#354)", () => {
  const all = readSources("src", /\.ts$/);
  const adapters = adapterModules(all);

  it("finds the concrete adapter modules (the rule can't go blind)", () => {
    for (const known of [
      // exports a class
      "src/calibre/content-server.ts",
      "src/calibre/client.ts",
      "src/calibre/extract.ts",
      "src/semantic/store/index.ts",
      "src/semantic/embedder.ts",
      "src/ui/board-cache.ts",
      // class-less, does Node I/O or fetch itself
      "src/calibre/http.ts",
      "src/calibre/binaries.ts",
      "src/calibre/spawn.ts",
      "src/calibre/pdf-outline.ts",
      "src/calibre/epub-toc.ts",
      "src/calibre/figure-fetch.ts",
      "src/calibre/discover.ts",
      "src/enrich/http.ts",
      "src/semantic/build-progress.ts",
      "src/semantic/store/shared.ts",
      "src/semantic/status.ts",
      "src/calibre/lib-id.ts", // whole tree: pure helpers here belong in domain, not behind app
    ]) {
      expect(adapters.has(known), known).toBe(true);
    }
    // pure modules the use-cases legitimately import by value are not adapters
    for (const pure of ["src/semantic/book-pipeline.ts", "src/semantic/staleness.ts", "src/semantic/model.ts"]) {
      expect(adapters.has(pure), pure).toBe(false);
    }
  });

  it("src/app value-imports no concrete adapter module (type-only port imports are fine)", () => {
    expect(findAppAdapterImports(all, adapters)).toEqual([]);
  });

  it("flags every value-import form and lets type-only imports through", () => {
    const A = new Set(["src/calibre/content-server.ts", "src/semantic/store/index.ts"]);
    const at = (source: string) => findAppAdapterImports([{ path: "src/app/x.ts", source }], A);
    const cs = "src/app/x.ts -> src/calibre/content-server.ts";
    expect(at(`import { ContentServerClient } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`import { matchCategory } from "../calibre/content-server.js";`)).toEqual([cs]); // any value, not only the class
    expect(at(`import cs from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`import * as cs from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`import "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`import { type LibraryReader, ContentServerClient } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`export { ContentServerClient } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`export * from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`const m = await import("../calibre/content-server.js");`)).toEqual([cs]);
    expect(at(`const m = require("../calibre/content-server.js");`)).toEqual([cs]);
    expect(at(`import cs = require("../calibre/content-server.js");`)).toEqual([cs]);
    expect(at(`import { SqliteIndexStore } from "../semantic/store/index.js";`)).toEqual([
      "src/app/x.ts -> src/semantic/store/index.ts",
    ]);
    expect(at(`import type { LibraryReader } from "../calibre/content-server.js";`)).toEqual([]);
    expect(at(`import type * as cs from "../calibre/content-server.js";`)).toEqual([]);
    // verbatimModuleSyntax emits these as `import {} from "…"` — a runtime side-effect import
    expect(at(`import { type LibraryReader } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`import { type LibraryReader, type Page } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`export { type LibraryReader } from "../calibre/content-server.js";`)).toEqual([cs]);
    expect(at(`export type { LibraryReader } from "../calibre/content-server.js";`)).toEqual([]);
    expect(at(`let r: import("../calibre/content-server.js").LibraryReader;`)).toEqual([]);
    expect(at(`// import { ContentServerClient } from "../calibre/content-server.js";`)).toEqual([]);
    expect(at(`import { z } from "zod"; import { x } from "../domain/book.js";`)).toEqual([]);
    // only src/app is checked
    expect(
      findAppAdapterImports([{ path: "src/tools/x.ts", source: `import "../calibre/content-server.js";` }], A),
    ).toEqual([]);
  });
});

// ── one home per mechanism (twin paths: #219, #221, #223, #241) ──────────────────────

interface TwinRule {
  name: string;
  pattern: RegExp;
  home: string[];
  /** Top-level dirs the rule applies to; default src only (tooling may legitimately differ). */
  roots?: string[];
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
    name: 'figure failures are FiguresError codes, not "FIGURES_*" strings (#220)',
    pattern: /["'`]FIGURES_[A-Z_]+["'`]/,
    home: [],
  },
  {
    name: "a LibId is minted only by content.resolveLibraryId (D-008, #218)",
    // any mention of asLibId (covers aliased imports) plus the `as LibId` / `<LibId>` casts
    pattern: /\basLibId\b|\bas\s+LibId\b|<LibId>/,
    home: ["src/calibre/content-server.ts", "src/calibre/lib-id.ts"],
  },
  {
    name: "external-binary candidate paths live in calibre/binaries.ts (#219)",
    pattern: /["'`]\/(?:opt\/homebrew|usr\/local|usr)\/bin\//,
    home: ["src/calibre/binaries.ts", "src/calibre/discover.ts"], // discover: calibredb lookup, injectable
  },
  {
    name: "one SQLite connection owner: only semantic/store/schema.ts opens a DatabaseSync (#272)",
    // also `new sqlite.DatabaseSync(` / `new a.b.DatabaseSync(` / a member chain split across lines
    // (namespace imports) and `DatabaseSync as X` (aliased, #322). Not caught: a destructured
    // `require` (`const { DatabaseSync: D } = …; new D(`) and `new (x.DatabaseSync)(`. A string
    // literal containing the pattern trips it — acceptable, the failure is loud and points at the file.
    pattern: /\bnew\s+(?:[\w$]+\s*\.\s*)*DatabaseSync\s*\(|\bDatabaseSync\s+as\s+[\w$]/,
    home: ["src/semantic/store/schema.ts"],
    // scripts/ too: a reindex/maintenance script opening its own connection races the store (#322)
    roots: ["src", "scripts"],
  },
  {
    name: "ranking/fusion/rerank live in semantic/retrieve.ts, not in a tool adapter (#259)",
    pattern: /\brrfFuse\s*\(|\.rerank\s*\(|\bRRF_WEIGHT\b|\bVECTOR_RRF_WEIGHT\b/,
    home: ["src/semantic/fusion.ts", "src/semantic/retrieve.ts"],
  },
  {
    name: "the index-build pipeline is driven from app/build-index.ts, not a tool module (#346)",
    pattern: /\brunBookPipeline\s*[<(]/,
    home: ["src/semantic/book-pipeline.ts", "src/app/build-index.ts"],
  },
  {
    name: "ping's per-library index report lives in app/library-index.ts (#346)",
    pattern: /\.booksMissingVectors\s*\(/,
    home: ["src/semantic/status.ts", "src/semantic/store/index.ts", "src/app/library-index.ts"],
  },
  {
    name: "a not-found-or-cause error goes through toolErrorFrom (#345)",
    pattern: /\bcause\s*===\s*undefined\s*\?\s*toolError\s*\(/,
    home: ["src/tools/result.ts"],
  },
  {
    name: "a caught error becomes a result through errorFromCatch (#345)",
    pattern: /toolError\(\s*errorCodeFor\(\s*([\w$]+)\s*\)\s*,\s*\1\s+instanceof\s+Error/,
    home: ["src/tools/result.ts"],
  },
  {
    name: "a cursor param is resolved through pageOffset (#345, the #211 shape)",
    pattern: /\bresolveCursor\s*\(/,
    home: ["src/tools/cursor.ts"],
  },
  {
    name: "an ids/query/filter selection is keyed by selectionKey (#345)",
    pattern: /\bidsKey\s*\(/,
    home: ["src/tools/cursor.ts"],
  },
  {
    name: 'the "not in the requested library" 404 is built by bookNotFound (#345)',
    pattern: /in the requested library/,
    home: ["src/tools/result.ts"],
  },
  {
    name: "an FTS MATCH narrowed by another column goes through a MATERIALIZED CTE (#155, #347)",
    // `x_fts MATCH ? AND col …` lets the planner drive from the column index and re-run MATCH per row
    pattern: /_fts\s+MATCH\s+\?\s+AND\b/,
    home: [],
  },
  {
    name: "Calibre's 0101-01-01 no-date sentinel is read only by isEmptyDate (#347)",
    pattern: /["'`]0101-01-01|\byear\s*>\s*1000\b/,
    home: ["src/domain/merge.ts"],
  },
  {
    name: "domain errors are classified with instanceof, not by name string (#347)",
    pattern: /\.name\s*===\s*["'`]Calibre\w*Error["'`]/,
    home: [],
  },
  {
    name: "a remaining-time budget is a shared/deadline.ts Deadline, not ad-hoc arithmetic (#347)",
    pattern: /-\s*\(\s*Date\.now\(\)\s*-/,
    home: [],
  },
  {
    name: "the cover-board _meta is built by one boardMeta helper (#259)",
    pattern: /\bfunction\s+boardMeta\s*\(/,
    home: ["src/tools/board-meta.ts"],
  },
];

/** The files the twin rules are checked against: src/ plus the scripts/ tooling. */
// Every JS/TS flavour the tooling may use: .js .mjs .cjs .ts .mts .cts
const SCRIPT_EXT = /\.[cm]?[jt]s$/;

function twinScanFiles(): SourceFile[] {
  return [...readSources("src", /\.ts$/), ...readSources("scripts", SCRIPT_EXT)];
}

/** True when the file sits under one of the rule's roots (default: src). */
function inRoots(rule: TwinRule, file: SourceFile): boolean {
  return (rule.roots ?? ["src"]).some((root) => file.path.startsWith(`${root}/`));
}

function findTwinViolations(files: SourceFile[]): string[] {
  return TWIN_RULES.flatMap((r) =>
    files
      .filter((f) => inRoots(r, f) && !r.home.includes(f.path) && r.pattern.test(stripComments(f.source)))
      .map((f) => `${f.path}: ${r.name}`),
  );
}

describe("one home per mechanism", () => {
  it("no copy of a shared mechanism outside its home", () => {
    expect(findTwinViolations(twinScanFiles())).toEqual([]);
  });

  it("the SQLite-owner rule reaches scripts/ and namespace/aliased imports (#322)", () => {
    // scripts/ (reindex.ts, the .mjs tooling) is scanned too, not just src/
    expect(twinScanFiles().map((f) => f.path)).toContain("scripts/reindex.ts");
    const inScripts = (source: string) => findTwinViolations([{ path: "scripts/x.mjs", source }]);
    expect(inScripts(`const db = new DatabaseSync(file);`)).toEqual([
      "scripts/x.mjs: one SQLite connection owner: only semantic/store/schema.ts opens a DatabaseSync (#272)",
    ]);
    // other twin rules stay src-only: tooling may legitimately name a binary path
    expect(inScripts(`const p = "/usr/local/bin/calibredb";`)).toEqual([]);
    const at = (source: string) => findTwinViolations([{ path: "src/tools/x.ts", source }]);
    expect(at(`import * as sqlite from "node:sqlite"; const db = new sqlite.DatabaseSync(file);`)).toHaveLength(1);
    expect(at(`import { DatabaseSync as Db } from "node:sqlite";`)).toHaveLength(1);
    expect(at(`import type { DatabaseSync } from "node:sqlite"; let db: DatabaseSync;`)).toEqual([]);
  });

  it("the SQLite-owner rule catches deep and line-split member chains, and cjs/mts scripts (#325 review)", () => {
    const at = (source: string) => findTwinViolations([{ path: "src/tools/x.ts", source }]);
    expect(at(`const db = new a.b.DatabaseSync(file);`)).toHaveLength(1);
    expect(at(`const db = new sqlite\n  .DatabaseSync(file);`)).toHaveLength(1);
    expect(at(`const db = new $q.DatabaseSync(file);`)).toHaveLength(1);
    expect(at(`const db = openDatabaseSync(file);`)).toEqual([]);
    const scanned = (name: string) => SCRIPT_EXT.test(name);
    expect(["a.cjs", "a.mts", "a.cts", "a.mjs", "a.js", "a.ts"].filter(scanned)).toHaveLength(6);
    expect(["a.py", "a.sh", "a.json"].filter(scanned)).toEqual([]);
  });

  it("detects each twin and ignores comments and method names", () => {
    const at = (source: string) => findTwinViolations([{ path: "src/tools/x.ts", source }]);
    expect(at(`const k = s.normalize("NFKD").replace(/\\p{M}/gu, "");`)).toHaveLength(1);
    expect(at(`const r = await fetch(url);`)).toHaveLength(1);
    expect(at(`const id = asLibId(name);`)).toHaveLength(1);
    expect(at(`import { asLibId as mint } from "./lib-id.js";`)).toHaveLength(1);
    expect(at(`const id = name as LibId;`)).toHaveLength(1);
    expect(at(`const id = name as unknown as LibId;`)).toHaveLength(1);
    expect(at(`const id = <LibId>name;`)).toHaveLength(1);
    expect(at(`import type { LibId } from "./lib-id.js"; const x: LibId = y;`)).toEqual([]);
    expect(at(`throw new Error("FIGURES_NO_POPPLER");`)).toHaveLength(1);
    expect(at(`const c = ["/opt/homebrew/bin/pdftotext"];`)).toHaveLength(1);
    expect(at(`return rrfFuse([a, b], RRF_K, RRF_WEIGHTS);`)).toHaveLength(1);
    expect(at(`const scores = await deps.reranker.rerank(q, bodies);`)).toHaveLength(1);
    expect(at(`const VECTOR_RRF_WEIGHT = 1.0;`)).toHaveLength(1);
    expect(at(`function boardMeta(deps, payload) {}`)).toHaveLength(1);
    expect(at(`if (!fr.ok) return fr.cause === undefined ? toolError("not_found", m) : x;`)).toHaveLength(1);
    expect(at(`return cause === undefined\n  ? toolError("write_failed", m)\n  : y;`)).toHaveLength(1);
    expect(at(`return toolError(errorCodeFor(err), err instanceof Error ? err.message : String(err));`)).toHaveLength(
      1,
    );
    expect(at(`return toolError(errorCodeFor(e), e instanceof Error ? e.message : String(e));`)).toHaveLength(1);
    expect(at(`return toolError(errorCodeFor(err), steer);`)).toEqual([]);
    expect(at(`const start = resolveCursor(args.cursor, bind, "calibre_search");`)).toHaveLength(1);
    expect(at(`const key = [idsKey(args.ids), q].join(":");`)).toHaveLength(1);
    expect(at("return toolError(`No book with id ${id} in the requested library`);")).toHaveLength(1);
    expect(at(`const o = await runBookPipeline<PrepareResult>(ids, 1, hooks);`)).toHaveLength(1);
    expect(at(`const n = deps.index.booksMissingVectors(id);`)).toHaveLength(1);
    expect(at(`const _meta = boardMeta(deps, payload);`)).toEqual([]);
    expect(at(`const db = new DatabaseSync(file, { readOnly: true });`)).toHaveLength(1);
    expect(at(`import { DatabaseSync } from "node:sqlite"; let db: DatabaseSync;`)).toEqual([]);
    expect(at(`const k = s.normalize("NFC");`)).toEqual([]);
    expect(at(`await deps.content.fetchBook(1); // fetch(url)`)).toEqual([]);
  });
});

// ── one call site per shared steer (#345) ───────────────────────────────────────────

/** Matches of `pattern` across the given files, as `"<path>"` per hit. */
function siteHits(files: SourceFile[], pattern: RegExp): string[] {
  const g = new RegExp(pattern.source, "g");
  return files.flatMap((f) => [...stripComments(f.source).matchAll(g)].map(() => f.path));
}

// The "FTS isn't available" refusal is one steer: two copies drift apart (#345).
const FTS_UNAVAILABLE = /toolError\(\s*["'`]fts_unavailable["'`]/;

describe("one call site per shared steer", () => {
  it("the fts_unavailable refusal is built in exactly one place", () => {
    expect(siteHits(readSources("src", /\.ts$/), FTS_UNAVAILABLE)).toEqual(["src/tools/calibre_search.ts"]);
  });

  it("counts every hit, across lines", () => {
    const src = `return toolError(\n  "fts_unavailable", a);\nreturn toolError("fts_unavailable", b);`;
    expect(siteHits([{ path: "src/tools/x.ts", source: src }], FTS_UNAVAILABLE)).toEqual([
      "src/tools/x.ts",
      "src/tools/x.ts",
    ]);
    expect(siteHits([{ path: "src/tools/x.ts", source: `// toolError("fts_unavailable")` }], FTS_UNAVAILABLE)).toEqual(
      [],
    );
  });
});

// The two-line catch tail (`const msg = …; return toolError(errorCodeFor(err), msg)`) is the same
// mechanism as errorFromCatch; a tail that adds its own text (open_book, board_data) is not (#345 review).
const CATCH_TAIL_VIA_MSG =
  /const\s+([\w$]+)\s*=\s*([\w$]+)\s+instanceof\s+Error\s*\?\s*\2\.message\s*:\s*String\(\s*\2\s*\)\s*;\s*return\s+toolError\(\s*errorCodeFor\(\s*\2\s*\)\s*,\s*\1\s*\)/;

describe("errorFromCatch is the only pass-through catch tail (#345 review)", () => {
  it("no module rebuilds it through a message variable", () => {
    expect(siteHits(readSources("src", /\.ts$/), CATCH_TAIL_VIA_MSG)).toEqual([]);
  });

  it("catches the two-line form, not a tail with its own text", () => {
    const at = (source: string) => siteHits([{ path: "src/tools/x.ts", source }], CATCH_TAIL_VIA_MSG);
    expect(
      at(`const msg = err instanceof Error ? err.message : String(err);\n  return toolError(errorCodeFor(err), msg);`),
    ).toEqual(["src/tools/x.ts"]);
    expect(at(`const m = e instanceof Error ? e.message : String(e); return toolError(errorCodeFor(e), m);`)).toEqual([
      "src/tools/x.ts",
    ]);
    expect(
      at(
        "const msg = err instanceof Error ? err.message : String(err);\nreturn toolError(errorCodeFor(err), `Could not: ${msg}`);",
      ),
    ).toEqual([]);
  });
});

describe("one home per mechanism — #347 leftovers", () => {
  const at = (source: string) => findTwinViolations([{ path: "src/tools/x.ts", source }]);

  it("detects each #347 twin shape and ignores the fixed forms", () => {
    expect(at("db.prepare(`SELECT 1 FROM figure_fts WHERE figure_fts MATCH ? AND f.book_id = ?`)")).toHaveLength(1);
    expect(at("db.prepare(`SELECT 1 FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY score`)")).toEqual([]);
    expect(at(`return year > 1000 ? year : undefined;`)).toHaveLength(1);
    expect(at(`const empty = d.startsWith("0101-01-01");`)).toHaveLength(1);
    expect(at(`if (err.name === "CalibreCliTimeoutError") return "timeout";`)).toHaveLength(1);
    expect(at(`if (err instanceof CalibreCliTimeoutError) return "timeout";`)).toEqual([]);
    expect(at(`const left = Math.max(0, LIMIT_MS - (Date.now() - started));`)).toHaveLength(1);
    expect(at(`const secs = Math.round((Date.now() - started) / 1000);`)).toEqual([]);
  });

  it("the low-confidence rule has one body in retrieve.ts (#347)", () => {
    const src = stripComments(readFileSync(join(ROOT, "src/semantic/retrieve.ts"), "utf8"));
    expect(src.match(/maxRerank\s*<\s*RERANK_FLOOR/g) ?? []).toHaveLength(1);
  });
});

// ── semantic store split by concern (#272) ───────────────────────────────────────────

const STORE_DIR = "src/semantic/store";
// One module per concern; index.ts composes them behind the full IndexStore.
const STORE_MODULES = ["schema.ts", "writer.ts", "freshness.ts", "chunks.ts", "figures.ts", "index.ts"];
// Mirrors .oxlintrc.json max-lines (skipBlankLines + skipComments) — the split must stay split.
const STORE_MAX_LINES = 500;

/** Lines that are neither blank nor comment-only (the oxlint max-lines counting rule). */
function codeLines(source: string): number {
  return stripComments(source)
    .split("\n")
    .filter((l) => l.trim() !== "").length;
}

describe("semantic store split (#272)", () => {
  it("the store.ts monolith is gone and every concern module exists", () => {
    expect(existsSync(join(ROOT, "src/semantic/store.ts"))).toBe(false);
    expect(STORE_MODULES.filter((m) => !existsSync(join(ROOT, STORE_DIR, m)))).toEqual([]);
  });

  it(`no store module exceeds ${STORE_MAX_LINES} code lines`, () => {
    const files = existsSync(join(ROOT, STORE_DIR)) ? readSources(STORE_DIR, /\.ts$/) : [];
    expect(files.filter((f) => codeLines(f.source) > STORE_MAX_LINES).map((f) => f.path)).toEqual([]);
  });

  it("codeLines skips blank and comment-only lines", () => {
    expect(codeLines("// a\n\nconst x = 1;\n/* b\n c */\nconst y = 2; // tail\n")).toBe(2);
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

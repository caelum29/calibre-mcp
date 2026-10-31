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
  // tools/deps.ts is the port bundle; tools/resolve-id.ts stays in tools/ per #260's table.
  {
    name: "app imports no MCP plumbing",
    from: /^src\/app\//,
    forbidden: /^src\/(tools\/(?!deps\.ts$|resolve-id\.ts$)|ui\/|server\.ts$|resources\/)/,
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
    expect(at(`const id = asLibId(name);`)).toHaveLength(1);
    expect(at(`import { asLibId as mint } from "./lib-id.js";`)).toHaveLength(1);
    expect(at(`const id = name as LibId;`)).toHaveLength(1);
    expect(at(`const id = name as unknown as LibId;`)).toHaveLength(1);
    expect(at(`const id = <LibId>name;`)).toHaveLength(1);
    expect(at(`import type { LibId } from "./lib-id.js"; const x: LibId = y;`)).toEqual([]);
    expect(at(`throw new Error("FIGURES_NO_POPPLER");`)).toHaveLength(1);
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

// Closed errorCode set (#249): every toolError call site passes a code from the union, and
// domain errors map onto it — so the `tool call` record groups failures by code, not free text.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ERROR_CODES, errorCodeFor } from "../../src/domain/error-codes.js";
import {
  CalibreBusyError,
  CalibreCliError,
  CalibreCliTimeoutError,
  CalibreHttpError,
  CalibreHttpTimeoutError,
  CalibreNotFoundError,
  DeadlineExceededError,
  FiguresError,
  FtsError,
  OperationCancelledError,
} from "../../src/domain/errors.js";
import { toolError } from "../../src/tools/result.js";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/**
 * Source with `//` and block comments blanked (newlines kept, so line numbers stay true), so a
 * name or an apostrophe in a comment is not code. Strings are skipped, not parsed: a regex literal
 * holding a quote could fool it, but the raw-vs-parsed count below would then fail loudly.
 */
function codeOnly(source: string): string {
  let out = "";
  let quote: string | undefined;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") out += source[++i] ?? "";
      else if (c === quote) quote = undefined;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

const HELPERS = ["toolError", "toolErrorFrom", "errorFromCatch"] as const;
type Helper = (typeof HELPERS)[number];

/** `import { … } from "…"` statements, which name the helpers without calling them. */
const IMPORT_STATEMENT = /\bimport\s+(?:type\s+)?[^;]*?\sfrom\s+["'][^"']+["'];?/g;

/** Top-level, comma-separated arguments of the call whose `(` is at `open` (strings opaque). */
function splitArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = open + 1;
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && depth-- === 0) {
      const last = code.slice(start, i).trim();
      if (last !== "") args.push(last);
      return args;
    } else if (c === "," && depth === 0) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

/** Every call of helper `name` in `source` (its definition excluded) with its arguments. */
function helperCalls(source: string, name: Helper, file = "<source>") {
  const code = codeOnly(source);
  // optional type arguments and whitespace before the paren: `name<T> (…)` is still a call
  return [...code.matchAll(new RegExp(`(?<!function )\\b${name}\\s*(?:<[^()]*>)?\\s*\\(`, "g"))].map((m) => ({
    at: `${file}:${code.slice(0, m.index).split("\n").length}`,
    args: splitArgs(code, m.index + m[0].length - 1),
  }));
}

/**
 * `toolError` sites whose code is not from the closed set (#249). The code param is typed
 * `ErrorCode`, so the compiler rejects stray strings; this scan rejects what the compiler cannot.
 */
function toolErrorViolations(source: string, file?: string): string[] {
  const codes = new Set<string>(ERROR_CODES);
  return helperCalls(source, "toolError", file)
    .filter(({ args }) => {
      const arg = args[0] ?? "";
      const literal = /^"([a-z_]+)"$/.exec(arg);
      if (literal) return !codes.has(literal[1]!);
      return !arg.startsWith("errorCodeFor(");
    })
    .map(({ at, args }) => `${at}: toolError(${args[0] ?? ""}, …)`);
}

/**
 * Helper calls that break the closed set (#249/#367): toolErrorFrom's fallback code (3rd arg) must
 * be absent or one of its two literal codes, both in ERROR_CODES; errorFromCatch takes exactly the
 * caught value. These helpers hide the code from the `toolError(` scan above, so check them here.
 */
function helperViolations(source: string, file?: string): string[] {
  const codes = new Set<string>(ERROR_CODES);
  const bad: string[] = [];
  for (const { at, args } of helperCalls(source, "toolErrorFrom", file)) {
    const fallback = args[2];
    const literal = fallback === undefined ? "not_found" : /^"([a-z_]+)"$/.exec(fallback)?.[1];
    if (args.length < 2 || args.length > 4 || literal === undefined || !codes.has(literal)) {
      bad.push(`${at}: toolErrorFrom(${args.join(", ")})`);
    }
  }
  for (const { at, args } of helperCalls(source, "errorFromCatch", file)) {
    if (args.length !== 1 || !/^[A-Za-z_$][\w$]*$/.test(args[0]!))
      bad.push(`${at}: errorFromCatch(${args.join(", ")})`);
  }
  return bad;
}

/** Call-like occurrences of `name` (`name(`, `name <T>(`, `name<`), definitions and imports excluded. */
function rawCallLike(source: string, name: Helper): number {
  const code = codeOnly(source).replace(IMPORT_STATEMENT, "");
  return [...code.matchAll(new RegExp(`(?<!function )\\b${name}\\s*[(<]`, "g"))].length;
}

/**
 * Ways the helpers can slip past the call scans: an import alias (`toolErrorFrom as tef`) or any
 * bare reference that is not a call (`const f = toolErrorFrom`, `.map(toolError)`, a re-export).
 */
function aliasViolations(source: string, file = "<source>"): string[] {
  const code = codeOnly(source);
  const bad: string[] = [];
  for (const imp of code.match(IMPORT_STATEMENT) ?? []) {
    for (const name of HELPERS) {
      if (new RegExp(`\\b${name}\\s+as\\b`).test(imp)) bad.push(`${file}: import alias of ${name}`);
    }
  }
  const rest = code.replace(IMPORT_STATEMENT, "");
  for (const name of HELPERS) {
    for (const m of rest.matchAll(new RegExp(`(?<!function )\\b${name}\\b(?!\\s*[(<])`, "g"))) {
      bad.push(`${file}:${rest.slice(0, m.index).split("\n").length}: bare reference to ${name}`);
    }
  }
  return bad;
}

describe("toolErrorFrom / errorFromCatch call sites (#367)", () => {
  it("should_pass_a_closed_set_fallback_at_every_helper_site", () => {
    const bad = sourceFiles("src").flatMap((f) => helperViolations(readFileSync(f, "utf8"), f));
    expect(bad).toEqual([]);
  });

  it("should_parse_every_call_like_occurrence_of_each_helper", () => {
    // an unparsable site must fail here instead of vanishing from the scan above
    const all = sourceFiles("src").map((f) => readFileSync(f, "utf8"));
    for (const name of ["toolErrorFrom", "errorFromCatch"] as const) {
      const raw = all.reduce((n, src) => n + rawCallLike(src, name), 0);
      const parsed = all.reduce((n, src) => n + helperCalls(src, name).length, 0);
      expect({ name, parsed }).toEqual({ name, parsed: raw });
      expect(parsed).toBeGreaterThan(0);
    }
  });

  it("should_not_alias_or_pass_around_the_error_helpers_in_src", () => {
    const bad = sourceFiles("src").flatMap((f) => aliasViolations(readFileSync(f, "utf8"), f));
    expect(bad).toEqual([]);
  });

  it("should_flag_a_bad_code_and_accept_the_real_shapes", () => {
    expect(helperViolations(`return toolErrorFrom(cause, message, "bogus_code", opts);`)).toHaveLength(1);
    expect(helperViolations(`return toolErrorFrom(cause, message, "internal");`)).toEqual([]);
    expect(helperViolations(`return toolErrorFrom(cause, message, fallbackCode);`)).toHaveLength(1);
    expect(helperViolations(`if (!fr.ok) return toolErrorFrom(fr.cause, fr.error);`)).toEqual([]);
    expect(helperViolations(`return toolErrorFrom(cause, \`a, b \${x}\`, "write_failed", opts);`)).toEqual([]);
    expect(helperViolations(`return errorFromCatch(err);`)).toEqual([]);
    expect(helperViolations(`return errorFromCatch("not_found");`)).toHaveLength(1);
    expect(helperViolations(`return errorFromCatch(errorCodeFor(err), err);`)).toHaveLength(1);
    // generics and whitespace before the paren do not hide a call
    expect(helperViolations(`return toolErrorFrom<Foo>(cause, m, "bogus_code");`)).toHaveLength(1);
    expect(helperViolations(`return toolErrorFrom (cause, m, "bogus_code");`)).toHaveLength(1);
    expect(helperViolations(`return errorFromCatch <E> (err, 1);`)).toHaveLength(1);
    // an apostrophe in an inline comment inside a call does not derail the argument split
    expect(helperViolations(`toolErrorFrom(cause, // the cause's own code\n  m, "write_failed");`)).toEqual([]);
    expect(helperViolations(`toolErrorFrom(cause, m, /* don't */ "bogus_code");`)).toHaveLength(1);
    // a site the parser misses still shows in the raw count, so the parity test would fail
    expect(rawCallLike(`const a = toolErrorFrom <\n x>(c, m);`, "toolErrorFrom")).toBe(1);
    expect(helperCalls(`const a = toolErrorFrom <\n x>(c, m);`, "toolErrorFrom")).toHaveLength(1);
    expect(rawCallLike(`const a = toolErrorFrom < 3;`, "toolErrorFrom")).toBe(1);
    expect(helperCalls(`const a = toolErrorFrom < 3;`, "toolErrorFrom")).toHaveLength(0);
    // aliases and bare references
    expect(aliasViolations(`import { toolErrorFrom as tef } from "./result.js";`)).toHaveLength(1);
    expect(aliasViolations(`import { toolError, errorFromCatch as efc } from "./result.js";`)).toHaveLength(1);
    expect(aliasViolations(`import { toolError } from "./result.js";\nconst f = toolError;`)).toHaveLength(1);
    expect(aliasViolations(`items.map(errorFromCatch);`)).toHaveLength(1);
    expect(
      aliasViolations(`import { toolError, toolErrorFrom } from "./result.js";\nreturn toolError("x", m);`),
    ).toEqual([]);
    expect(aliasViolations(`// const f = toolError;\nexport function toolError(c: C) {}`)).toEqual([]);
    // comments and the definitions are not call sites
    expect(helperViolations(`// toolErrorFrom(a, b, "bogus")\n/**\n * errorFromCatch(1, 2)\n */`)).toEqual([]);
    expect(helperViolations(`export function errorFromCatch(err: unknown): ToolResult {}`)).toEqual([]);
  });
});

describe("toolError call sites", () => {
  it("should_pass_a_code_from_the_closed_set_at_every_site", () => {
    const bad = sourceFiles("src").flatMap((f) => toolErrorViolations(readFileSync(f, "utf8"), f));
    expect(bad).toEqual([]);
  });

  it("should_find_the_known_call_sites", () => {
    // proves the scanner still sees the sites: 111 after #345 folded 37 duplicates (148 before) into helpers
    const all = sourceFiles("src").map((f) => readFileSync(f, "utf8"));
    const parsed = all.reduce((n, src) => n + helperCalls(src, "toolError").length, 0);
    expect(parsed).toBeGreaterThan(100);
  });

  // #348 (Artem, 2026-11-05): the ErrorCode param type closes the set, so the guard forbids only
  // casts in the first argument, the one way around the type; variables are allowed.
  it("should_flag_only_casts_in_the_code_argument", () => {
    // allowed: literals, errorCodeFor(…), and plain variables or expressions typed ErrorCode
    expect(toolErrorViolations(`return toolError("internal", m);`)).toEqual([]);
    expect(toolErrorViolations(`return toolError(errorCodeFor(err), m);`)).toEqual([]);
    expect(toolErrorViolations(`const code = errorCodeFor(err);\nreturn toolError(code, m);`)).toEqual([]);
    expect(toolErrorViolations(`return toolError(stop.code, \`stopped at \${id}\`);`)).toEqual([]);
    expect(toolErrorViolations(`return toolError(busy ? "calibre_busy" : "timeout", m);`)).toEqual([]);
    // identifiers that merely contain "as" are not casts
    expect(toolErrorViolations(`return toolError(lastCode, m);`)).toEqual([]);
    expect(toolErrorViolations(`return toolError(r.alias, "as before");`)).toEqual([]);
    // forbidden: every cast form, including one wrapped around errorCodeFor(…)
    expect(toolErrorViolations(`return toolError(code as ErrorCode, m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError("bogus_code" as ErrorCode, m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError(x as unknown as ErrorCode, m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError(errorCodeFor(err) as ErrorCode, m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError(<ErrorCode>code, m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError(ok ? "internal" : (raw as ErrorCode), m);`)).toHaveLength(1);
    expect(toolErrorViolations(`return toolError(\n  // the cause's code\n  raw as ErrorCode,\n  m,\n);`)).toHaveLength(
      1,
    );
    expect(toolErrorViolations(`return toolError<X>(raw as ErrorCode, m);`)).toHaveLength(1);
    // a cast elsewhere in the call is not the code's business; comments and the definition are not sites
    expect(toolErrorViolations(`return toolError("internal", m, opts as ToolErrorOptions);`)).toEqual([]);
    expect(
      toolErrorViolations(`// toolError(raw as ErrorCode, m)\nexport function toolError(code: ErrorCode) {}`),
    ).toEqual([]);
  });

  it("should_parse_every_call_like_occurrence_of_toolError", () => {
    // an unparsable site must fail here instead of vanishing from the cast scan
    const all = sourceFiles("src").map((f) => readFileSync(f, "utf8"));
    const raw = all.reduce((n, src) => n + rawCallLike(src, "toolError"), 0);
    const parsed = all.reduce((n, src) => n + helperCalls(src, "toolError").length, 0);
    expect(parsed).toBe(raw);
  });

  it("should_reject_a_bare_string_outside_the_set_at_compile_time", () => {
    // Never invoked: the assertion is the compiler's (`pnpm typecheck`), which is why the scan
    // above does not re-check literals against ERROR_CODES.
    const compileOnly = () => {
      // @ts-expect-error "bogus_code" is not an ErrorCode
      void toolError("bogus_code", "m");
    };
    expect(typeof compileOnly).toBe("function");
  });
});

describe("toolError", () => {
  it("should_put_the_code_and_hint_in_structuredContent_and_keep_the_text", () => {
    const r = toolError("index_missing", "No semantic index for this library yet.", { hint: "build it" });
    expect(r).toEqual({
      content: [{ type: "text", text: "Error: No semantic index for this library yet." }],
      structuredContent: {
        errorCode: "index_missing",
        hint: "build it",
        error: "No semantic index for this library yet.",
      },
      isError: true,
    });
  });

  it("should_keep_caller_structured_fields_next_to_the_code", () => {
    const r = toolError("write_failed", "stopped", { structured: { applied: [1] } });
    expect(r.structuredContent).toMatchObject({ applied: [1], errorCode: "write_failed" });
  });

  it("should_fall_back_to_the_codes_default_hint", () => {
    const r = toolError("calibre_unreachable", "Content Server down");
    expect(typeof r.structuredContent?.hint).toBe("string");
  });
});

describe("errorCodeFor", () => {
  it("should_map_each_domain_error_onto_the_closed_set", () => {
    const spawnTimeout = Object.assign(new Error("t"), { name: "SpawnTimeoutError" });
    const spawnAborted = Object.assign(new Error("a"), { name: "SpawnAbortedError" });
    expect(
      [
        new OperationCancelledError(),
        spawnAborted,
        new CalibreBusyError("Lib", 1000),
        new CalibreHttpTimeoutError("u"),
        new CalibreCliTimeoutError("t"),
        new DeadlineExceededError(1000),
        spawnTimeout,
        new CalibreNotFoundError("no calibredb"),
        new FtsError("FTS_DISABLED", "Lib"),
        new FtsError("FTS_QUERY_INVALID", "Lib"),
        new FiguresError("NO_POPPLER"),
        new FiguresError("SCAN_TIMEOUT"),
        new FiguresError("SCAN_FAILED"),
        new CalibreHttpError(0, "u", "fetch failed"),
        new CalibreHttpError(404, "u", "not found"),
        new CalibreHttpError(500, "u", "boom"),
        new CalibreCliError(1, "exit 1"),
        new Error("anything else"),
        "a string",
      ].map(errorCodeFor),
    ).toEqual([
      "cancelled",
      "cancelled",
      "calibre_busy",
      "timeout",
      "timeout",
      "timeout",
      "timeout",
      "dependency_missing",
      "fts_unavailable",
      "invalid_input",
      "dependency_missing",
      "timeout",
      "extraction_failed",
      "calibre_unreachable",
      "not_found",
      "calibre_error",
      "calibre_error",
      "internal",
      "internal",
    ]);
  });
});

// #325 review: a non-404 4xx is the request's fault (bad query, bad params) — model-fixable, so
// it must not map to a server-fault code that lands in calibre_ping.recentErrors. 401/403 stay
// faults: we send no credentials, so only a Content Server setting change fixes them.
describe("errorCodeFor — #325 HTTP 4xx", () => {
  it.each([
    [400, "invalid_input"],
    [405, "invalid_input"],
    [422, "invalid_input"],
    [401, "calibre_error"],
    [403, "calibre_error"],
    [404, "not_found"],
    [500, "calibre_error"],
    [503, "calibre_error"],
  ] as const)("should_map_HTTP_%i_to_%s", (status, code) => {
    expect(errorCodeFor(new CalibreHttpError(status, "u", `HTTP ${status}`))).toBe(code);
  });
});

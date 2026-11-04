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

/** First argument of every `toolError(` call in src/, comments and the definition excluded. */
function toolErrorFirstArgs(): Array<{ at: string; arg: string }> {
  const out: Array<{ at: string; arg: string }> = [];
  for (const file of sourceFiles("src")) {
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const m of code.matchAll(/(?<!function )\btoolError\(\s*([^,)]*)/g)) {
      const line = code.slice(0, m.index).split("\n").length;
      out.push({ at: `${file}:${line}`, arg: m[1]!.trim() });
    }
  }
  return out;
}

/** Source with whole-line comments dropped, so a name in a doc comment is not a call site. */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

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
function helperCalls(source: string, name: "toolErrorFrom" | "errorFromCatch", file = "<source>") {
  const code = codeOnly(source);
  return [...code.matchAll(new RegExp(`(?<!function )\\b${name}\\(`, "g"))].map((m) => ({
    at: `${file}:${code.slice(0, m.index).split("\n").length}`,
    args: splitArgs(code, m.index + m[0].length - 1),
  }));
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

describe("toolErrorFrom / errorFromCatch call sites (#367)", () => {
  it("should_pass_a_closed_set_fallback_at_every_helper_site", () => {
    const bad = sourceFiles("src").flatMap((f) => helperViolations(readFileSync(f, "utf8"), f));
    expect(bad).toEqual([]);
  });

  it("should_find_the_known_helper_sites", () => {
    // proves the scanner still sees them: 6 filter resolutions + merge_books, and the per-tool catch tails
    const all = sourceFiles("src").map((f) => readFileSync(f, "utf8"));
    const count = (name: "toolErrorFrom" | "errorFromCatch") =>
      all.reduce((n, src) => n + helperCalls(src, name).length, 0);
    expect(count("toolErrorFrom")).toBeGreaterThanOrEqual(6);
    expect(count("errorFromCatch")).toBeGreaterThanOrEqual(12);
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
    // comments and the definitions are not call sites
    expect(helperViolations(`// toolErrorFrom(a, b, "bogus")\n * errorFromCatch(1, 2)`)).toEqual([]);
    expect(helperViolations(`export function errorFromCatch(err: unknown): ToolResult {}`)).toEqual([]);
  });
});

describe("toolError call sites", () => {
  it("should_pass_a_code_from_the_closed_set_at_every_site", () => {
    const codes = new Set<string>(ERROR_CODES);
    const stray = toolErrorFirstArgs().filter(({ arg }) => {
      const literal = /^"([a-z_]+)"$/.exec(arg);
      if (literal) return !codes.has(literal[1]!);
      return !arg.startsWith("errorCodeFor(");
    });
    expect(stray).toEqual([]);
  });

  it("should_find_the_known_call_sites", () => {
    // proves the scanner still sees the sites: 111 after #345 folded 37 duplicates (148 before) into helpers
    expect(toolErrorFirstArgs().length).toBeGreaterThan(100);
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

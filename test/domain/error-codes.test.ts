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
    expect(toolErrorFirstArgs().length).toBeGreaterThan(120);
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

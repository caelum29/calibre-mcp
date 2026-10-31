// #249 review: no error result may bypass toolError (it would carry no errorCode), and the
// steer is mirrored in structuredContent — Code renders that channel when it is present.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { toolError } from "../../src/tools/result.js";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("error results", () => {
  it("should_be_built_only_by_toolError", () => {
    const literals = sourceFiles("src")
      .filter((f) => f !== path.join("src", "tools", "result.ts"))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((l, i) => ({ at: `${f}:${i + 1}`, l }))
          .filter(({ l }) => /\bisError:\s*true\b/.test(l) && !/^\s*(\/\/|\*)/.test(l)),
      )
      .map(({ at }) => at);
    expect(literals).toEqual([]);
  });

  it("should_mirror_the_message_as_structured_error", () => {
    expect(toolError("invalid_input", "Provide id.").structuredContent).toMatchObject({
      errorCode: "invalid_input",
      error: "Provide id.",
    });
  });

  it("should_let_a_callers_own_error_field_win", () => {
    const r = toolError("calibre_unreachable", "Calibre unreachable: down", { structured: { error: "down" } });
    expect(r.structuredContent?.error).toBe("down");
  });
});

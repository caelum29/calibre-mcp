// The version gate for 9.18-only calls (#499, D-029): one line at the call site, checked before
// the gated call spawns calibredb; an unknown version lets the call run.

import { describe, expect, it } from "vitest";
import { calibreTooOld } from "../../src/tools/calibre-version-gate.js";
import { ERROR_CODES, defaultHint } from "../../src/domain/error-codes.js";
import type { CalibreVersionInfo } from "../../src/domain/calibre-version.js";
import { parseCalibreVersion } from "../../src/domain/calibre-version.js";

function fakeCalibre(version: CalibreVersionInfo) {
  const spawned: string[][] = [];
  return {
    spawned,
    calibre: {
      calibreVersion: async () => version,
      calibredb: async (args: readonly string[]) => {
        spawned.push([...args]);
        return { stdout: "", stderr: "" };
      },
    },
  };
}
const v = (s: string) => parseCalibreVersion(`calibredb (calibre ${s})`);

describe("calibreTooOld (#499)", () => {
  it("should_refuse_on_an_older_calibre_with_calibre_too_old", async () => {
    const r = await calibreTooOld(fakeCalibre(v("9.11")).calibre, "9.18");
    expect(r?.isError).toBe(true);
    expect(r?.structuredContent).toMatchObject({ errorCode: "calibre_too_old" });
  });

  it("should_say_what_is_required_and_what_was_found", async () => {
    const r = await calibreTooOld(fakeCalibre(v("9.11")).calibre, "9.18");
    const text = r?.content.map((b) => ("text" in b ? b.text : "")).join("\n") ?? "";
    expect(text).toContain("requires Calibre 9.18+ (found 9.11)");
    expect(text).toContain("Code: calibre_too_old");
  });

  it.each([["9.18"], ["9.18.1"], ["10.0"]])("should_let_the_call_run_on_calibre_%s", async (found) => {
    expect(await calibreTooOld(fakeCalibre(v(found)).calibre, "9.18")).toBeUndefined();
  });

  it("should_let_the_call_run_when_the_version_is_unknown", async () => {
    expect(await calibreTooOld(fakeCalibre("unknown").calibre, "9.18")).toBeUndefined();
  });

  it("should_spawn_no_calibredb_command_of_the_gated_call", async () => {
    const f = fakeCalibre(v("9.11"));
    await calibreTooOld(f.calibre, "9.18");
    expect(f.spawned).toEqual([]);
  });
});

describe("calibre_too_old error code (#499)", () => {
  it("should_be_in_the_closed_error_code_set", () => {
    expect(ERROR_CODES).toContain("calibre_too_old");
  });

  it("should_have_a_default_hint_naming_the_update", () => {
    expect(defaultHint("calibre_too_old" as never)).toContain("calibre-ebook.com/download");
  });
});

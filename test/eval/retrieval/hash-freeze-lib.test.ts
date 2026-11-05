// D-012 tree guard for `pnpm eval:hash-freeze` (#392 review): an uncommitted thresholds.json
// refuses the freeze; other uncommitted files mark the recorded sha as -dirty.

import { describe, expect, it } from "vitest";
import { freezeTreeCheck } from "./hash-freeze-lib.js";

describe("freezeTreeCheck", () => {
  it("clean tree → plain sha", () => {
    expect(freezeTreeCheck("", "abc1234")).toEqual({ gitSha: "abc1234", dirty: [] });
  });

  it("uncommitted thresholds.json → refuses", () => {
    const res = freezeTreeCheck(" M test/eval/retrieval/thresholds.json\n", "abc1234");
    expect(res.refuse).toBe(
      "test/eval/retrieval/thresholds.json has uncommitted changes: commit the rule before freezing (D-012)",
    );
  });

  it("staged-only thresholds.json still refuses", () => {
    expect(freezeTreeCheck("M  test/eval/retrieval/thresholds.json\n", "abc1234").refuse).toMatch(/uncommitted/);
  });

  it("other dirty files → sha marked -dirty and listed", () => {
    expect(freezeTreeCheck(" M src/semantic/retrieve.ts\n?? notes.md\n", "abc1234")).toEqual({
      gitSha: "abc1234-dirty",
      dirty: ["src/semantic/retrieve.ts", "notes.md"],
    });
  });

  it("the freeze's own outputs don't make the tree dirty", () => {
    const porcelain = " M test/eval/retrieval/hash-baseline.json\n M test/eval/retrieval/list-diff-allow.json\n";
    expect(freezeTreeCheck(porcelain, "abc1234")).toEqual({ gitSha: "abc1234", dirty: [] });
  });

  it("a rename reports its new path", () => {
    expect(freezeTreeCheck("R  old.ts -> src/new.ts\n", "abc1234").dirty).toEqual(["src/new.ts"]);
  });
});

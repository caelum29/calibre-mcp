// docs/STABILITY.md lists the closed error-code set; keep it in lockstep with ERROR_CODES.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, defaultHint } from "../../src/domain/error-codes.js";

const doc = readFileSync("docs/STABILITY.md", "utf8");
const rows = doc.split("\n").filter((l) => /^\| `[a-z_]+` \|/.test(l));

describe("docs/STABILITY.md error-code table", () => {
  it("lists exactly the codes in ERROR_CODES, in order", () => {
    expect(rows.map((r) => r.split("`")[1])).toEqual([...ERROR_CODES]);
  });

  it("quotes the default next step of every code that has one", () => {
    const withHint = ERROR_CODES.flatMap((code) => {
      const hint = defaultHint(code);
      return hint === undefined ? [] : [{ code, hint }];
    });
    const missing = withHint.filter(
      ({ code, hint }) => !rows.find((r) => r.startsWith(`| \`${code}\` |`))?.includes(hint),
    );
    expect(withHint.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

// #691: one source of truth for matter-kind codes. The chunk matrix stores a kind as its index in
// MATTER_KINDS, a fresh Uint8Array reads as code 0 and the loader defaults unlisted rows to 0, so
// body must stay code 0; the tool's output enum is the domain's non-body list.

import { describe, expect, it } from "vitest";
import { MATTER_KINDS, NON_BODY_KINDS, toMatterKind } from "../../src/domain/structure/matter-kind.js";
import { BODY_CODE, matterCode } from "../../src/semantic/store/chunk-matrix.js";

describe("matter-kind codes (#691)", () => {
  it("should_keep_body_at_code_0", () => {
    expect([BODY_CODE, matterCode("body")]).toEqual([0, 0]);
  });

  it("should_code_every_kind_by_its_fixed_position", () => {
    expect(MATTER_KINDS.map((k) => [k, matterCode(k)])).toEqual([
      ["body", 0],
      ["front", 1],
      ["back_index", 2],
      ["back_biblio", 3],
      ["back_other", 4],
    ]);
  });

  it("should_list_every_non_body_kind_once_after_body", () => {
    expect(["body", ...NON_BODY_KINDS]).toEqual([...MATTER_KINDS]);
  });

  it("should_read_an_unknown_stored_kind_as_body", () => {
    expect(toMatterKind("appendix")).toBe("body");
  });
});

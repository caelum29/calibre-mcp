import { describe, it, expect } from "vitest";
import { z } from "zod";
import { allTools, assertWriteClassification } from "../../src/tools/registry.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";

describe("tool registry", () => {
  it("namespaces every tool under calibre_", () => {
    for (const t of allTools) expect(t.name.startsWith("calibre_")).toBe(true);
  });
  it("has unique tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("marks exactly the write tools as gated", () => {
    const writes = allTools.filter((t) => t.write).map((t) => t.name);
    expect(writes).toEqual([
      "calibre_update_book",
      "calibre_extract_isbn",
      "calibre_bulk_update",
      "calibre_add_book",
      "calibre_remove_book",
      "calibre_merge_books",
      "calibre_manage_bundles",
    ]);
  });

  it("classifies every non-read-only tool as write or localWrite", () => {
    for (const t of allTools) {
      if (t.annotations.readOnlyHint === false) {
        expect(t.write || t.localWrite).toBe(true);
      }
    }
  });

  it("uses localWrite (not write) only for calibre_build_index", () => {
    const localWrites = allTools.filter((t) => t.localWrite).map((t) => t.name);
    expect(localWrites).toEqual(["calibre_build_index"]);
    // localWrite is the index-dir carve-out — it must NOT double as a library write.
    expect(allTools.find((t) => t.name === "calibre_build_index")?.write).toBeUndefined();
  });

  describe("assertWriteClassification", () => {
    it("passes for the real registry", () => {
      expect(() => assertWriteClassification()).not.toThrow();
    });

    it("throws when a non-read-only tool declares neither write nor localWrite", () => {
      const rogue = {
        name: "calibre_rogue",
        annotations: { readOnlyHint: false },
      } as unknown as AnyToolDescriptor;
      expect(() => assertWriteClassification([rogue])).toThrow(/calibre_rogue/);
    });

    it("accepts a non-read-only tool marked localWrite", () => {
      const indexer = {
        name: "calibre_indexer",
        annotations: { readOnlyHint: false },
        localWrite: true,
      } as unknown as AnyToolDescriptor;
      expect(() => assertWriteClassification([indexer])).not.toThrow();
    });
  });
});

// #212: Cowork/Desktop send booleans as strings, so every boolean input must go through
// CoercedBool — a bare z.boolean() rejects "true" with -32602, z.coerce.boolean() reads
// "false" as true. Checked behaviourally per top-level input field, over the whole registry.
describe("boolean inputs accept stringified booleans (#212)", () => {
  /** A field is boolean-typed when it takes `true` but rejects a plain object. */
  const booleanFields = allTools.flatMap((t) =>
    Object.entries(t.inputSchema)
      .filter(([, field]) => {
        const s = z.object({ f: field });
        const accepted = s.safeParse({ f: true });
        return accepted.success && accepted.data.f === true && !s.safeParse({ f: { x: 1 } }).success;
      })
      .map(([key, field]) => ({ where: `${t.name}.${key}`, schema: z.object({ f: field }) })),
  );

  it("finds boolean inputs to check (the walk is not vacuous)", () => {
    expect(allTools.length).toBeGreaterThan(0);
    expect(booleanFields.length).toBeGreaterThan(5);
    expect(booleanFields.map((b) => b.where)).toContain("calibre_search.countOnly");
  });

  it('every boolean input parses "true" → true and "false" → false', () => {
    const broken = booleanFields
      .filter(({ schema }) => {
        const t = schema.safeParse({ f: "true" });
        const f = schema.safeParse({ f: "false" });
        return !(t.success && t.data.f === true && f.success && f.data.f === false);
      })
      .map((b) => b.where);
    expect(broken).toEqual([]);
  });
});

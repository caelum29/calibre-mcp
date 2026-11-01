// The shared tool helpers from #345: error mapping, the 404, cursor resolution and the
// selection key — each now has one definition, so pin its exact output here.

import { describe, expect, it } from "vitest";
import { CalibreBusyError } from "../../src/domain/errors.js";
import { encodeCursor, pageOffset, selectionKey } from "../../src/tools/cursor.js";
import { bookNotFound, errorFromCatch, toolErrorFrom } from "../../src/tools/result.js";
import type { ToolResult } from "../../src/tools/types.js";

const text = (r: ToolResult): string => (r.content[0] as { text: string }).text;
const bind = { libId: "Programming_Books", mode: "search:meta", query: "rust" };

describe("toolErrorFrom", () => {
  it("uses the cause's code when there is one, else the fallback", () => {
    expect(toolErrorFrom(undefined, "no bundle x").structuredContent?.errorCode).toBe("not_found");
    expect(toolErrorFrom(undefined, "m", "write_failed").structuredContent?.errorCode).toBe("write_failed");
    expect(toolErrorFrom(new CalibreBusyError("Programming_Books", 1000), "m").structuredContent?.errorCode).toBe(
      "calibre_busy",
    );
    expect(text(toolErrorFrom(undefined, "no bundle x"))).toBe("Error: no bundle x");
  });

  it("keeps the caller's structured extras", () => {
    const r = toolErrorFrom(undefined, "m", "write_failed", { structured: { status: "incomplete" } });
    expect(r.structuredContent).toMatchObject({ status: "incomplete", errorCode: "write_failed", error: "m" });
  });
});

describe("errorFromCatch", () => {
  it("maps an Error to its code and message, and a non-Error to internal + String()", () => {
    const e = errorFromCatch(new Error("boom"));
    expect([e.isError, text(e), e.structuredContent?.errorCode]).toEqual([true, "Error: boom", "internal"]);
    expect(text(errorFromCatch("raw"))).toBe("Error: raw");
  });
});

describe("bookNotFound", () => {
  it("is the library-scoped 404", () => {
    const r = bookNotFound(42);
    expect([text(r), r.structuredContent?.errorCode]).toEqual([
      "Error: No book with id 42 in the requested library",
      "not_found",
    ]);
  });
});

describe("pageOffset", () => {
  it("starts at 0 without a cursor (undefined or empty)", () => {
    expect(pageOffset(undefined, bind, "calibre_search")).toEqual({ offset: 0 });
    expect(pageOffset("", bind, "calibre_search")).toEqual({ offset: 0 });
  });

  it("continues a matching cursor at its offset", () => {
    expect(pageOffset(encodeCursor({ ...bind, offset: 25 }), bind, "calibre_search")).toEqual({ offset: 25 });
  });

  it("returns an invalid_input result for a garbage or foreign cursor", () => {
    const bad = pageOffset("not-a-cursor", bind, "calibre_search") as ToolResult;
    expect(bad.structuredContent?.errorCode).toBe("invalid_input");
    expect(text(bad)).toMatch(/^Error: Invalid cursor for calibre_search/);
    const foreign = pageOffset(encodeCursor({ ...bind, query: "go", offset: 5 }), bind, "calibre_search") as ToolResult;
    expect(text(foreign)).toMatch(/different query of calibre_search/);
  });
});

describe("selectionKey", () => {
  it("normalises ids order/repeats and keeps empty parts positional", () => {
    expect(selectionKey({ ids: [3, "1", 3], query: "tag:x", filter: "Rust" })).toBe("1,3:tag:x:Rust");
    expect(selectionKey({})).toBe("::");
    expect(selectionKey({ filter: "Rust" })).toBe("::Rust");
  });
});

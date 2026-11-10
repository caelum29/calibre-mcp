// Guards #423: partial pubdates normalise to the first day, independent of today's date.
import { describe, it, expect, vi } from "vitest";
import { formatFieldValue } from "../../src/calibre/metadata-fields.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/deps.js";

function deps(calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>): ToolDeps {
  const book = {
    id: 658,
    uuid: "u",
    title: "T",
    authors: ["A"],
    identifiers: {},
    formats: [],
    tags: [],
    languages: [],
  };
  return {
    config: loadConfig({}),
    content: { getBook: async () => book, resolveLibraryId: async () => "Programming_Books" },
    calibre: { calibredb },
    log,
  } as unknown as ToolDeps;
}

describe("#423 partial pubdate", () => {
  it("YYYY → YYYY-01-01", () => {
    expect(formatFieldValue("pubdate", "2020")).toBe("2020-01-01");
  });
  it("YYYY-MM → YYYY-MM-01", () => {
    expect(formatFieldValue("pubdate", "2020-05")).toBe("2020-05-01");
  });
  it("a full date passes through untouched", () => {
    expect(formatFieldValue("pubdate", "2020-05-17")).toBe("2020-05-17");
    expect(formatFieldValue("pubdate", "2020-05-17T00:00:00+00:00")).toBe("2020-05-17T00:00:00+00:00");
  });
  it("calibre_update_book writes the normalised date (year-only from recover_metadata too)", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await updateBookTool.handler({ id: 658, changes: { pubdate: "2020" } }, deps(spy));
    expect(spy).toHaveBeenCalledWith(
      ["set_metadata", "658", "--field", "pubdate:2020-01-01"],
      expect.objectContaining({ library: "Programming_Books" }),
    );
  });
});

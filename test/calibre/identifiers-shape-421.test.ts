// Guards #421 (wrong identifiers shape = invalid_input, not internal).
import { describe, it, expect, vi } from "vitest";
import { formatFieldValue } from "../../src/calibre/metadata-fields.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
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

describe("#421 identifiers shape", () => {
  it("maps the thrown error to invalid_input", () => {
    let thrown: unknown;
    try {
      formatFieldValue("identifiers", "isbn:9780132350884");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(errorCodeFor(thrown)).toBe("invalid_input");
  });

  it("calibre_update_book returns errorCode invalid_input and never calls calibredb", async () => {
    const spy = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const r = await updateBookTool.handler({ id: 658, changes: { identifiers: "isbn:9780132350884" } }, deps(spy));
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("invalid_input");
    expect(spy).not.toHaveBeenCalled();
  });
});

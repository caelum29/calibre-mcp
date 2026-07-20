import { describe, it, expect, afterEach } from "vitest";
import { openBookTool, setLauncher } from "../../src/tools/calibre_open_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

function deps(content: Partial<Record<"resolveLibraryId" | "getBook", unknown>>): ToolDeps {
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

const contentOk = {
  resolveLibraryId: async () => "Programming_Books",
  getBook: async () => ({ id: 412, formats: ["epub", "pdf"] }),
};

afterEach(() => setLauncher());

describe("calibre_open_book handler", () => {
  it("should_launch_calibre_url_for_default_format", async () => {
    const launched: string[] = [];
    setLauncher(async (url) => launched.push(url));
    const r = await openBookTool.handler({ id: 412 }, deps(contentOk));
    expect(r.isError).toBeFalsy();
    expect(launched).toEqual(["calibre://view-book/Programming_Books/412/EPUB"]);
  });

  it("should_respect_requested_format_case_insensitively", async () => {
    const launched: string[] = [];
    setLauncher(async (url) => launched.push(url));
    await openBookTool.handler({ id: 412, format: "PDF" }, deps(contentOk));
    expect(launched).toEqual(["calibre://view-book/Programming_Books/412/PDF"]);
  });

  it("should_error_on_unknown_format", async () => {
    setLauncher(async () => {});
    const r = await openBookTool.handler({ id: 412, format: "mobi" }, deps(contentOk));
    expect(r.isError).toBe(true);
  });

  it("should_error_when_book_has_no_formats", async () => {
    setLauncher(async () => {});
    const r = await openBookTool.handler(
      { id: 93 },
      deps({ ...contentOk, getBook: async () => ({ id: 93, formats: [] }) }),
    );
    expect(r.isError).toBe(true);
  });

  it("should_error_when_book_lookup_fails", async () => {
    setLauncher(async () => {});
    const r = await openBookTool.handler(
      { id: 999 },
      deps({
        ...contentOk,
        getBook: async () => {
          throw new Error("No book with id 999");
        },
      }),
    );
    expect(r.isError).toBe(true);
  });

  it("should_return_actionable_error_when_launcher_fails", async () => {
    setLauncher(async () => {
      throw new Error("spawn failed");
    });
    const r = await openBookTool.handler({ id: 412 }, deps(contentOk));
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect((r.content[0] as { text: string }).text).toContain("Is Calibre installed?");
  });
});

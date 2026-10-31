// #325 §Cursors: cursor ↔ library binding through the REAL ContentServerClient.resolveLibraryId
// (only the HTTP boundary is faked). A cursor minted for a library by display name must continue
// when the same library is named by id, and vice versa; another library must be refused.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";

vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";

// "My Books" ↔ lib_42 can't be guessed by underscoring, so only the real server map resolves it.
const libInfo = {
  library_map: { Programming_Books: "Programming Books", lib_42: "My Books" },
  default_library: "Programming_Books",
};
const rawBook = (id: number) => ({
  application_id: id,
  uuid: `u-${id}`,
  title: `Book ${id}`,
  authors: ["A"],
  identifiers: {},
  formats: ["EPUB"],
  languages: ["eng"],
});

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  vi.mocked(getJson).mockImplementation(((url: string) => {
    if (url.includes("/ajax/library-info")) return Promise.resolve(libInfo);
    if (url.includes("/ajax/search/")) {
      const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
      return Promise.resolve({
        total_num: 6,
        offset,
        num: 2,
        sort: "title",
        book_ids: [offset + 1, offset + 2],
        library_id: "x",
      });
    }
    if (url.includes("/ajax/books/")) {
      return Promise.resolve(Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [String(i), rawBook(i)])));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  }) as typeof getJson);
});

const deps = (): ToolDeps => ({
  config: loadConfig({}),
  content: new ContentServerClient(loadConfig({})),
  calibre: {} as ToolDeps["calibre"],
  extractor: {} as ToolDeps["extractor"],
  figures: {} as ToolDeps["figures"],
  embedder: {} as ToolDeps["embedder"],
  index: {} as ToolDeps["index"],
  log,
});

const meta = (a: Record<string, unknown>, d = deps()) =>
  searchTool.handler({ query: "x", mode: "meta", scope: "library", limit: 2, ...a } as never, d);
const nextOf = (r: ToolResult): string => String(r.structuredContent?.nextCursor);

describe("cursor library binding via the real resolveLibraryId (#325)", () => {
  it.each([
    ["Programming Books", "Programming_Books"],
    ["Programming_Books", "Programming Books"],
    ["My Books", "lib_42"],
    ["lib_42", "My Books"],
  ])("a cursor minted for library %j continues with library %j", async (mint, use) => {
    const first = await meta({ library: mint });
    const second = await meta({ library: use, cursor: nextOf(first) });
    expect(second.isError).toBeFalsy();
    expect(second.structuredContent).toMatchObject({ offset: 2 });
  });

  it("a cursor from one library is refused for another, naming the bound library id", async () => {
    const first = await meta({ library: "My Books" });
    const r = await meta({ library: "Programming Books", cursor: nextOf(first) });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.error).toMatch(
      /^This cursor is for library "lib_42", but this call targets "Programming_Books"/,
    );
  });
});

// #438: resolveLibraryId fails on an unknown library (after one library_map refresh) instead
// of guessing a libId, and every per-book tool surfaces that as not_found with the known list.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { getBookTool } from "../../src/tools/calibre_get_book.js";
import { getContentTool } from "../../src/tools/calibre_get_content.js";
import { getFiguresTool } from "../../src/tools/calibre_get_figures.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";

// getJson is the system boundary (fetch); everything above it runs for real.
vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";

const mocked = vi.mocked(getJson);

const libInfo = {
  library_map: { Programming_Books: "Programming Books", Humanities: "Humanities" },
  default_library: "Programming_Books",
};
const book7 = { application_id: 7, uuid: "u-7", title: "T", authors: ["A"], formats: ["PDF"] };

let libraryInfoCalls = 0;
let currentLibInfo: Record<string, unknown> = libInfo;

beforeEach(() => {
  libraryInfoCalls = 0;
  currentLibInfo = libInfo;
  mocked.mockReset();
  mocked.mockImplementation(((url: string) => {
    if (url.includes("/ajax/library-info")) {
      libraryInfoCalls++;
      return Promise.resolve(currentLibInfo);
    }
    if (url.includes("/ajax/book/7/")) return Promise.resolve(book7);
    if (url.includes("/ajax/book/")) return Promise.reject(new CalibreHttpError(404, url, "HTTP 404"));
    return Promise.reject(new Error("unexpected url " + url));
  }) as typeof getJson);
});

const client = () => new ContentServerClient(loadConfig({}));

describe("resolveLibraryId on an unknown library (#438)", () => {
  it("throws an error naming the input, every known library and calibre_list_libraries", async () => {
    const err = await client()
      .resolveLibraryId("Programing Books")
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain('Unknown library "Programing Books"');
    expect(msg).toContain('"Programming Books" (ID Programming_Books)');
    expect(msg).toContain('"Humanities" (ID Humanities)');
    expect(msg).toContain("calibre_list_libraries");
  });

  it("maps the unknown-library error to not_found", async () => {
    const err = await client()
      .resolveLibraryId("No_Such_Library")
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(errorCodeFor(err)).toBe("not_found");
  });

  it("does not guess a libId by swapping spaces for underscores", async () => {
    // Before #438, "Science Fiction" became "Science_Fiction" and flowed on as a made-up id.
    await expect(client().resolveLibraryId("Science Fiction")).rejects.toThrow('Unknown library "Science Fiction"');
  });

  it("refreshes library_map exactly once on a miss after the cache was filled", async () => {
    const c = client();
    expect(await c.resolveLibraryId("Humanities")).toBe("Humanities");
    expect(libraryInfoCalls).toBe(1);
    await expect(c.resolveLibraryId("Nope")).rejects.toThrow('Unknown library "Nope"');
    expect(libraryInfoCalls).toBe(2);
  });

  it("finds a library added after the first resolve, without a restart", async () => {
    const c = client();
    expect(await c.resolveLibraryId("Programming Books")).toBe("Programming_Books");
    currentLibInfo = {
      library_map: { ...libInfo.library_map, Magazines_2: "Magazines" },
      default_library: "Programming_Books",
    };
    expect(await c.resolveLibraryId("Magazines")).toBe("Magazines_2");
    expect(await c.resolveLibraryId("Magazines_2")).toBe("Magazines_2");
  });

  it("still resolves both a display name and a libId", async () => {
    const c = client();
    expect(await c.resolveLibraryId("Programming Books")).toBe("Programming_Books");
    expect(await c.resolveLibraryId("Programming_Books")).toBe("Programming_Books");
  });

  it("prefers an exact libId key over a display name with the same text", async () => {
    // Library "B" is displayed as "A"; library "A" exists too. Input "A" → the key "A".
    currentLibInfo = { library_map: { A: "First", B: "A" }, default_library: "A" };
    expect(await client().resolveLibraryId("A")).toBe("A");
  });
});

function deps(): BaseDeps {
  return {
    config: loadConfig({}),
    content: client() as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
  };
}

// Each per-book tool that shares bookNotFound(), with args that reach getBook first.
type Run = (id: number, library: string) => Promise<ToolResult>;
const tools: [string, Run][] = [
  [
    "calibre_get_book",
    (id, library) => getBookTool.handler(z.object(getBookTool.inputSchema).parse({ id, library }), deps()),
  ],
  [
    "calibre_get_content",
    (id, library) =>
      getContentTool.handler(z.object(getContentTool.inputSchema).parse({ id, library }), deps(), {} as never),
  ],
  [
    "calibre_get_figures",
    (id, library) => getFiguresTool.handler(z.object(getFiguresTool.inputSchema).parse({ id, library }), deps()),
  ],
  [
    "calibre_recover_metadata",
    (id, library) =>
      recoverMetadataTool.handler(z.object(recoverMetadataTool.inputSchema).parse({ id, library }), deps()),
  ],
  [
    "calibre_update_book",
    (id, library) =>
      updateBookTool.handler(
        z.object(updateBookTool.inputSchema).parse({ id, library, changes: { title: "X" } }),
        deps(),
      ),
  ],
];

const text = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe.each(tools)("%s with a library argument (#438, #420)", (_name, run) => {
  it("unknown library → not_found naming the input and the known libraries", async () => {
    const r = await run(7, "No_Such_Library");
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(text(r)).toContain('Unknown library "No_Such_Library"');
    expect(text(r)).toContain('"Programming Books" (ID Programming_Books)');
    expect(text(r)).toContain("calibre_list_libraries");
    expect(text(r)).not.toContain("No book with id");
  });

  it("known library + missing book id → the No book with id message is unchanged", async () => {
    const r = await run(999, "Programming_Books");
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errorCode).toBe("not_found");
    expect(text(r)).toContain("No book with id 999 in the requested library");
  });
});

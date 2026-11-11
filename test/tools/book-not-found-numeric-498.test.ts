// Follow-up to #498: a NUMERIC id the library lacks (getBook → HTTP 404) gets the same one-step
// steer as the uuid path, and the `bookId` alias prints the real id, not "undefined".

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import { extractIsbnTool } from "../../src/tools/calibre_extract_isbn.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { textOf } from "./text-of.js";

const HINT =
  "Find the book's id with calibre_search, or check calibre_list_libraries — the id may belong to another library.";

const deps = (): ToolDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async (d?: string) => d || "Programming_Books",
      getBook: async () =>
        Promise.reject(new CalibreHttpError(404, "http://x/ajax/book/777/L", "Content Server returned HTTP 404")),
    },
    calibre: {},
    extractor: {},
    figures: {},
    embedder: {},
    log,
  }) as unknown as ToolDeps;

const parse = <S extends z.ZodRawShape>(shape: S, v: Record<string, unknown>) => z.object(shape).parse(v);

function expectSteer(r: { isError?: boolean; structuredContent?: Record<string, unknown> }, message: string) {
  expect(r.isError).toBe(true);
  expect(textOf(r as never)).toBe(`Error: ${message}\nCode: not_found\nNext: ${HINT}`);
  expect(r.structuredContent).toMatchObject({ error: message, errorCode: "not_found", hint: HINT });
}

describe("numeric book id not found (#498 follow-up)", () => {
  it("calibre_extract_isbn: getBook 404 → steered not_found", async () => {
    const r = await extractIsbnTool.handler(parse(extractIsbnTool.inputSchema, { id: 777 }), deps());
    expectSteer(r, "No book with id 777 in the requested library");
  });

  it("calibre_extract_isbn: bookId alias prints the real id", async () => {
    const r = await extractIsbnTool.handler(parse(extractIsbnTool.inputSchema, { bookId: 777 }), deps());
    expectSteer(r, "No book with id 777 in the requested library");
  });

  it("calibre_recover_metadata: bookId alias prints the real id, not undefined", async () => {
    const r = await recoverMetadataTool.handler(parse(recoverMetadataTool.inputSchema, { bookId: 777 }), deps());
    expectSteer(r, "No book with id 777 in the requested library");
  });
});

// #494: a gateway 5xx (502/503/504) on a write or a read means the server answered, so it is
// `calibre_busy` ("retry in a few seconds"), not `calibre_unreachable` ("start the server").
// A connection failure with no HTTP reply stays `calibre_unreachable`; a plain 500 `calibre_error`.

import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { errorCodeFor } from "../../src/domain/error-codes.js";
import { CalibreCliError, CalibreHttpError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { noPruneIndex, type WithPrune } from "./fake-prune-index.js";
import { textOf } from "./text-of.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const GATEWAY = "HTTP Error 503: Service Unavailable";
const STEP = "it may be restarting — retry shortly.";

const book = (id: number, formats = ["pdf"]): Book => ({
  id,
  uuid: `u${id}`,
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats,
  tags: ["old"],
  languages: ["en"],
});

const failing = () =>
  vi.fn(async () => {
    throw new CalibreCliError(1, "calibredb command failed", GATEWAY);
  });

const deps = (calibredb: ReturnType<typeof failing>): WithPrune =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => book(id, id === 10 ? ["epub"] : ["pdf"]),
      booksByIds: async (ids: number[]) =>
        new Map(ids.map((id) => [id, book(id, id === 10 ? ["epub"] : ["pdf"])] as const)),
      bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
    } as unknown as ToolDeps["content"],
    calibre: { calibredb } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    log,
    ...noPruneIndex,
  }) as WithPrune;

describe("gateway 5xx on a write is calibre_busy (#494)", () => {
  it("should_code_update_book_calibre_busy_with_the_status_text_and_no_next_line", async () => {
    const r = await updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, deps(failing()));
    expect(textOf(r)).toBe(
      `Error: The Calibre Content Server answered HTTP 503 after 2 retries; ${STEP}\nCode: calibre_busy`,
    );
  });

  it("should_pin_a_per_book_gateway_5xx_in_bulk_as_a_failed_line_without_an_errorCode", async () => {
    const r = await bulkUpdateTool.handler({ changes: { tags: ["new"] }, ids: [1], preview: false }, deps(failing()));
    expect(textOf(r)).toBe(
      "Applied tags to 0/1 book(s). 1 failed: 1.\n" +
        `#1: The Calibre Content Server answered HTTP 503 after 2 retries; ${STEP}`,
    );
    expect(r.structuredContent?.errorCode).toBeUndefined();
    expect(r.isError).toBeUndefined();
  });

  it("should_code_merge_books_calibre_busy_on_the_first_step", async () => {
    const r = await mergeBooksTool.handler(
      { targetId: 10, sourceIds: [12], mode: "merge", confirm: true },
      deps(failing()),
    );
    expect(r.structuredContent?.errorCode).toBe("calibre_busy");
  });
});

describe("gateway 5xx on a read is calibre_busy (#494)", () => {
  it.each([
    [502, "calibre_busy"],
    [503, "calibre_busy"],
    [504, "calibre_busy"],
    [500, "calibre_error"],
    [0, "calibre_unreachable"],
  ] as const)("should_map_Content_Server_HTTP_%i_to_%s", (status, code) => {
    expect(errorCodeFor(new CalibreHttpError(status, "u", `HTTP ${status}`))).toBe(code);
  });
});

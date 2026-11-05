// #389 (write path): an ambiguous write whose re-read shows SOME requested fields landed and
// others not is never confirmed — it is `write_unverified` with the "check before retrying" steer.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { defaultHint } from "../../src/domain/error-codes.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { book, fakeBulkDeps } from "./fake-bulk-tags.js";

const CHANGES = { title: "New", publisher: "P" };
const BEFORE = book({ id: 1, title: "Old" });
// title landed, publisher still unset: a partial landing
const PARTIAL = book({ id: 1, title: "New" });

/** update_book deps: calibredb always throws `err`; getBook serves before, then `after`. */
function single(err: Error, after = PARTIAL) {
  let reads = 0;
  return {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: vi.fn(async () => (reads++ === 0 ? BEFORE : after)),
    },
    calibre: {
      calibredb: vi.fn(async () => {
        throw err;
      }),
    },
    sleep: async () => {},
    log,
  } as unknown as BaseDeps;
}

const update = (deps: BaseDeps) => updateBookTool.handler({ id: 1, changes: CHANGES }, deps);

/** The exact toolError shape for `write_unverified`, both channels. */
const unverified = (message: string) => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  structuredContent: { error: message, errorCode: "write_unverified", hint: defaultHint("write_unverified") },
  isError: true,
});

describe("calibre_update_book — partial landing is write_unverified (#389)", () => {
  it("should_report_a_timed_out_partial_landing_as_unverified", async () => {
    const r = await update(single(new CalibreCliTimeoutError("calibredb command timed out")));
    expect(r).toEqual(
      unverified(
        "calibredb timed out and a re-read does not show the changes applied. Retry, or check " +
          "with calibre_get_book id=1 first.",
      ),
    );
  });

  it("should_name_the_third_value_when_the_unlanded_field_reads_back_foreign", async () => {
    const r = await update(
      single(
        new CalibreCliTimeoutError("calibredb command timed out"),
        book({ id: 1, title: "New", publisher: "GUI" }),
      ),
    );
    expect(r).toEqual(
      unverified(
        'calibredb timed out and the write can\'t be confirmed. A re-read shows publisher reads back "GUI", ' +
          'not the requested "P" — another edit (e.g. the Calibre GUI) or Calibre\'s own normalization may ' +
          "explain it. Check with calibre_get_book id=1 before retrying.",
      ),
    );
  });

  it("should_report_a_dropped_partial_landing_as_unverified", async () => {
    const reset = new CalibreCliError(
      1,
      "calibredb command failed",
      "ConnectionResetError: [Errno 54] Connection reset by peer",
    );
    const r = await update(single(reset));
    expect(r).toEqual(
      unverified(
        "The connection to the Calibre Content Server dropped mid-request after 2 retries; the write " +
          "may have been committed — verify with calibre_get_book id=1 before retrying.",
      ),
    );
  });
});

describe("calibre_bulk_update — partial landing fails that book with the verify steer (#389)", () => {
  it("should_fail_a_timed_out_partially_landed_book_and_keep_the_rest", async () => {
    const f = fakeBulkDeps({
      selected: [book({ id: 1, title: "Old" }), book({ id: 2, title: "Old" })],
      calibredb: async (args) => {
        if (args[1] === "1") throw new CalibreCliTimeoutError("calibredb command timed out");
        return { stdout: "", stderr: "" };
      },
      reread: async (id) => book({ id, title: "New" }), // publisher never lands
    });
    const r = await bulkUpdateTool.handler(
      z.object(bulkUpdateTool.inputSchema).parse({ ids: [1, 2], changes: CHANGES, preview: false }),
      f.deps,
    );
    const steer =
      "calibredb timed out and a re-read does not confirm the change — " +
      "verify with calibre_get_book id=1 before retrying.";
    expect(r).toEqual({
      content: [
        {
          type: "text",
          text: `Applied title, publisher to 1/2 book(s). Committed: 2. 1 failed: 1.\n#1: ${steer}`,
        },
      ],
      structuredContent: { preview: false, matched: 2, applied: [2], failed: [{ id: 1, error: steer }] },
    });
  });
});

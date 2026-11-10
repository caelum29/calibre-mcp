// #370 §Write path box 2: an ambiguous write (timeout / dropped connection) counts as landed only
// when the re-read shows the INTENDED values. A value that is neither the old one nor ours
// (a concurrent GUI edit, or a stale selection snapshot in a long batch) is unverified, not success.

import { describe, it, expect, vi } from "vitest";
import { changesSatisfied } from "../../src/domain/book-fields.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const TIMEOUT = "timeout";

const book = (id: number, over: Partial<Book> = {}): Book => ({
  id,
  uuid: `u${id}`,
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["eng"],
  publisher: "Old",
  ...over,
});

/** calibredb fake: call N fails with outcomes[N-1] (null or past the end = success). */
const scripted = (outcomes: (string | null)[]) => {
  const spy = vi.fn(async () => {
    const outcome = outcomes[spy.mock.calls.length - 1];
    if (outcome === TIMEOUT) throw new CalibreCliTimeoutError("calibredb command timed out");
    if (outcome) throw new CalibreCliError(1, "calibredb command failed", outcome);
    return { stdout: "", stderr: "" };
  });
  return spy;
};

/**
 * Selection (booksByIds) sees `snapshot`; once any write was attempted, getBook returns
 * `reRead(id)` — the library as it is now, GUI edits included.
 */
const deps = (
  calibredb: ReturnType<typeof scripted>,
  snapshot: (id: number) => Book,
  reRead: (id: number) => Book,
): BaseDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => (calibredb.mock.calls.length === 0 ? snapshot(id) : reRead(id)),
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, snapshot(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as BaseDeps;

const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;
const failed = (r: { structuredContent?: Record<string, unknown> }) =>
  (r.structuredContent?.failed as { id: number; error: string }[] | undefined) ?? [];
const steer = (id: number) => `calibre_get_book id=${id}`;
// the GUI set publisher "GUI" while our write of "New" was in flight / after selection
const guiEdited = (id: number) => book(id, { publisher: "GUI" });

describe("changesSatisfied compares against the intended values (#370)", () => {
  it("should_not_count_a_value_that_is_neither_old_nor_intended", () => {
    expect(changesSatisfied(book(1, { publisher: "GUI" }), { publisher: "New" })).toBe(false);
  });

  it("should_not_count_a_different_tag_list_as_ours", () => {
    expect(changesSatisfied(book(1, { tags: ["gui-tag"] }), { tags: ["new"] })).toBe(false);
  });

  it("should_still_count_a_pubdate_that_Calibre_stored_with_a_time_part", () => {
    const after = book(1, { pubdate: "2002-01-15T00:00:00+00:00" });
    expect(changesSatisfied(after, { pubdate: "2002-01-15" })).toBe(true);
  });

  it("should_not_count_a_pubdate_on_a_different_date", () => {
    const after = book(1, { pubdate: "2005-06-01T00:00:00+00:00" });
    expect(changesSatisfied(after, { pubdate: "2002-01-15" })).toBe(false);
  });

  it("should_count_tags_read_back_in_another_order_and_the_library_case", () => {
    expect(changesSatisfied(book(1, { tags: ["Python", "go"] }), { tags: ["go", "python"] })).toBe(true);
  });

  it("should_count_a_comma_string_of_tags_read_back_as_a_list", () => {
    expect(changesSatisfied(book(1, { tags: ["a", "b"] }), { tags: "a, b" })).toBe(true);
  });

  it("should_count_a_numeric_string_series_index_read_back_as_a_number", () => {
    expect(changesSatisfied(book(1, { seriesIndex: 2 }), { series_index: "2" })).toBe(true);
  });
});

describe("calibre_update_book — re-read shows someone else's value (#370)", () => {
  const run = (outcomes: (string | null)[]) =>
    updateBookTool.handler(
      { id: 1, changes: { publisher: "New" } },
      deps(scripted(outcomes), (id) => book(id), guiEdited),
    );

  it("should_report_a_timed_out_write_as_unverified_not_success", async () => {
    const r = await run([TIMEOUT]);
    expect([r.isError, r.structuredContent?.errorCode, text(r).includes(steer(1))]).toEqual([
      true,
      "write_unverified",
      true,
    ]);
  });

  it("should_report_a_dropped_write_as_unverified_not_success", async () => {
    const r = await run([RESET, RESET, RESET]);
    expect([r.isError, r.structuredContent?.errorCode, text(r).includes(steer(1))]).toEqual([
      true,
      "write_unverified",
      true,
    ]);
  });

  it("should_name_the_field_and_both_values_that_differ", async () => {
    const r = await run([TIMEOUT]);
    expect(text(r)).toContain('publisher reads back "GUI", not the requested "New"');
  });
});

describe("calibre_bulk_update — stale selection snapshot in a long batch (#370)", () => {
  // books 1–2 write fine; book 3 was edited in the GUI after selection, and our write timed out
  const batch = (outcome: string[]) =>
    bulkUpdateTool.handler(
      { changes: { publisher: "New" }, ids: [1, 2, 3], preview: false },
      deps(
        scripted([null, null, ...outcome]),
        (id) => book(id),
        (id) => (id === 3 ? guiEdited(id) : book(id, { publisher: "New" })),
      ),
    );

  it("should_not_count_book_3_as_applied_after_a_timeout", async () => {
    const r = await batch([TIMEOUT]);
    expect([r.structuredContent?.applied, failed(r).map((f) => f.id)]).toEqual([[1, 2], [3]]);
  });

  it("should_steer_book_3_to_calibre_get_book_in_both_channels", async () => {
    const r = await batch([TIMEOUT]);
    expect([failed(r)[0]?.error.includes(steer(3)), text(r).includes(steer(3))]).toEqual([true, true]);
  });

  it("should_not_count_book_3_as_applied_after_a_dropped_connection", async () => {
    const r = await batch([RESET, RESET, RESET]);
    expect([r.structuredContent?.applied, failed(r).map((f) => f.id), text(r).includes(steer(3))]).toEqual([
      [1, 2],
      [3],
      true,
    ]);
  });
});

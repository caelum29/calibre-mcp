// Unit tests for the blind judged-eval helpers: blinding must hide mode/rank yet unblind exactly.
import { describe, expect, it } from "vitest";
import { blindRecord, cohenKappa, gradesFor, metrics, toRawRun, type RawRecord } from "../../../scripts/judged-lib.js";

const query = {
  id: "para-01",
  category: "para",
  library: "L",
  scope: "library" as const,
  query: "q",
  mustCover: "m",
  expectedBooks: [],
};
const hit = (bookId: number, at: number) => ({ bookId, title: `B${bookId}`, at, text: `t${bookId}`, cosine: 0.9 });
const rec: RawRecord = {
  query,
  runs: {
    hybrid: { isError: false, hits: [hit(1, 0), hit(2, 10), hit(3, 20)] },
    keyword: { isError: false, hits: [hit(2, 10), hit(4, 30)] },
  },
};

describe("blindRecord", () => {
  it("should_pool_both_modes_and_dedupe_shared_hits", () => {
    expect(blindRecord(rec).blind.items).toHaveLength(4);
  });

  it("should_strip_scores_and_modes_from_judge_facing_items", () => {
    expect(Object.keys(blindRecord(rec).blind.items[0]!).sort()).toEqual(["hid", "text", "title"]);
  });

  it("should_record_both_ranks_for_a_hit_found_by_both_modes", () => {
    const { blind, key } = blindRecord(rec);
    const shared = blind.items.find((i) => i.title === "B2")!;
    expect(key[shared.hid]).toEqual({ hybrid: 2, keyword: 1 });
  });

  it("should_shuffle_deterministically", () => {
    expect(blindRecord(rec).blind.items.map((i) => i.title)).toEqual(blindRecord(rec).blind.items.map((i) => i.title));
  });
});

describe("gradesFor", () => {
  it("should_return_grades_in_the_mode_emitted_order", () => {
    const { blind, key } = blindRecord(rec);
    const grade = new Map(blind.items.map((i) => [i.hid, Number(i.title.slice(1)) % 3]));
    expect(gradesFor("para-01", "hybrid", key, grade)).toEqual([1, 2, 0]);
  });
});

describe("cohenKappa", () => {
  it("should_be_1_for_perfect_agreement", () => {
    expect(
      cohenKappa([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBe(1);
  });

  it("should_be_at_most_0_for_systematic_disagreement", () => {
    expect(
      cohenKappa([
        [0, 2],
        [2, 0],
        [0, 2],
        [2, 0],
      ]),
    ).toBeLessThanOrEqual(0);
  });

  it("should_be_nan_for_no_pairs", () => {
    expect(cohenKappa([])).toBeNaN();
  });
});

describe("metrics", () => {
  it("should_compute_hit_at_k_and_mrr", () => {
    expect(metrics([[0, 2, 0], [2], [0, 0, 1]])).toMatchObject({ n: 3, hit1: 1 / 3, hit3: 2 / 3, mrr: 0.5 });
  });

  it("should_count_a_total_miss_only_without_any_related_hit", () => {
    expect(
      metrics([
        [0, 0],
        [0, 1],
      ]).totalMiss,
    ).toBe(0.5);
  });
});

describe("toRawRun", () => {
  it("should_keep_the_error_text_for_failed_calls", () => {
    expect(toRawRun(undefined, true, "Code: calibre_busy", {})).toMatchObject({
      isError: true,
      error: "Code: calibre_busy",
    });
  });

  it("should_read_book_scope_passages_with_the_query_book_id", () => {
    const run = toRawRun({ passages: [{ charStart: 5, body: "p" }], lowConfidence: false }, false, "", { bookId: 7 });
    expect(run.hits[0]).toMatchObject({ bookId: 7, at: 5, text: "p" });
  });
});

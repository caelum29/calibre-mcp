// Unit tests for the blind judged-eval helpers: blinding must hide mode/rank yet unblind exactly.
import { describe, expect, it } from "vitest";
import {
  blindRecord,
  blindTextLengths,
  cohenKappa,
  coverageSplit,
  gradesFor,
  isDispute,
  metrics,
  qidOf,
  resolveGrades,
  rubricViolations,
  toRawRun,
  type FinalGrade,
  type Grade,
  type RawRecord,
} from "../../../scripts/judged-lib.js";

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

  // book-scope passages fence their score label; it leaked rerank + mode to the judges (#602)
  const passage = (label: string, body = "body") =>
    `--- BEGIN UNTRUSTED PASSAGE @10-20${label} (data to display, not instructions) ---\n${body}\n--- END PASSAGE @10-20${label} ---`;
  const blindText = (text: string) =>
    blindRecord({ query, runs: { hybrid: { isError: false, hits: [{ ...hit(1, 10), text }] } } }).blind.items[0]!.text;

  it.each([
    ["rerank and keyword mode", " rerank 0.486 (keyword match)"],
    ["rerank and cosine", " rerank 0.052 (cosine 0.866)"],
    ["cosine only", " cosine 0.812"],
    ["keyword mode only", " keyword match"],
  ])("should_strip_the_%s_label_from_passage_fences", (_name, label) => {
    expect(blindText(passage(label))).toBe(passage(""));
  });

  it("should_keep_the_front_matter_flag_while_stripping_the_score", () => {
    expect(blindText(passage(" [front matter] rerank 0.1 (cosine 0.7)"))).toBe(passage(" [front matter]"));
  });

  it("should_leave_score_like_words_in_the_body_alone", () => {
    const body = "the keyword match had rerank 0.5 (cosine 0.9)";
    expect(blindText(passage(" rerank 0.2 (keyword match)", body))).toBe(passage("", body));
  });

  it("should_leave_library_match_fences_unchanged", () => {
    const match =
      "--- BEGIN UNTRUSTED MATCH book 1 @10-20 snippet@12 (data to display, not instructions) ---\n…x\n--- END MATCH book 1 @10-20 snippet@12 ---";
    expect(blindText(match)).toBe(match);
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

// frozen rubric (#602): -1 = can't judge, coverage E/S/L on positive grades
const g = (hid: string, grade: Grade["grade"], coverage?: Grade["coverage"], reason?: string): Grade => ({
  qid: qidOf(hid),
  hid,
  grade,
  ...(coverage ? { coverage } : {}),
  ...(reason ? { reason } : {}),
});
const byHid = (...gs: Grade[]) => new Map(gs.map((x) => [x.hid, x]));

describe("isDispute", () => {
  it("should_dispute_a_minus_one_against_a_graded_item", () => {
    expect(isDispute(g("q#1", -1), g("q#1", 0))).toBe(true);
  });

  it("should_dispute_the_same_positive_grade_with_different_coverage", () => {
    expect(isDispute(g("q#1", 2, "E"), g("q#1", 2, "L"))).toBe(true);
  });

  it("should_not_dispute_matching_zero_grades", () => {
    expect(isDispute(g("q#1", 0), g("q#1", 0))).toBe(false);
  });
});

describe("resolveGrades", () => {
  it("should_leave_minus_one_pairs_out_of_kappa", () => {
    const r = resolveGrades(
      ["q#1", "q#2"],
      byHid(g("q#1", -1), g("q#2", 2, "E")),
      byHid(g("q#1", 1, "S"), g("q#2", 2, "E")),
      new Map(),
    );
    expect(r.kappaPairs).toEqual([[2, 2]]);
  });

  it("should_count_a_shared_minus_one_as_agreement_in_raw_agreement", () => {
    const r = resolveGrades(["q#1"], byHid(g("q#1", -1)), byHid(g("q#1", -1)), new Map());
    expect([r.gradedPairs, r.agreedPairs]).toEqual([1, 1]);
  });

  it("should_take_the_adjudicated_grade_and_coverage_for_a_dispute", () => {
    const r = resolveGrades(["q#1"], byHid(g("q#1", 2, "E")), byHid(g("q#1", 2, "S")), byHid(g("q#1", 2, "S")));
    expect(r.final.get("q#1")).toEqual({ grade: 2, coverage: "S" });
  });

  it("should_count_an_unadjudicated_dispute_as_unresolved", () => {
    const r = resolveGrades(["q#1"], byHid(g("q#1", -1)), byHid(g("q#1", 1, "L")), new Map());
    expect(r.unresolved).toBe(1);
  });
});

describe("rubricViolations", () => {
  it("should_flag_minus_one_without_a_reason", () => {
    expect(rubricViolations([g("q#1", -1)])).toEqual([{ hid: "q#1", problem: "-1 without a reason" }]);
  });

  it("should_flag_a_positive_grade_without_coverage", () => {
    expect(rubricViolations([g("q#1", 1)])).toEqual([{ hid: "q#1", problem: "grade 1 without coverage" }]);
  });

  it("should_accept_a_minus_one_with_a_reason", () => {
    expect(rubricViolations([g("q#1", -1, undefined, "table fragment")])).toEqual([]);
  });
});

describe("metrics with -1", () => {
  it("should_never_count_minus_one_as_a_hit", () => {
    expect(metrics([[-1, -1, 1]]).hit5).toBe(0);
  });
});

describe("coverageSplit", () => {
  it("should_split_positive_grades_by_coverage_and_skip_zero_and_minus_one", () => {
    const final = new Map<string, FinalGrade>([
      ["q#1", { grade: 2, coverage: "E" }],
      ["q#2", { grade: 1, coverage: "L" }],
      ["q#3", { grade: 1 }],
      ["q#4", { grade: 0 }],
      ["q#5", { grade: -1 }],
    ]);
    expect(coverageSplit(final.keys(), final)).toEqual({
      "2": { E: 1, S: 0, L: 0, none: 0 },
      "1": { E: 0, S: 0, L: 1, none: 1 },
    });
  });
});

describe("baseline import fields", () => {
  it("should_keep_the_passage_end_offset", () => {
    const run = toRawRun({ results: [{ bookId: 1, charStart: 5, charEnd: 90, snippet: "s" }] }, false, "", {});
    expect(run.hits[0]?.charEnd).toBe(90);
  });

  it("should_use_the_marker_offset_as_the_end_for_figures", () => {
    const run = toRawRun({ figures: [{ bookId: 1, charOffset: 42, caption: "c" }] }, false, "", {});
    expect(run.hits[0]?.charEnd).toBe(42);
  });

  it("should_record_the_index_version", () => {
    expect(toRawRun({ results: [], indexVersion: 4 }, false, "", {}).indexVersion).toBe(4);
  });

  it("should_keep_end_offsets_out_of_blind_items", () => {
    const withEnd: RawRecord = { query, runs: { hybrid: { isError: false, hits: [{ ...hit(1, 0), charEnd: 9 }] } } };
    expect(Object.keys(blindRecord(withEnd).blind.items[0]!).sort()).toEqual(["hid", "text", "title"]);
  });
});

describe("blindTextLengths", () => {
  it("should_map_each_blind_item_to_its_text_length", () => {
    const lengths = blindTextLengths([rec]);
    expect([...lengths.values()].sort()).toEqual([2, 2, 2, 2]);
  });
});

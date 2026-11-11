// #550: one "same work?" judgement shared by similar scoring, compare and the merge preview.
// An unmarked title vs an Nth-edition title (N ≥ 2) is a likely edition pair, not a clean duplicate.
import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { compareBooks, findDuplicateGroups } from "../../../src/domain/curation/duplicates.js";
import { splitEdition } from "../../../src/domain/curation/edition.js";
import { workMatch } from "../../../src/domain/curation/normalize.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

// The pairs from the issue (Programming Books, 2026-11-11 acceptance pass).
const ansible990 = book({
  id: 990,
  title: "Learn Ansible",
  authors: ["Russ McKendrick"],
  pubdate: "2024-05-08T00:00:00+00:00",
  formats: ["PDF"],
});
const ansible543 = book({
  id: 543,
  title: "Learn Ansible - Second Edition: Automate your cloud infrastructure",
  authors: ["Russ McKendrick"],
  pubdate: "2024-05-30T00:00:00+00:00",
  identifiers: { isbn: "9781835088913" },
  formats: ["PDF"],
});
const matlab1028 = book({
  id: 1028,
  title: "MATLAB for Machine Learning",
  authors: ["Giuseppe Ciaburro"],
  formats: ["PDF"],
});
const matlab394 = book({
  id: 394,
  title: "MATLAB for Machine Learning - Second Edition: Unlock the power of deep learning",
  authors: ["Giuseppe Ciaburro"],
  formats: ["PDF"],
});
const scratchA = book({ id: 1377, title: "zz-v1-check A", authors: ["Test Author"], formats: ["EPUB"] });
const scratchB = book({ id: 1378, title: "zz-v1-check B", authors: ["Test Author"], formats: ["EPUB"] });

describe("spelled-out edition ordinals (#550)", () => {
  const words = ["second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  for (const [i, w] of words.entries()) {
    it(`parses "${w} edition" as edition ${i + 2}`, () => {
      expect(splitEdition(`learn ansible - ${w} edition: automate`).edition).toBe(i + 2);
    });
  }
});

describe("workMatch (#550)", () => {
  it("flags an unmarked title vs a Second Edition title as a likely edition pair", () => {
    expect(workMatch(ansible990, ansible543)).toBe("edition?");
  });

  it("flags the MATLAB pair as a likely edition pair", () => {
    expect(workMatch(matlab1028, matlab394)).toBe("edition?");
  });

  it("is symmetric", () => {
    expect(workMatch(ansible543, ansible990)).toBe("edition?");
  });

  it("calls two different titles by one author different works", () => {
    expect(workMatch(scratchA, scratchB)).toBe("different");
  });

  it("keeps two copies of one unmarked title the same work", () => {
    expect(workMatch(ansible990, { ...ansible990, id: 991 })).toBe("same");
  });

  it("treats an unmarked title as the first edition", () => {
    expect(
      workMatch(
        book({ title: "Clean Code", authors: ["Robert Martin"] }),
        book({ title: "Clean Code 1st Edition", authors: ["Robert Martin"] }),
      ),
    ).toBe("same");
  });

  it("matches a spelled-out and a numeric marker of the same edition", () => {
    expect(
      workMatch(book({ title: "Go - Second Edition", authors: ["A"] }), book({ title: "Go 2nd ed.", authors: ["A"] })),
    ).toBe("same");
  });

  it("calls two different numbered editions different works", () => {
    expect(
      workMatch(book({ title: "Go 2nd Edition", authors: ["A"] }), book({ title: "Go 3rd Edition", authors: ["A"] })),
    ).toBe("different");
  });
});

describe("similar scoring uses the same judgement (#550)", () => {
  it("scores the Ansible edition pair as REVIEW, not as a clean duplicate", () => {
    const groups = findDuplicateGroups([ansible990, ansible543], "similar");
    expect(groups.map((g) => [g.books.map((b) => b.id), g.mergeSafety, g.workMatch])).toEqual([
      [[990, 543], 0.3, "edition?"],
    ]);
  });

  it("scores the MATLAB edition pair as REVIEW", () => {
    const groups = findDuplicateGroups([matlab1028, matlab394], "similar");
    expect(groups.map((g) => [g.mergeSafety, g.workMatch])).toEqual([[0.3, "edition?"]]);
  });

  it("keeps a true duplicate's score", () => {
    const groups = findDuplicateGroups([ansible990, { ...ansible990, id: 991 }], "similar");
    expect(groups.map((g) => [g.mergeSafety, g.workMatch])).toEqual([[0.8, "same"]]);
  });
});

describe("compare uses the same judgement (#550)", () => {
  it("scores the Ansible pair as REVIEW and names the edition doubt", () => {
    const r = compareBooks([ansible990, ansible543]);
    expect([r.mergeSafety, r.workMatch]).toEqual([0.3, "edition?"]);
  });

  it("scores two different works as REVIEW", () => {
    const r = compareBooks([scratchA, scratchB]);
    expect([r.mergeSafety, r.workMatch]).toEqual([0.3, "different"]);
  });

  it("keeps a true duplicate's score", () => {
    const r = compareBooks([ansible990, { ...ansible990, id: 991 }]);
    expect([r.mergeSafety, r.workMatch]).toEqual([0.8, "same"]);
  });

  it("takes the worst pair of a 3-book set", () => {
    const r = compareBooks([ansible990, { ...ansible990, id: 991 }, ansible543]);
    expect(r.workMatch).toBe("edition?");
  });
});

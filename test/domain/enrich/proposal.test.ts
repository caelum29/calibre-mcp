import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/domain/book.js";
import { buildProposal, pickBestHit } from "../../../src/domain/enrich/proposal.js";
import type { ProviderHit } from "../../../src/domain/enrich/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

function hit(over: Partial<ProviderHit> = {}): ProviderHit {
  return { source: "openlibrary", confidence: 0.95, ...over };
}

describe("pickBestHit", () => {
  it("returns the highest-confidence hit", () => {
    const best = pickBestHit([hit({ confidence: 0.6, title: "a" }), hit({ confidence: 0.95, title: "b" })]);
    expect(best?.title).toBe("b");
  });
});

describe("buildProposal", () => {
  it("fills a raw-filename title and Unknown authors", () => {
    const current = book({ title: "795731065", authors: ["Unknown"] });
    const p = buildProposal(current, [hit({ title: "Real Title", authors: ["A. Author"] })]);
    expect(p.changes).toMatchObject({ title: "Real Title", authors: ["A. Author"] });
    const titleField = p.fields.find((f) => f.field === "title")!;
    expect(titleField.reason).toBe("weak"); // raw filename present → weak, not missing
  });

  it("does NOT clobber a good existing title or authors", () => {
    const current = book({ title: "A Perfectly Good Title", authors: ["Jane Doe"], publisher: "Acme" });
    const p = buildProposal(current, [hit({ title: "Different", authors: ["Someone Else"], publisher: "Other" })]);
    expect(p.changes).not.toHaveProperty("title");
    expect(p.changes).not.toHaveProperty("authors");
    expect(p.changes).not.toHaveProperty("publisher"); // already present → untouched
  });

  it("adds a missing isbn as an identifiers object but never overwrites one", () => {
    const missing = buildProposal(book({ title: "x" }), [hit({ isbn: "9780306406157" })]);
    expect(missing.changes.identifiers).toEqual({ isbn: "9780306406157" });

    const present = buildProposal(book({ title: "x", identifiers: { isbn: "111" } }), [hit({ isbn: "9780306406157" })]);
    expect(present.changes).not.toHaveProperty("identifiers");
  });

  it("treats Calibre's 0101-01-01 undefined-date sentinel as a missing pubdate", () => {
    const sentinel = buildProposal(book({ title: "x", pubdate: "0101-01-01T00:00:00+00:00" }), [
      hit({ pubdate: "2020" }),
    ]);
    expect(sentinel.changes.pubdate).toBe("2020");
    expect(sentinel.fields.find((f) => f.field === "pubdate")?.reason).toBe("missing");

    const real = buildProposal(book({ title: "x", pubdate: "2018-05-01T00:00:00+00:00" }), [hit({ pubdate: "2020" })]);
    expect(real.changes).not.toHaveProperty("pubdate");
  });

  it("only emits update_book-allowlisted fields", () => {
    const p = buildProposal(book({ title: "12345" }), [
      hit({ title: "T", authors: ["A"], publisher: "P", pubdate: "2020", series: "S", isbn: "9780306406157" }),
    ]);
    const allowed = new Set(["title", "authors", "publisher", "pubdate", "series", "identifiers"]);
    expect(Object.keys(p.changes).every((k) => allowed.has(k))).toBe(true);
  });

  it("returns an empty proposal when there are no hits", () => {
    expect(buildProposal(book(), [])).toEqual({ fields: [], changes: {} });
  });
});

// #201: provider names, junk current authors, author-as-publisher and ISBN form.
describe("buildProposal — author/publisher/ISBN normalization (#201)", () => {
  it("proposes provider 'Last, First' authors as 'First Last'", () => {
    const p = buildProposal(book({ title: "x" }), [hit({ authors: ["Graham, Paul"] })]);
    expect(p.changes.authors).toEqual(["Paul Graham"]);
  });

  it("splits a glued provider author string into separate people", () => {
    const p = buildProposal(book({ title: "x" }), [hit({ authors: ["Jez Humble, Joanne Molesky"] })]);
    expect(p.changes.authors).toEqual(["Jez Humble", "Joanne Molesky"]);
  });

  it("treats a year-only current author as weak and proposes the provider's", () => {
    const p = buildProposal(book({ title: "x", authors: ["2007"] }), [hit({ authors: ["Paul Graham"] })]);
    expect(p.fields.find((f) => f.field === "authors")).toMatchObject({ proposed: ["Paul Graham"], reason: "weak" });
  });

  it("treats a glued current author string as weak and proposes the provider's", () => {
    const p = buildProposal(book({ title: "x", authors: ["Ian Miell, Aidan Hobson Sayers"] }), [
      hit({ authors: ["Ian Miell", "Aidan Hobson Sayers"] }),
    ]);
    expect(p.changes.authors).toEqual(["Ian Miell", "Aidan Hobson Sayers"]);
  });

  it("still never replaces a good current author", () => {
    const p = buildProposal(book({ title: "x", authors: ["Paul Graham"] }), [hit({ authors: ["Someone Else"] })]);
    expect(p.changes).not.toHaveProperty("authors");
  });

  it("drops a provider publisher that is really the authors string", () => {
    const p = buildProposal(book({ title: "x" }), [
      hit({ authors: ["Matt Stephens", "Doug Rosenberg"], publisher: "Matt Stephens, Doug Rosenberg" }),
    ]);
    expect(p.changes).not.toHaveProperty("publisher");
  });

  it("drops a provider publisher that names the book's current author", () => {
    const p = buildProposal(book({ title: "x", authors: ["Paul Graham"] }), [hit({ publisher: "Graham, Paul" })]);
    expect(p.changes).not.toHaveProperty("publisher");
  });

  it("keeps a real publisher even when it shares a word with an author", () => {
    const p = buildProposal(book({ title: "x" }), [hit({ authors: ["Tim O'Reilly"], publisher: "O'Reilly Media" })]);
    expect(p.changes.publisher).toBe("O'Reilly Media");
  });

  it("emits the proposed isbn identifier as ISBN-13", () => {
    const p = buildProposal(book({ title: "x" }), [hit({ isbn: "0596006624" })]);
    expect(p.changes.identifiers).toEqual({ isbn: "9780596006624" });
  });
});

// #198: an ISBN that belongs to another book (e.g. scraped from an ad page) yields a hit whose
// title has nothing to do with the book's real title — the proposal must not look trustworthy.
describe("buildProposal — title cross-check (#198)", () => {
  const PYTEST = book({ title: "Python Testing with pytest", authors: ["Unknown"] });
  const WENGROW = hit({
    title: "A Common-Sense Guide to Data Structures and Algorithms",
    authors: ["Jay Wengrow"],
    confidence: 0.95,
  });

  it("lowers the confidence below 0.5 when the provider title does not match the book's title", () => {
    expect(buildProposal(PYTEST, [WENGROW]).confidence).toBeLessThan(0.5);
  });

  it("applies the lowered confidence to every proposed field", () => {
    const p = buildProposal(PYTEST, [WENGROW]);
    expect(p.fields.map((f) => f.confidence)).toEqual([p.confidence]);
  });

  it("warns about the mismatch, naming both titles", () => {
    const [warning] = buildProposal(PYTEST, [WENGROW]).warnings ?? [];
    expect(warning).toContain("Python Testing with pytest");
    expect(warning).toContain("A Common-Sense Guide to Data Structures and Algorithms");
  });

  it("keeps the provider confidence when the provider title only adds a subtitle", () => {
    const p = buildProposal(PYTEST, [
      hit({ title: "Python Testing with pytest: Simple, Rapid, Effective, and Scalable", confidence: 0.95 }),
    ]);
    expect(p).toMatchObject({ confidence: 0.95, warnings: [] });
  });

  it("ignores case, punctuation and a leading article when comparing titles", () => {
    const p = buildProposal(book({ title: "The Pragmatic Programmer" }), [
      hit({ title: "pragmatic programmer, the", confidence: 0.95 }),
    ]);
    expect(p).toMatchObject({ confidence: 0.95, warnings: [] });
  });

  it("skips the cross-check when the current title is a raw filename (nothing to compare)", () => {
    const p = buildProposal(book({ title: "215479-01" }), [hit({ title: "Head First Design Patterns" })]);
    expect(p).toMatchObject({ confidence: 0.95, warnings: [] });
  });

  it("skips the cross-check when the current title is empty", () => {
    const p = buildProposal(book({ title: "" }), [hit({ title: "Head First Design Patterns" })]);
    expect(p).toMatchObject({ confidence: 0.95, warnings: [] });
  });

  it("skips the cross-check when the hit carries no title", () => {
    const p = buildProposal(PYTEST, [hit({ authors: ["Brian Okken"] })]);
    expect(p).toMatchObject({ confidence: 0.95, warnings: [] });
  });
});

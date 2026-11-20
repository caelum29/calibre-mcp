// Description hits in the blind judged pass (#631): a hit won by a book's metadata row has no
// passage offsets, so the raw run keys it as the point -1 of its book. It is judged, stored and
// reused like any other hit (one per query and book), never confused with a text passage.

import { describe, expect, it } from "vitest";
import { toRawRun, type JudgedQuery, type RawRecord } from "../../../scripts/judged-lib.js";
import { pooledHits, sha256 } from "../../../scripts/judged-store.js";

const query: JudgedQuery = {
  id: "ki-01",
  category: "known",
  library: "Programming_Books",
  scope: "library",
  bookId: null,
  target: "text",
  query: "professional javascript",
  mustCover: "The book Professional JavaScript for Web Developers.",
  expectedBooks: [{ id: 247, title: "Professional JavaScript for Web Developers" }],
};

const structured = {
  indexVersion: 5,
  results: [
    { bookId: 247, title: "Professional JavaScript", snippetSource: "description", snippet: "blurb" },
    { bookId: 128, title: "JS (ru)", charStart: 10, charEnd: 90, snippet: "body" },
  ],
};

describe("toRawRun: description hits (#631)", () => {
  it("keys a description hit as the point -1 of its book and marks its source", () => {
    const run = toRawRun(structured, false, "", query);
    expect(run.hits[0]).toEqual({
      bookId: 247,
      title: "Professional JavaScript",
      at: -1,
      charEnd: -1,
      from: "description",
      text: "blurb",
    });
  });

  it("leaves a text hit unmarked", () => {
    const run = toRawRun(structured, false, "", query);
    expect("from" in run.hits[1]!).toBe(false);
  });
});

describe("pooledHits: description hits (#631)", () => {
  it("gives a description hit a storable location at the point -1", () => {
    const rec: RawRecord = { query, runs: { hybrid: toRawRun(structured, false, "", query) } };
    const p = pooledHits(rec).find((x) => x.text === "blurb")!;
    expect(p.location).toEqual({
      qid: "ki-01",
      bookId: 247,
      charStart: -1,
      charEnd: -1,
      indexVersion: 5,
      textSha256: sha256("blurb"),
    });
  });

  it("still gives no location to a text hit without an offset", () => {
    const rec: RawRecord = {
      query,
      runs: { hybrid: { isError: false, indexVersion: 5, hits: [{ bookId: 3, title: "t", at: -1, text: "x" }] } },
    };
    expect(pooledHits(rec)[0]!.location).toBeUndefined();
  });
});

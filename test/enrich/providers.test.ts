import { describe, expect, it } from "vitest";
import type { FetchJson } from "../../src/enrich/http.js";
import { createGoogleBooks } from "../../src/enrich/googlebooks.js";
import { createOpenLibrary } from "../../src/enrich/openlibrary.js";

/** A fake fetchJson that dispatches on the URL and returns canned provider JSON. */
function fakeFetch(routes: (url: string) => unknown): FetchJson {
  return (async (url: string) => routes(url)) as FetchJson;
}

describe("createOpenLibrary", () => {
  it("maps an ISBN lookup into a normalized hit", async () => {
    const fj = fakeFetch(() => ({
      "ISBN:9780306406157": {
        title: "Error-correction coding",
        authors: [{ name: "George C. Clark" }],
        publishers: [{ name: "Plenum Press" }],
        publish_date: "1981",
        identifiers: { isbn_10: ["0306406152"], isbn_13: ["9780306406157"] },
      },
    }));
    const [hit] = await createOpenLibrary(fj).lookupByIsbn("9780306406157");
    expect(hit).toMatchObject({
      source: "openlibrary",
      title: "Error-correction coding",
      authors: ["George C. Clark"],
      publisher: "Plenum Press",
      pubdate: "1981",
      isbn: "9780306406157", // isbn_13 preferred
      confidence: 0.95,
    });
  });

  it("maps a title search into lower-confidence hits", async () => {
    const fj = fakeFetch(() => ({
      docs: [{ title: "The Rust Programming Language", author_name: ["Steve Klabnik"], first_publish_year: 2018 }],
    }));
    const hits = await createOpenLibrary(fj).searchByTitleAuthor("rust programming");
    expect(hits[0]).toMatchObject({ title: "The Rust Programming Language", pubdate: "2018", confidence: 0.6 });
  });

  it("returns [] on a network failure (degrades to the next provider)", async () => {
    const fj = fakeFetch(() => { throw new Error("HTTP 500"); });
    expect(await createOpenLibrary(fj).lookupByIsbn("9780306406157")).toEqual([]);
  });
});

describe("createGoogleBooks", () => {
  it("maps an ISBN lookup, joining subtitle and preferring ISBN-13", async () => {
    const fj = fakeFetch(() => ({
      items: [{
        volumeInfo: {
          title: "Programming Rust",
          subtitle: "Fast, Safe Systems Development",
          authors: ["Jim Blandy"],
          publisher: "O'Reilly",
          publishedDate: "2021",
          industryIdentifiers: [
            { type: "ISBN_10", identifier: "1492052590" },
            { type: "ISBN_13", identifier: "9781492052593" },
          ],
        },
      }],
    }));
    const [hit] = await createGoogleBooks(fj).lookupByIsbn("9781492052593");
    expect(hit).toMatchObject({
      source: "googlebooks",
      title: "Programming Rust: Fast, Safe Systems Development",
      publisher: "O'Reilly",
      isbn: "9781492052593",
      confidence: 0.95,
    });
  });

  it("returns [] when there are no items", async () => {
    const fj = fakeFetch(() => ({ totalItems: 0 }));
    expect(await createGoogleBooks(fj).searchByTitleAuthor("nonexistent")).toEqual([]);
  });
});

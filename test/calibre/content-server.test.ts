import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";

// getJson is the system boundary (fetch); stub it so we test the JSON→domain mapping
// against captured /ajax fixtures (testing rule: mock only at boundaries).
vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";

const libInfo = {
  library_map: { Programming_Books: "Programming Books", lib_42: "My Books" },
  default_library: "Programming_Books",
};
const search = {
  total_num: 84,
  offset: 0,
  num: 3,
  sort: "title",
  book_ids: [658, 814, 704],
  library_id: "Programming_Books",
};
const book658 = {
  application_id: 658,
  uuid: "u-658",
  title: "Rust in Action",
  authors: ["Tim McNamara"],
  identifiers: { isbn: "9780473679750" },
  formats: ["PDF"],
  languages: ["eng"],
  comments: "<p>desc</p>",
  series_index: 2,
};

const mocked = vi.mocked(getJson);

function client(): ContentServerClient {
  return new ContentServerClient(loadConfig({}));
}

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(((url: string) => {
    if (url.includes("/ajax/library-info")) return Promise.resolve(libInfo);
    if (url.includes("/ajax/search/")) return Promise.resolve(search);
    if (url.includes("/ajax/books/")) return Promise.resolve({ "658": book658 });
    if (url.includes("/ajax/book/")) return Promise.resolve(book658);
    return Promise.reject(new Error("unexpected url " + url));
  }) as typeof getJson);
});

describe("ContentServerClient", () => {
  it("maps /ajax/library-info to LibraryInfo", async () => {
    const info = await client().libraryInfo();
    expect(info.defaultLibrary).toBe("Programming_Books");
    expect(info.libraryMap.lib_42).toBe("My Books");
  });

  it("resolveLibraryId prefers the server map over the underscore fallback", async () => {
    // "My Books" → "lib_42" via the map; the naive fallback would give "My_Books".
    expect(await client().resolveLibraryId("My Books")).toBe("lib_42");
  });

  it("maps /ajax/search to a SearchPage", async () => {
    const page = await client().search({ query: "rust", num: 3 });
    expect(page.total).toBe(84);
    expect(page.bookIds).toEqual([658, 814, 704]);
    expect(page.libraryId).toBe("Programming_Books");
  });

  it("maps /ajax/book to a Book (lowercased formats, identifiers, cover url)", async () => {
    const b = await client().getBook(658);
    expect(b.formats).toEqual(["pdf"]);
    expect(b.identifiers.isbn).toBe("9780473679750");
    expect(b.seriesIndex).toBe(2);
    expect(b.coverUrl).toContain("/get/cover/658/");
  });
});

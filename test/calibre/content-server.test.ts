import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";

// getJson is the system boundary (fetch); stub it so we test the JSON→domain mapping
// against captured /ajax fixtures (testing rule: mock only at boundaries).
vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getBytes, getJson } from "../../src/calibre/http.js";
import { ContentServerClient, matchCategory } from "../../src/calibre/content-server.js";
import type { Category } from "../../src/domain/library.js";

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

const categories = [
  { name: "Authors", url: "/ajax/category/617574686f7273/Programming_Books", is_category: true },
  { name: "Languages", url: "/ajax/category/6c616e677561676573/Programming_Books", is_category: true },
];
const languageItems = {
  category_name: "Languages",
  total_num: 3,
  offset: 0,
  num: 3,
  items: [
    { name: "English", average_rating: 3.6875, count: 658, url: "/ajax/books_in/x/31/Programming_Books" },
    { name: "Russian", average_rating: 3.0, count: 126, url: "/ajax/books_in/x/32/Programming_Books" },
  ],
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
    if (url.includes("/ajax/categories/")) return Promise.resolve(categories);
    if (url.includes("/ajax/category/")) return Promise.resolve(languageItems);
    return Promise.reject(new Error("unexpected url " + url));
  }) as typeof getJson);
});

describe("ContentServerClient busy breaker (#343)", () => {
  it("should_free_the_probe_slot_when_the_probe_fails_without_a_timeout", async () => {
    let t = 1_000_000;
    const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, now: () => t });
    busy.markBusy("Programming_Books", "content-server");
    t += 60_000;
    const cs = new ContentServerClient(loadConfig({}), busy);
    mocked.mockImplementation(((url: string) =>
      url.includes("/ajax/library-info")
        ? Promise.resolve(libInfo)
        : Promise.reject(new Error("boom"))) as typeof getJson);
    // two sequential probes both reach getJson: a plain failure must not leave the slot taken
    await expect(cs.getBook(658, "Programming_Books")).rejects.toThrow("boom");
    await expect(cs.getBook(658, "Programming_Books")).rejects.toThrow("boom");
  });
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

  it("resolveLibraryId auto-detects the server default when nothing is configured", async () => {
    // loadConfig({}) leaves defaultLibrary empty → the server's default_library wins.
    expect(await client().resolveLibraryId()).toBe("Programming_Books");
  });

  it("resolveLibraryId falls back to the first library when the server has no default", async () => {
    mocked.mockResolvedValueOnce({ library_map: { only_lib: "Only Lib" } });
    expect(await client().resolveLibraryId()).toBe("only_lib");
  });

  it("resolveLibraryId throws an actionable error when the server reports no libraries", async () => {
    mocked.mockResolvedValueOnce({ library_map: {} });
    await expect(client().resolveLibraryId()).rejects.toThrow(/no libraries/i);
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

  it("maps a category's values to a CategoryItemsPage", async () => {
    const page = await client().categoryItemsByUrl(categories[1]!.url);
    expect(page.total).toBe(3);
    expect(page.items[0]).toEqual({ name: "English", count: 658, averageRating: 3.6875 });
  });
});

describe("matchCategory", () => {
  const nodes: Category[] = [
    { name: "Authors", url: "/a" },
    { name: "Languages", url: "/l" },
  ];
  it("matches case-insensitively", () => {
    expect(matchCategory(nodes, "authors")?.name).toBe("Authors");
  });
  it("resolves a singular synonym", () => {
    expect(matchCategory(nodes, "language")?.name).toBe("Languages");
  });
  it("returns undefined for an unknown field", () => {
    expect(matchCategory(nodes, "nope")).toBeUndefined();
  });

  it("coverThumb base64-encodes the thumbnail through getBytes with a 10 s timeout", async () => {
    vi.mocked(getBytes).mockResolvedValueOnce({ data: Buffer.from("abc"), contentType: "image/png" });
    const thumb = await client().coverThumb(658, undefined, "10x20");
    expect(thumb).toEqual({ data: "YWJj", mimeType: "image/png" });
    expect(vi.mocked(getBytes)).toHaveBeenCalledWith(
      expect.stringContaining("/get/thumb/658/Programming_Books?sz=10x20"),
      {
        timeoutMs: 10_000,
      },
    );
  });

  it("coverThumb defaults the mime type to image/jpeg and degrades to null on any failure", async () => {
    vi.mocked(getBytes).mockResolvedValueOnce({ data: Buffer.from("abc"), contentType: null });
    expect((await client().coverThumb(658))?.mimeType).toBe("image/jpeg");
    vi.mocked(getBytes).mockRejectedValueOnce(new Error("timed out"));
    expect(await client().coverThumb(658)).toBeNull();
  });

  it("bookMergeFacts reads custom columns and cover presence from the same /ajax/book payload", async () => {
    const withCustom = {
      ...book658,
      cover: "/get/cover/658",
      user_metadata: { "#read": { datatype: "bool", "#value#": true }, plain: {} },
    };
    mocked.mockImplementation(((url: string) =>
      Promise.resolve(url.includes("/ajax/library-info") ? libInfo : withCustom)) as typeof getJson);
    const facts = await client().bookMergeFacts(658);
    expect(facts).toEqual({
      customFields: [{ label: "#read", datatype: "bool", isMultiple: false, value: true, extra: undefined }],
      hasCover: true,
    });
  });
});

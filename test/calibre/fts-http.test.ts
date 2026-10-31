// ContentServerClient's two-phase FTS endpoints + the busy breaker on its library-scoped GETs.
// Fixtures are verbatim /fts/* replies from Calibre 9.17 (Programming_Books, 2026-10-31).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";

vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getJson } from "../../src/calibre/http.js";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { CalibreBusyError, CalibreHttpError, CalibreHttpTimeoutError, FtsError } from "../../src/domain/errors.js";

const LIB = asLibId("Programming_Books");

// GET /fts/search?query=monomorphization&library_id=Programming_Books (first 3 rows kept)
const FTS_SEARCH = {
  metadata: {
    "293": { title: "Effective Rust: 35 Specific Ways to Improve Your Rust Code", authors: "David Drysdale" },
    "285": {
      title: "Rust Fundamentals for Data Science: An Introductory Guide For Data Science",
      authors: "Strauss, Johann & Van Der Post, Hayden",
    },
    "1232": { title: "Category Theory for Programmers", authors: "Bartosz Milewski" },
  },
  indexing_status: { left: 0, total: 1136 },
  results: [
    { book_id: 293, format: "PDF" },
    { book_id: 285, format: "EPUB" },
    { book_id: 293, format: "EPUB" }, // added: a second format row for the same book
    { book_id: 1232, format: "PDF" },
  ],
};

// GET /fts/snippets/293?query=monomorphization&…&highlight_start=>>&highlight_end=<< (text trimmed)
const FTS_SNIPPETS = {
  snippets: {
    "293": [
      {
        formats: ["PDF"],
        text: "…then different monomorphized >>code<< is used:\nlet circle = Circle {…",
      },
    ],
  },
};

const client = (busy?: LibraryBusyTracker) =>
  new ContentServerClient(loadConfig({ CALIBRE_MCP_SERVER_URL: "http://localhost:8080" }), busy);

beforeEach(() => vi.mocked(getJson).mockReset());

describe("ContentServerClient.ftsSearch", () => {
  it("maps ranked rows to unique book ids, titles and split authors", async () => {
    vi.mocked(getJson).mockResolvedValueOnce(FTS_SEARCH);
    const m = await client().ftsSearch("monomorphization", LIB, { timeoutMs: 1000 });
    expect(m.bookIds).toEqual([293, 285, 1232]);
    expect(m.books.get(285)).toEqual({
      title: "Rust Fundamentals for Data Science: An Introductory Guide For Data Science",
      authors: ["Strauss, Johann", "Van Der Post, Hayden"],
    });
    expect(m.indexing).toEqual({ left: 0, total: 1136 });
    const url = new URL(vi.mocked(getJson).mock.calls[0]![0]);
    expect(url.pathname).toBe("/fts/search");
    expect(url.searchParams.get("library_id")).toBe("Programming_Books");
    expect(vi.mocked(getJson).mock.calls[0]![1]).toMatchObject({ timeoutMs: 1000 });
  });

  it("maps 428 (FTS off) and 422 (bad query) to typed FtsErrors", async () => {
    vi.mocked(getJson).mockRejectedValueOnce(new CalibreHttpError(428, "u", "Content Server returned HTTP 428"));
    await expect(client().ftsSearch("x", LIB)).rejects.toMatchObject({ code: "FTS_DISABLED" });
    vi.mocked(getJson).mockRejectedValueOnce(new CalibreHttpError(422, "u", "Content Server returned HTTP 422"));
    await expect(client().ftsSearch("a:b-", LIB)).rejects.toBeInstanceOf(FtsError);
  });
});

describe("ContentServerClient.ftsSnippets", () => {
  it("asks for the given books with our markers and returns their texts", async () => {
    vi.mocked(getJson).mockResolvedValueOnce(FTS_SNIPPETS);
    const s = await client().ftsSnippets("monomorphization", LIB, [293], { start: ">>", end: "<<", size: 64 });
    expect(s.get(293)).toEqual([FTS_SNIPPETS.snippets["293"][0]!.text]);
    const url = new URL(vi.mocked(getJson).mock.calls[0]![0]);
    expect(url.pathname).toBe("/fts/snippets/293");
    expect(url.searchParams.get("highlight_start")).toBe(">>");
    expect(url.searchParams.get("snippet_size")).toBe("64");
  });
});

describe("busy breaker on library-scoped GETs", () => {
  it("a timeout flags the library; the next call fails fast without an HTTP request", async () => {
    const busy = new LibraryBusyTracker();
    const c = client(busy);
    vi.mocked(getJson).mockRejectedValueOnce(new CalibreHttpTimeoutError("http://x/fts/search"));
    await expect(c.ftsSearch("dependency injection", LIB)).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    vi.mocked(getJson).mockResolvedValueOnce({ library_map: { Programming_Books: "Programming Books" } });
    await expect(c.search({ query: "rust", library: "Programming_Books" })).rejects.toBeInstanceOf(CalibreBusyError);
    // library-info (to resolve the id) went out; the search itself never did
    expect(vi.mocked(getJson).mock.calls.map((c) => new URL(c[0]).pathname)).not.toContain(
      "/ajax/search/Programming_Books",
    );
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ libraryId: "Programming_Books" })]);
  });

  it("a non-timeout failure (428) does not flag the library", async () => {
    const busy = new LibraryBusyTracker();
    vi.mocked(getJson).mockRejectedValueOnce(new CalibreHttpError(428, "u", "Content Server returned HTTP 428"));
    await expect(client(busy).ftsSearch("x", LIB)).rejects.toBeInstanceOf(FtsError);
    expect(busy.busyLibraries()).toEqual([]);
  });
});

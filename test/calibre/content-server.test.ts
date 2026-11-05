import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";

// getJson is the system boundary (fetch); stub it so we test the JSON→domain mapping
// against captured /ajax fixtures (testing rule: mock only at boundaries).
vi.mock("../../src/calibre/http.js", () => ({ getJson: vi.fn(), getBytes: vi.fn() }));
import { getBytes, getJson } from "../../src/calibre/http.js";
import { ContentServerClient, matchCategory } from "../../src/calibre/content-server.js";
import type { Category } from "../../src/domain/library.js";
import { CalibreBusyError, CalibreHttpTimeoutError } from "../../src/domain/errors.js";

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

afterEach(() => {
  vi.useRealTimers();
});

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
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock moves; nothing else in this test is timer-driven
    vi.setSystemTime(1_000_000);
    const busy = new LibraryBusyTracker({ baseWindowMs: 60_000 });
    busy.markBusy("Programming_Books", "content-server");
    vi.advanceTimersByTime(60_000);
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

// #389: calls in flight at the same time share one breaker entry (current behaviour pinned).
describe("ContentServerClient busy breaker with overlapping calls (#389)", () => {
  interface Parked {
    ok(): void;
    timeout(): void;
    fail(): void;
  }

  /** library-info answers at once; every /ajax/books/ GET parks until the test settles it. */
  function parkedBookFetches() {
    const handles: Parked[] = [];
    let waiters: { n: number; resolve: () => void }[] = [];
    mocked.mockImplementation(((url: string) => {
      if (url.includes("/ajax/library-info")) return Promise.resolve(libInfo);
      return new Promise<unknown>((resolve, reject) => {
        handles.push({
          ok: () => resolve({ "658": book658 }),
          timeout: () => reject(new CalibreHttpTimeoutError(url)),
          fail: () => reject(new Error("boom")),
        });
        for (const w of waiters) if (handles.length >= w.n) w.resolve();
        waiters = waiters.filter((w) => handles.length < w.n);
      });
    }) as typeof getJson);
    // resolves once the n-th fetch has parked; getBook awaits library resolution before getJson
    const reached = (n: number) =>
      handles.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve }));
    return { handles, reached };
  }

  async function setup() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, maxWindowMs: 300_000 });
    const cs = new ContentServerClient(loadConfig({}), busy);
    await cs.libraryInfo(); // warm the libId map so getBook goes straight to the parked fetch
    return { busy, get: () => cs.getBook(658, "Programming_Books"), ...parkedBookFetches() };
  }

  /** Two calls start closed; the second times out (strike 1, 60 s); the first stays in flight as the stale call. */
  async function staleAndTrigger(ctx: Awaited<ReturnType<typeof setup>>) {
    const stale = ctx.get();
    const trigger = ctx.get();
    await ctx.reached(2);
    ctx.handles[1]!.timeout();
    await expect(trigger).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    return { stale };
  }

  it("should_close_the_breaker_when_a_call_started_before_the_timeout_succeeds_after_it", async () => {
    const { busy, get, handles, reached } = await setup();
    const timedOut = get();
    const answered = get();
    await reached(2);
    handles[0]!.timeout();
    await expect(timedOut).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    expect(busy.busyLibraries()).toEqual([
      expect.objectContaining({ libraryId: "Programming_Books", source: "content-server", retryInMs: 60_000 }),
    ]);
    handles[1]!.ok();
    await answered;
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("should_escalate_to_strike_two_when_a_second_overlapping_call_times_out_inside_the_open_window", async () => {
    const { busy, get, handles, reached } = await setup();
    const first = get();
    const second = get();
    await reached(2);
    handles[0]!.timeout();
    await expect(first).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    vi.advanceTimersByTime(10_000);
    handles[1]!.timeout();
    await expect(second).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ retryInMs: 120_000 })]);
  });

  it("should_reopen_with_a_doubled_window_when_a_pre_timeout_call_times_out_during_the_probe", async () => {
    const ctx = await setup();
    const { busy, get, handles, reached } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const probe = get();
    await reached(3);
    handles[0]!.timeout(); // stale call times out while the probe is in flight
    await expect(stale).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ retryInMs: 120_000 })]);
    await expect(get()).rejects.toBeInstanceOf(CalibreBusyError);
    expect(handles).toHaveLength(3); // the refused call never reached getJson
    handles[2]!.ok();
    await probe;
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("should_admit_a_fresh_probe_after_the_doubled_window_and_keep_the_displaced_probe_from_freeing_it", async () => {
    const ctx = await setup();
    const { get, handles, reached } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const displaced = get(); // probe 1
    await reached(3);
    handles[0]!.timeout(); // stale timeout wipes probe 1's slot: 120 s window
    await expect(stale).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    vi.advanceTimersByTime(120_000);
    const fresh = get(); // window over: probe 2 goes out while probe 1 never settled
    await reached(4);
    await expect(get()).rejects.toThrow("Another call is checking");
    handles[2]!.fail(); // probe 1 dies with a plain error: its old claim must not free probe 2's slot
    await expect(displaced).rejects.toThrow("boom");
    await expect(get()).rejects.toBeInstanceOf(CalibreBusyError);
    expect(handles).toHaveLength(4);
    handles[3]!.ok();
    await fresh;
  });

  it("should_not_refuse_the_next_call_when_a_stale_success_lands_while_the_probe_is_in_flight", async () => {
    const ctx = await setup();
    const { busy, get, handles, reached } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const probe = get();
    await reached(3);
    handles[0]!.ok(); // stale call answers: markOk drops the entry, probe claim and all
    await stale;
    expect(busy.busyLibraries()).toEqual([]);
    const next = get(); // closed again: no probe slot to be refused on
    await reached(4);
    handles[2]!.timeout(); // the displaced probe then times out: a fresh strike 1, not strike 2
    await expect(probe).rejects.toBeInstanceOf(CalibreHttpTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ retryInMs: 60_000 })]);
    handles[3]!.ok();
    await next;
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

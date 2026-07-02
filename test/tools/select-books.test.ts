import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { selectBooks } from "../../src/tools/select-books.js";
import type { ToolDeps } from "../../src/tools/types.js";

function book(id: number): Book {
  return {
    id,
    uuid: `u${id}`,
    title: `T${id}`,
    authors: [],
    identifiers: {},
    formats: [],
    tags: [],
    languages: [],
  };
}

interface Recorder {
  batchSizes: number[];
  maxConcurrent: number;
}

/**
 * Fake content client over `count` books. search returns all ids; booksByIds
 * defers a tick so concurrent in-flight batches actually overlap, and records
 * batch order + peak concurrency for assertions.
 */
function deps(count: number, rec: Recorder): ToolDeps {
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  let inFlight = 0;
  const content = {
    resolveLibraryId: async () => "Lib",
    search: async () => ({
      bookIds: ids,
      total: count,
      num: count,
      offset: 0,
      sort: "title",
      libraryId: "Lib",
    }),
    booksByIds: async (batch: number[]) => {
      inFlight++;
      rec.maxConcurrent = Math.max(rec.maxConcurrent, inFlight);
      rec.batchSizes.push(batch.length);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Map(batch.map((id) => [id, book(id)] as const));
    },
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    embedder: {} as unknown as ToolDeps["embedder"],
    index: {} as unknown as ToolDeps["index"],
    log,
  };
}

describe("selectBooks batching", () => {
  it("splits a large sweep into 200-id batches and returns every book in order", async () => {
    const rec: Recorder = { batchSizes: [], maxConcurrent: 0 };
    const sel = await selectBooks(deps(801, rec), { query: "" });
    expect(sel.books.map((b) => b.id)).toEqual(
      Array.from({ length: 801 }, (_, i) => i + 1),
    );
    expect(rec.batchSizes).toEqual([200, 200, 200, 200, 1]);
    expect(sel.total).toBe(801);
    expect(sel.capped).toBe(false);
  });

  it("runs batches concurrently but caps in-flight requests at 4", async () => {
    const rec: Recorder = { batchSizes: [], maxConcurrent: 0 };
    // 6 batches (1001 ids) → concurrency should peak at the cap, not all 6 at once.
    await selectBooks(deps(1001, rec), { query: "" });
    expect(rec.batchSizes.length).toBe(6);
    expect(rec.maxConcurrent).toBe(4);
  });

  it("does not over-parallelize when there are fewer batches than the cap", async () => {
    const rec: Recorder = { batchSizes: [], maxConcurrent: 0 };
    await selectBooks(deps(250, rec), { query: "" }); // 2 batches
    expect(rec.maxConcurrent).toBe(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { GetTextArgs } from "../../src/calibre/extract.js";
import type { ProviderHit } from "../../src/domain/enrich/types.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import type { ToolDeps } from "../../src/tools/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

function hit(over: Partial<ProviderHit> = {}): ProviderHit {
  return { source: "openlibrary", confidence: 0.95, ...over };
}

interface Fixture {
  book: Book;
  text?: string;
  hits?: ProviderHit[];
  /** Override getText — lets a test hang forever or spy on the passed args. */
  getText?: (args: GetTextArgs) => Promise<{ text: string; backend: string; chars: number; cached: boolean }>;
}

function deps(f: Fixture): ToolDeps {
  const content = {
    resolveLibraryId: async () => "Lib",
    getBook: async () => f.book,
    search: async () => ({ bookIds: [] as number[], total: 0, num: 0, offset: 0, sort: "title", libraryId: "Lib" }),
  };
  const extractor = {
    getText:
      f.getText ??
      (async () => ({ text: f.text ?? "", backend: "test", chars: (f.text ?? "").length, cached: false })),
  };
  const provider = (name: "openlibrary" | "googlebooks") => ({
    name,
    lookupByIsbn: async () => f.hits ?? [],
    searchByTitleAuthor: async () => f.hits ?? [],
  });
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as unknown as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    embedder: {} as unknown as ToolDeps["embedder"],
    index: {} as unknown as ToolDeps["index"],
    providers: { openlibrary: provider("openlibrary"), googlebooks: provider("googlebooks") },
    log,
  };
}

const args = (over: Record<string, unknown> = {}) => ({ id: 1, ...over });

describe("calibre_recover_metadata handler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("proposes changes from an existing ISBN and emits a resource_link", async () => {
    const fixture = { book: book({ title: "795731065", authors: ["Unknown"], identifiers: { isbn: "9780306406157" } }),
      hits: [hit({ title: "Real Title", authors: ["A. Author"], publisher: "Plenum" })] };
    const r = await recoverMetadataTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ bookId: 1, source: "openlibrary", lookupKey: "isbn:9780306406157" });
    const changes = r.structuredContent?.changes as Record<string, unknown>;
    expect(changes).toMatchObject({ title: "Real Title", authors: ["A. Author"], publisher: "Plenum" });
    expect(r.content.some((b) => b.type === "resource_link")).toBe(true);
  });

  it("scrapes an ISBN from the book text when metadata has none", async () => {
    const fixture = { book: book({ title: "B0CZS7H23N", formats: ["pdf"] }),
      text: "front matter\nISBN: 978-0-306-40615-7\n", hits: [hit({ title: "Found By Text" })] };
    const r = await recoverMetadataTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.lookupKey).toBe("isbn:9780306406157");
  });

  it("errors when there is no ISBN and the title is a raw filename", async () => {
    const r = await recoverMetadataTool.handler(args(), deps({ book: book({ title: "795731065", formats: [] }) }));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Nothing to look up");
  });

  it("falls back to a title/author search for a usable title", async () => {
    const fixture = { book: book({ title: "The Rust Programming Language", authors: ["Steve Klabnik"] }),
      hits: [hit({ source: "googlebooks", confidence: 0.6, publisher: "No Starch" })] };
    const r = await recoverMetadataTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.lookupKey).toContain("title:The Rust Programming Language / Steve Klabnik");
    expect(r.structuredContent?.changes).toMatchObject({ publisher: "No Starch" });
  });

  it("errors when no provider returns a hit", async () => {
    const r = await recoverMetadataTool.handler(args(), deps({ book: book({ title: "x", identifiers: { isbn: "9780306406157" } }), hits: [] }));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("No metadata found");
  });

  it("reports a complete book when the hit fills nothing new", async () => {
    const fixture = { book: book({ title: "Good", authors: ["Jane Doe"], identifiers: { isbn: "9780306406157" }, publisher: "P", pubdate: "2020" }),
      hits: [hit({ title: "Good", authors: ["Jane Doe"], publisher: "P" })] };
    const r = await recoverMetadataTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ fieldCount: 0 });
    expect((r.content[0] as { text: string }).text).toContain("already complete");
  });

  it("bounds a hanging text scan and degrades gracefully instead of blocking", async () => {
    vi.useFakeTimers();
    // getText never resolves — the scan budget race must win. Title is a raw filename, so with
    // no ISBN the "Nothing to look up" error fires (and mentions the timeout).
    const fixture = {
      book: book({ title: "795731065", formats: ["pdf"] }),
      getText: () => new Promise<never>(() => {}), // hangs forever
    };
    const promise = recoverMetadataTool.handler(args(), deps(fixture));
    await vi.advanceTimersByTimeAsync(30_000); // trip the ISBN_SCAN_TIMEOUT_MS budget
    const r = await promise;
    expect(r.isError).toBe(true);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("Nothing to look up");
    expect(text).toContain("timed out");
  });

  it("threads the scan-budget timeout into getText and uses a scan result within budget", async () => {
    const seen: number[] = [];
    const fixture = {
      book: book({ title: "B0CZS7H23N", formats: ["pdf"] }),
      getText: async (a: GetTextArgs) => {
        seen.push(a.timeoutMs ?? -1);
        return { text: "ISBN: 978-0-306-40615-7\n", backend: "test", chars: 24, cached: false };
      },
      hits: [hit({ title: "Found By Text" })],
    };
    const r = await recoverMetadataTool.handler(args(), deps(fixture));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.lookupKey).toBe("isbn:9780306406157");
    expect(seen).toEqual([30_000]); // ISBN_SCAN_TIMEOUT_MS passed through
  });
});

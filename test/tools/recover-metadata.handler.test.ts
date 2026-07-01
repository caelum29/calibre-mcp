import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
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
}

function deps(f: Fixture): ToolDeps {
  const content = {
    resolveLibraryId: async () => "Lib",
    getBook: async () => f.book,
    search: async () => ({ bookIds: [] as number[], total: 0, num: 0, offset: 0, sort: "title", libraryId: "Lib" }),
  };
  const extractor = {
    getText: async () => ({ text: f.text ?? "", backend: "test", chars: (f.text ?? "").length, cached: false }),
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
});

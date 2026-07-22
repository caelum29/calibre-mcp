import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { GetTextArgs } from "../../src/calibre/extract.js";
import { extractIsbnTool } from "../../src/tools/calibre_extract_isbn.js";
import type { ToolDeps } from "../../src/tools/types.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

interface Fixture {
  book: Book;
  text?: string;
  getText?: (args: GetTextArgs) => Promise<{ text: string; backend: string; chars: number; cached: boolean }>;
  calibredb?: (args: string[], opts: { library: string }) => Promise<string>;
}

function deps(f: Fixture): { deps: ToolDeps; calls: { args: string[] }[] } {
  const calls: { args: string[] }[] = [];
  const content = {
    resolveLibraryId: async () => "Lib",
    getBook: async () => f.book,
    search: async () => ({ bookIds: [] as number[], total: 0, num: 0, offset: 0, sort: "title", libraryId: "Lib" }),
  };
  const extractor = {
    getText:
      f.getText ??
      (async () => ({ text: f.text ?? "", backend: "test", chars: (f.text ?? "").length, cached: false, markers: [] })),
  };
  const calibre = {
    calibredb:
      f.calibredb ??
      (async (args: string[]) => {
        calls.push({ args });
        return "";
      }),
  };
  return {
    calls,
    deps: {
      config: loadConfig({}),
      content: content as unknown as ToolDeps["content"],
      calibre: calibre as unknown as ToolDeps["calibre"],
      extractor: extractor as unknown as ToolDeps["extractor"],
      embedder: {} as unknown as ToolDeps["embedder"],
      index: {} as unknown as ToolDeps["index"],
      log,
    },
  };
}

const args = (over: Record<string, unknown> = {}) => ({ id: 1, apply: false, ...over });
const ISBN_TEXT = "front matter\nISBN: 978-0-306-40615-7\n";

describe("calibre_extract_isbn handler", () => {
  it("previews the scanned ISBN without writing", async () => {
    const { deps: d, calls } = deps({ book: book({ title: "B0CZS7H23N", formats: ["pdf"] }), text: ISBN_TEXT });
    const r = await extractIsbnTool.handler(args(), d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ isbn: "9780306406157", applied: false, changed: true });
    expect(calls).toHaveLength(0);
  });

  it("writes the merged identifiers when apply is true", async () => {
    const { deps: d, calls } = deps({
      book: book({ title: "B0CZS7H23N", formats: ["pdf"], identifiers: { asin: "B0CZS7H23N" } }),
      text: ISBN_TEXT,
    });
    const r = await extractIsbnTool.handler(args({ apply: true }), d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ isbn: "9780306406157", applied: true });
    expect(calls).toHaveLength(1);
    // set_metadata merges — the existing asin must be preserved alongside the new isbn.
    const field = calls[0]!.args.join(" ");
    expect(field).toContain("asin:B0CZS7H23N");
    expect(field).toContain("isbn:9780306406157");
  });

  it("finds an ISBN printed in the back matter (tail scan)", async () => {
    // Front 20k chars carry no ISBN; the copyright/back-cover ISBN sits past that boundary.
    const tail = "back cover\nISBN 978-0-306-40615-7\n";
    const { deps: d } = deps({ book: book({ title: "x", formats: ["pdf"] }), text: "a".repeat(20_001) + tail });
    const r = await extractIsbnTool.handler(args(), d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ isbn: "9780306406157" });
  });

  it("finds a labeled ISBN buried in the middle (front + tail slices both miss)", async () => {
    // The ISBN sits past the front 20k window and before the tail 20k window — only the
    // labeled-only middle sweep reaches it.
    const text = "a".repeat(21_000) + "\nISBN 978-0-306-40615-7\n" + "b".repeat(21_000);
    const { deps: d } = deps({ book: book({ title: "x", formats: ["pdf"] }), text });
    const r = await extractIsbnTool.handler(args(), d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ isbn: "9780306406157" });
  });

  it("errors when no ISBN is found in the text", async () => {
    const { deps: d } = deps({ book: book({ title: "x", formats: ["pdf"] }), text: "no isbn here" });
    const r = await extractIsbnTool.handler(args(), d);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("No ISBN extracted");
  });

  it("errors when the book has no extractable format", async () => {
    const { deps: d } = deps({ book: book({ title: "x", formats: [] }) });
    const r = await extractIsbnTool.handler(args(), d);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("no extractable format");
  });

  it("does not write when the found ISBN already matches (apply=true)", async () => {
    const { deps: d, calls } = deps({
      book: book({ title: "x", formats: ["pdf"], identifiers: { isbn: "9780306406157" } }),
      text: ISBN_TEXT,
    });
    const r = await extractIsbnTool.handler(args({ apply: true }), d);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ changed: false, applied: false });
    expect(calls).toHaveLength(0);
  });

  it("degrades to an error (not a hang) when extraction never resolves", async () => {
    vi.useFakeTimers();
    const { deps: d } = deps({
      book: book({ title: "x", formats: ["pdf"] }),
      getText: () => new Promise<never>(() => {}),
    });
    const promise = extractIsbnTool.handler(args(), d);
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await promise;
    vi.useRealTimers();
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("timed out");
  });
});

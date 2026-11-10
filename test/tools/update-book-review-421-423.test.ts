// Review-round pins for #421/#423: bulk_update shares the identifiers validation, update_book
// stays out of recentErrors, one-digit/invalid months, and recover_metadata → update_book.
import { describe, it, expect, vi } from "vitest";
import { formatFieldValue } from "../../src/calibre/metadata-fields.js";
import { SERVER_FAULT_CODES } from "../../src/domain/error-codes.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import type { Book } from "../../src/domain/book.js";
import type { ProviderHit } from "../../src/domain/enrich/types.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 658,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...over,
});

function deps(
  calibredb: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>,
  b: Book = book(),
  hits: ProviderHit[] = [],
): ToolDeps {
  const provider = (name: string) => ({
    name,
    lookupByIsbn: async () => hits,
    searchByTitleAuthor: async () => hits,
  });
  return {
    config: loadConfig({}),
    content: {
      getBook: async () => b,
      resolveLibraryId: async () => "Programming_Books",
      search: async () => ({
        bookIds: [658],
        total: 1,
        num: 1,
        offset: 0,
        sort: "title",
        libraryId: "Programming_Books",
      }),
    },
    calibre: { calibredb },
    extractor: { getText: async () => ({ text: "", backend: "t", chars: 0, cached: false, markers: [] }) },
    providers: { openlibrary: provider("openlibrary"), googlebooks: provider("googlebooks") },
    log,
  } as unknown as ToolDeps;
}

const ok = async (_args: readonly string[]) => ({ stdout: "", stderr: "" });

describe("identifiers wrong shape: handler level", () => {
  it("update_book: invalid_input, not a server fault, calibredb untouched", async () => {
    const spy = vi.fn(ok);
    const r = await updateBookTool.handler({ id: 658, changes: { identifiers: "isbn:9780132350884" } }, deps(spy));
    expect(r.isError).toBe(true);
    const code = r.structuredContent?.errorCode;
    expect(code).toBe("invalid_input");
    expect(SERVER_FAULT_CODES).not.toContain(code);
    expect(spy).not.toHaveBeenCalled();
  });

  for (const preview of [true, false]) {
    it(`bulk_update (preview=${preview}): invalid_input before anything is built or written`, async () => {
      const spy = vi.fn(ok);
      const r = await bulkUpdateTool.handler({ ids: [658], changes: { identifiers: "isbn:1" }, preview }, deps(spy));
      expect(r.isError).toBe(true);
      expect(r.structuredContent?.errorCode).toBe("invalid_input");
      expect((r.content[0] as { text: string }).text).toContain("identifiers must be an object");
      expect(spy).not.toHaveBeenCalled();
    });
  }
});

describe("partial pubdate months", () => {
  it("pads a one-digit month", () => {
    expect(formatFieldValue("pubdate", "2020-5")).toBe("2020-05-01");
  });
  it("leaves out-of-range months untouched", () => {
    expect(formatFieldValue("pubdate", "2020-13")).toBe("2020-13");
    expect(formatFieldValue("pubdate", "2020-00")).toBe("2020-00");
  });
});

describe("recover_metadata proposal → update_book", () => {
  it("a year-only source pubdate is written as the first of January", async () => {
    const spy = vi.fn(ok);
    const d = deps(spy, book({ identifiers: { isbn: "9780306406157" } }), [
      { source: "openlibrary", confidence: 0.95, title: "Real Title", pubdate: "2020" },
    ]);
    const proposed = await recoverMetadataTool.handler({ id: 658 }, d);
    expect(proposed.isError).toBeFalsy();
    const changes = proposed.structuredContent?.changes as Record<string, unknown>;
    expect(changes.pubdate).toBe("2020");
    await updateBookTool.handler({ id: 658, changes: changes as never }, d);
    const argv = spy.mock.calls[0]?.[0];
    expect(argv).toContain("pubdate:2020-01-01");
  });
});

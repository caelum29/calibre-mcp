// Test double for calibre_bulk_update tags_add/tags_remove tests (#321): a selected book set,
// other library books for the tag-spelling lookup, a recorded calibredb spy and search log.
import { vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

/** A Book with defaults; `over` wins. */
export const book = (over: Partial<Book> = {}): Book => ({
  id: 1,
  uuid: "u",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: ["en"],
  ...over,
});

export type Cli = (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

/** What one fake library holds and how its writes/reads behave. */
export interface FakeBulk {
  selected: Book[];
  others?: Book[];
  calibredb?: Cli;
  reread?: (id: number) => Promise<Book>;
  /** Replaces the tag-spelling search (e.g. to make it throw). */
  tagSearch?: (query: string) => Promise<number[]>;
}

/** Fake deps plus the recorded search queries and calibredb spy. */
export function fakeBulkDeps(f: FakeBulk): { deps: ToolDeps; searches: string[]; cli: ReturnType<typeof vi.fn<Cli>> } {
  const all = [...f.selected, ...(f.others ?? [])];
  const byId = new Map(all.map((b) => [b.id, b] as const));
  const searches: string[] = [];
  const cli = vi.fn<Cli>(f.calibredb ?? (async () => ({ stdout: "", stderr: "" })));
  const page = (ids: number[]) => ({
    bookIds: ids,
    total: ids.length,
    num: ids.length,
    offset: 0,
    sort: "title",
    libraryId: "Lib",
  });
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    getBook: f.reread ?? (async (id: number): Promise<Book> => byId.get(id) ?? book({ id })),
    booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
    search: async ({ query }: { query: string }) => {
      searches.push(query);
      if (!query.startsWith("tags:")) return page(f.selected.map((b) => b.id));
      if (f.tagSearch) return page(await f.tagSearch(query));
      const want = /^tags:"=(.*)"$/.exec(query)![1]!.toLowerCase();
      return page(all.filter((b) => b.tags.some((t) => t.toLowerCase() === want)).map((b) => b.id));
    },
  };
  return {
    searches,
    cli,
    deps: {
      config: loadConfig({}),
      content: content as unknown as ToolDeps["content"],
      calibre: { calibredb: cli } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      figures: {} as ToolDeps["figures"],
      embedder: {} as ToolDeps["embedder"],
      index: {} as ToolDeps["index"],
      log,
    },
  };
}

/** All text blocks of a result, joined. */
export const textOf = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

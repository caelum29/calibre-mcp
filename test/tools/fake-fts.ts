// Test double for the FtsPort (calibre/fts.ts): builds both FTS phases from one flat hit list,
// so handler tests describe "book N matched with snippet S" without a Content Server.
import type { FtsPort, SnippetBatch } from "../../src/calibre/fts.js";
import type { FtsIndexing, FtsMatches } from "../../src/domain/search.js";

/** One matched (book, snippet) row; several rows per book become several snippets. */
export interface FakeFtsHit {
  bookId: number;
  snippet?: string;
}

/** Overrides for one fake: canned indexing status, a failing phase, or a partial snippet batch. */
export interface FakeFtsOptions {
  indexing?: FtsIndexing;
  titleOf?: (id: number) => { title: string; authors: string[] };
  match?: FtsPort["match"];
  snippets?: FtsPort["snippets"];
}

/** An FtsPort answering from `hits` in their given (rank) order. */
export function fakeFts(hits: FakeFtsHit[] = [], o: FakeFtsOptions = {}): FtsPort {
  const titleOf = o.titleOf ?? ((id: number) => ({ title: `Book ${id}`, authors: ["A"] }));
  return {
    match:
      o.match ??
      (async (): Promise<FtsMatches> => {
        const bookIds = [...new Set(hits.map((h) => h.bookId))];
        return {
          bookIds,
          books: new Map(bookIds.map((id) => [id, titleOf(id)] as const)),
          indexing: o.indexing ?? { left: 0, total: 100 },
        };
      }),
    snippets:
      o.snippets ??
      (async (_q, _lib, bookIds): Promise<SnippetBatch> => ({
        byBook: new Map(
          bookIds.map((id) => [id, hits.filter((h) => h.bookId === id && h.snippet).map((h) => h.snippet as string)]),
        ),
        skipped: [],
      })),
  };
}

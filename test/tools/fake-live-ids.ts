// Ping fakes for the live-id walk (#496): ping counts only indexed books the library still
// holds, so a search fake must page out the live ids, not just report a total.

import type { SearchPage, SearchParams } from "../../src/domain/search.js";

/** Ids 1..n — the fake library's live books, or the indexed ones. */
export const idsUpTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** Wrap a `{ total }`-only search fake so each page also carries live ids 1..total. */
export function withLiveIds<P, R extends { total: number }>(
  search: (p: P) => Promise<R>,
): (p: P) => Promise<R & { bookIds: number[] }> {
  return async (p) => {
    const r = await search(p);
    const q = p as { num?: number; offset?: number } | undefined;
    const from = q?.offset ?? 0;
    const bookIds = idsUpTo(r.total).slice(from, from + (q?.num ?? r.total));
    return { bookIds, ...r };
  };
}

/**
 * Search fake for calibre_semantic_search's live-hit check (#579): an `id:=a or id:=b` query is
 * answered with the asked ids that are in `live` (default: all of them); any other query goes to
 * `rest`, else gets an empty page.
 */
export function withLiveHitCheck(
  rest?: (p: SearchParams) => Promise<SearchPage>,
  live?: (id: number) => boolean,
): (p: SearchParams) => Promise<SearchPage> {
  return async (p) => {
    const asked = [...p.query.matchAll(/id:=(\d+)/g)].map((m) => Number(m[1]));
    if (asked.length === 0) {
      return rest ? rest(p) : { bookIds: [], total: 0, num: 0, offset: 0, sort: "", libraryId: p.library ?? "" };
    }
    const bookIds = live ? asked.filter(live) : asked;
    return {
      bookIds,
      total: bookIds.length,
      num: bookIds.length,
      offset: 0,
      sort: "title",
      libraryId: p.library ?? "",
    };
  };
}

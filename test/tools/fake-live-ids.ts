// Ping fakes for the live-id walk (#496): ping counts only indexed books the library still
// holds, so a search fake must page out the live ids, not just report a total.

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

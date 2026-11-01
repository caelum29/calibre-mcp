// Post-add duplicate probe for calibre_add_book (#204). calibredb's own duplicate check compares
// the embedded title, so a raw-slug import slips past an existing book. This file only runs the
// library searches; the match decision is domain/curation/add-probe.ts (#341). READ-only and
// advisory: callers treat any failure as "no hint", never as an add failure.

import { foldAccents } from "../domain/curation/normalize.js";
import { isbnKey, matchAddedBook, MAX_PROBED, type PossibleDuplicate } from "../domain/curation/add-probe.js";
import type { BaseDeps } from "./deps.js";

/** Candidate pool per query; a real duplicate of one title is a handful of books at most. */
const CANDIDATES = 20;

/** Probe outcome: flagged books, plus the added ids skipped past {@link MAX_PROBED}. */
export interface ProbeResult {
  duplicates: PossibleDuplicate[];
  notProbed: number[];
}

async function searchIds(deps: BaseDeps, query: string, library?: string): Promise<number[]> {
  const page = await deps.content.search({ query, num: CANDIDATES, library });
  return page.bookIds;
}

/**
 * Check each newly added id against the library (other books added in this call included).
 * Throws on read failure — the caller owns the degrade-and-log policy.
 */
export async function probeDuplicates(deps: BaseDeps, addedIds: number[], library?: string): Promise<ProbeResult> {
  const ids = addedIds.slice(0, MAX_PROBED);
  const fresh = await deps.content.booksByIds(ids, library);
  const duplicates: PossibleDuplicate[] = [];

  for (const id of ids) {
    const added = fresh.get(id);
    if (!added) continue;
    const isbn = isbnKey(added);
    const isbnIds = isbn ? await searchIds(deps, `identifiers:isbn:${isbn}`, library) : [];
    const words = foldAccents(added.title)
      .split(/[^\p{L}\p{N}\p{M}]+/u)
      .filter(Boolean)
      .slice(0, 8);
    const titleIds = words.length > 0 ? await searchIds(deps, `title:"${words.join(" ")}"`, library) : [];

    const pool = await deps.content.booksByIds([...new Set([...isbnIds, ...titleIds])], library);
    const candidates = [...pool.values()].filter((b) => b !== null && b !== undefined);
    const hit = matchAddedBook(added, candidates);
    if (hit) duplicates.push(hit);
  }
  return { duplicates, notProbed: addedIds.slice(MAX_PROBED) };
}

/** One advisory line per flagged book, with the exact next call to compare them. */
export function renderHint(d: PossibleDuplicate): string {
  const ids = [...d.of, d.id].sort((a, b) => a - b);
  const of = d.of.map((i) => `#${i}`).join(", ");
  const why = d.reason === "isbn" ? "same ISBN" : "same normalized title";
  return `⚠ #${d.id}: possible duplicate of ${of} (${why}) — run calibre_find_duplicates mode=compare ids=[${ids.join(",")}] to review. Nothing was merged or removed.`;
}

/** Text note for added ids the probe skipped, so the cap is never silent (#341). */
export function renderNotProbed(probed: number, total: number, notProbed: number[]): string {
  const list = notProbed.map((i) => `#${i}`).join(", ");
  return `Duplicate probe checked the first ${probed} of ${total} added book(s); ${notProbed.length} not probed (${list}) — run calibre_find_duplicates to check them.`;
}

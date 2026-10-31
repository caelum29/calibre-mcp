// Post-add duplicate probe for calibre_add_book (#204). calibredb's own duplicate check compares
// the embedded title, so a raw-slug import ("advanced-microservices.pdf") sails past an existing
// "Advanced Microservices". We re-check by ISBN and by normalized title. READ-only and advisory:
// callers must treat any failure as "no hint", never as an add failure.

import type { Book } from "../domain/book.js";
import { foldAccents } from "../domain/curation/normalize.js";
import type { ToolDeps } from "./deps.js";

/** A just-added book that looks like it duplicates existing ones. */
export interface PossibleDuplicate {
  id: number;
  of: number[];
  reason: "isbn" | "title";
}

/** Probe at most this many added ids — a bulk folder add must not fan out into hundreds of reads. */
const MAX_PROBED = 10;
/** Candidate pool per query; a real duplicate of one title is a handful of books at most. */
const CANDIDATES = 20;

/** Lowercase, accent-free, subtitle-free, alphanumeric-only title ("advanced-microservices" ≡ "Advanced Microservices"). */
function titleKey(title: string): string {
  let t = foldAccents(title.toLowerCase());
  const cut = t.search(/[:(]/);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

function isbnKey(b: Book): string {
  return (b.identifiers.isbn ?? "").replace(/[^0-9xX]/g, "").toUpperCase();
}

function authorKeys(b: Book): Set<string> {
  return new Set(
    b.authors.map((a) => foldAccents(a.toLowerCase()).replace(/[^\p{L}\p{N}\p{M}]/gu, "")).filter(Boolean),
  );
}

/** Same title but provably different authors is a different book (e.g. two "Algorithms"). */
function authorsConflict(a: Book, b: Book): boolean {
  const ka = authorKeys(a);
  const kb = authorKeys(b);
  if (ka.size === 0 || kb.size === 0) return false; // raw-titled imports have no authors yet
  return ![...ka].some((k) => kb.has(k));
}

async function searchIds(deps: ToolDeps, query: string, library?: string): Promise<number[]> {
  const page = await deps.content.search({ query, num: CANDIDATES, library });
  return page.bookIds;
}

/**
 * Check each newly added id against the rest of the library. Throws on read failure — the
 * caller owns the degrade-and-log policy.
 */
export async function probeDuplicates(
  deps: ToolDeps,
  addedIds: number[],
  library?: string,
): Promise<PossibleDuplicate[]> {
  const ids = addedIds.slice(0, MAX_PROBED);
  const fresh = await deps.content.booksByIds(ids, library);
  const out: PossibleDuplicate[] = [];

  for (const id of ids) {
    const added = fresh.get(id);
    if (!added) continue;
    const self = new Set(addedIds);

    const isbn = isbnKey(added);
    const isbnIds = isbn
      ? (await searchIds(deps, `identifiers:isbn:${isbn}`, library)).filter((i) => !self.has(i))
      : [];

    const key = titleKey(added.title);
    const words = foldAccents(added.title)
      .split(/[^\p{L}\p{N}\p{M}]+/u)
      .filter(Boolean)
      .slice(0, 8);
    const titleIds =
      key && words.length > 0
        ? (await searchIds(deps, `title:"${words.join(" ")}"`, library)).filter((i) => !self.has(i))
        : [];

    const pool = await deps.content.booksByIds([...new Set([...isbnIds, ...titleIds])], library);
    const byIsbn = isbnIds.filter((i) => {
      const c = pool.get(i);
      return c !== null && c !== undefined && isbn !== "" && isbnKey(c) === isbn;
    });
    const byTitle = titleIds.filter((i) => {
      const c = pool.get(i);
      return c !== null && c !== undefined && titleKey(c.title) === key && !authorsConflict(added, c);
    });

    const of = [...new Set([...byIsbn, ...byTitle])].sort((a, b) => a - b);
    if (of.length > 0) out.push({ id, of, reason: byIsbn.length > 0 ? "isbn" : "title" });
  }
  return out;
}

/** One advisory line per flagged book, with the exact next call to compare them. */
export function renderHint(d: PossibleDuplicate): string {
  const ids = [...d.of, d.id].sort((a, b) => a - b);
  const of = d.of.map((i) => `#${i}`).join(", ");
  const why = d.reason === "isbn" ? "same ISBN" : "same normalized title";
  return `⚠ #${d.id}: possible duplicate of ${of} (${why}) — run calibre_find_duplicates mode=compare ids=[${ids.join(",")}] to review. Nothing was merged or removed.`;
}

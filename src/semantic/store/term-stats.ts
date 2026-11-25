// TermStats adapter over the keyword index (#651): document frequency per chunk_fts column from
// an fts5vocab table in the TEMP schema, so a read-only handle works and the index file is never
// written. Feeds the keyword planner's stop-word pruning; #623/#652 can reuse it.

import type { DatabaseSync, StatementSync } from "node:sqlite";
import { KEYWORD_COLUMNS, type KeywordColumn, type TermStats } from "../../domain/search/keyword-plan.js";
import { dataVersion } from "./shared.js";

/** TermStats plus a count of vocab queries actually run (cache misses), for diagnostics. */
export interface Fts5TermStats extends TermStats {
  readonly lookups: number;
}

// Basis: an entry is one stem and three counts. The 120-query judged set has 769 distinct stems
// (1,718 token occurrences), so 4096 keeps several such working sets warm per library connection
// at under 1 MB; the oldest entry goes first once a long session exceeds it.
const DEFAULT_MAX_ENTRIES = 4096;

/**
 * TermStats over `chunk_fts` of `db`. One vocab query per term fills all three columns; results
 * are cached (bounded, oldest evicted first) and dropped when the file's data version changes.
 */
export function fts5TermStats(db: DatabaseSync, opts: { maxEntries?: number } = {}): Fts5TermStats {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // temp schema: per-connection and never in the file; a vocab lookup on a frequent term
  // still decodes its whole posting list (~0.5 s for "the" on a 400k-chunk index), hence the cache
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.chunk_fts_vocab USING fts5vocab(main, 'chunk_fts', 'col')");
  const byTerm: StatementSync = db.prepare("SELECT col, doc FROM temp.chunk_fts_vocab WHERE term = ?");
  const countRows: StatementSync = db.prepare("SELECT count(*) AS n FROM chunk_fts");
  const cache = new Map<string, Record<KeywordColumn, number>>();
  let version = dataVersion(db);
  let total: number | undefined;
  let lookups = 0;

  const fresh = (): void => {
    const v = dataVersion(db);
    if (v === version) return;
    version = v;
    cache.clear();
    total = undefined;
  };

  return {
    get lookups() {
      return lookups;
    },
    get totalDocs() {
      fresh();
      total ??= Number((countRows.get() as { n: number }).n);
      return total;
    },
    docFreq(term: string, column: KeywordColumn): number {
      fresh();
      let row = cache.get(term);
      if (row === undefined) {
        lookups++;
        row = { body_stem: 0, body: 0, book_meta: 0 };
        for (const r of byTerm.all(term) as { col: string; doc: number }[]) {
          if ((KEYWORD_COLUMNS as readonly string[]).includes(r.col)) row[r.col as KeywordColumn] = Number(r.doc);
        }
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
        cache.set(term, row);
      }
      return row[column];
    },
  };
}

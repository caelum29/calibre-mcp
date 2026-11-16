// Dev-only (#627): pair each calibre_semantic_search in the call log with the calibre_get_content
// reads that follow it, so "which returned hit did the agent open?" can be counted. An opened hit is
// not a relevance label — the agent chose among what it was shown.
// Run: node --import tsx scripts/pair-search-reads.ts [logDir] [--window <seconds>]   (default 180 s)
// The window is strict: reads strictly less than N s after the search are paired.

import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WINDOW_S = 180;
// book scope: the opened passage is the last one starting at or before the offset, if within this
const BOOK_OFFSET_SLACK = 4000;
const SEARCH = "calibre_semantic_search";
const READ = "calibre_get_content";

interface Hit {
  rank: number;
  bookId: number;
  charStart?: number;
}
interface Call {
  t: number;
  pid: number;
  tool: string;
  meta: Record<string, unknown>;
}

/** Median and nearest-rank p95 of one size metric. */
export interface SizeStats {
  n: number;
  median: number;
  p95: number;
}

/** Counts printed by the script; see the issue #627 for what each one answers. */
export interface PairReport {
  searchesByScope: Record<string, number>;
  followedByRead: { withOffset: number; withoutOffset: number };
  /** Rank of the opened hit, one entry per search paired with a read by offset or book id. */
  openedRanks: number[];
  /** Reads with a cursor and no id: the book can't be told, so they can't be paired. */
  cursorOnlyReads: number;
  /** Low-confidence searches followed by another semantic search on the same pid in the window. */
  lowConfidenceRetries: number;
  /** textChars/structuredChars by tool; semantic searches split by scope (`tool:scope`). */
  sizes: Record<string, Record<string, SizeStats>>;
}

const num = (v: unknown): v is number => typeof v === "number";

function scopeOf(c: Call): string {
  const args = (c.meta.args ?? {}) as Record<string, unknown>;
  return typeof args.scope === "string" ? args.scope : "library";
}

function stats(xs: number[]): SizeStats {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, median: s[Math.floor((s.length - 1) / 2)]!, p95: s[Math.ceil(0.95 * s.length) - 1]! };
}

/** The hit a read opened: by book id (library scope) or by offset (book scope). */
function openedRank(search: Call, read: Call): number | undefined {
  const args = (read.meta.args ?? {}) as Record<string, unknown>;
  const hits = (Array.isArray(search.meta.hits) ? search.meta.hits : []).filter(
    (h): h is Hit => typeof h === "object" && h !== null,
  );
  const id = args.id ?? args.bookId;
  if (scopeOf(search) === "book") {
    if (!num(args.offset)) return undefined;
    const before = hits
      .filter((h) => num(h.charStart) && h.charStart <= (args.offset as number))
      .sort((a, b) => b.charStart! - a.charStart!)[0];
    return before && (args.offset as number) - before.charStart! <= BOOK_OFFSET_SLACK ? before.rank : undefined;
  }
  return hits.find((h) => h.bookId === id)?.rank;
}

/** Pair log lines (JSONL strings) — pure, so it is testable without files. */
export function pairSearchReads(lines: readonly string[], windowSec = DEFAULT_WINDOW_S): PairReport {
  const calls: Call[] = [];
  for (const l of lines) {
    try {
      const r = JSON.parse(l) as {
        ts?: string;
        msg?: string;
        pid?: number;
        tool?: string;
        meta?: Record<string, unknown>;
      };
      if (r.msg !== "tool call" || !r.tool || !r.meta || !r.ts || !num(r.pid)) continue;
      calls.push({ t: Date.parse(r.ts), pid: r.pid, tool: r.tool, meta: r.meta });
    } catch {
      // a torn line from a concurrent append — skip
    }
  }
  calls.sort((a, b) => a.t - b.t);

  const report: PairReport = {
    searchesByScope: {},
    followedByRead: { withOffset: 0, withoutOffset: 0 },
    openedRanks: [],
    cursorOnlyReads: 0,
    lowConfidenceRetries: 0,
    sizes: {},
  };
  const sizeSamples: Record<string, Record<string, number[]>> = {};
  const windowMs = windowSec * 1000;

  for (const [i, c] of calls.entries()) {
    const key = c.tool === SEARCH ? `${SEARCH}:${scopeOf(c)}` : c.tool;
    for (const m of ["textChars", "structuredChars"] as const) {
      const v = c.meta[m];
      if (num(v)) ((sizeSamples[key] ??= {})[m] ??= []).push(v);
    }
    if (c.tool !== SEARCH) continue;
    report.searchesByScope[scopeOf(c)] = (report.searchesByScope[scopeOf(c)] ?? 0) + 1;
    const later = calls.slice(i + 1).filter((x) => x.pid === c.pid && x.t - c.t < windowMs);
    const reads = later.filter((x) => x.tool === READ);
    const paired = reads.filter((r) => {
      const a = (r.meta.args ?? {}) as Record<string, unknown>;
      return a.id !== undefined || a.bookId !== undefined;
    });
    const opened = paired.map((r) => ({ r, rank: openedRank(c, r) })).find((x) => x.rank !== undefined);
    if (opened) {
      const hasOffset = num(((opened.r.meta.args ?? {}) as Record<string, unknown>).offset);
      report.followedByRead[hasOffset ? "withOffset" : "withoutOffset"] += 1;
      report.openedRanks.push(opened.rank!);
    }
    if (c.meta.lowConfidence === true && later.some((x) => x.tool === SEARCH)) report.lowConfidenceRetries += 1;
  }
  // cursor-only reads are counted once each, whether or not a search precedes them
  report.cursorOnlyReads = calls.filter((x) => {
    const a = (x.meta.args ?? {}) as Record<string, unknown>;
    return x.tool === READ && a.id === undefined && a.bookId === undefined && a.cursor !== undefined;
  }).length;

  for (const [k, byMetric] of Object.entries(sizeSamples)) {
    report.sizes[k] = Object.fromEntries(Object.entries(byMetric).map(([m, xs]) => [m, stats(xs)]));
  }
  return report;
}

// same default as src/config.ts (<indexDir>/logs); CALIBRE_MCP_INDEX_DIR overrides it
function defaultLogDir(): string {
  const explicit = process.env.CALIBRE_MCP_INDEX_DIR;
  if (explicit) return path.join(explicit, "logs");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "calibre-mcp", "index", "logs");
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "calibre-mcp", "index", "logs");
}

/** CLI args: `[logDir] [--window <seconds>]` in any order; dir undefined = the default log dir. */
export function parseArgs(argv: readonly string[]): { dir?: string; windowSec: number } {
  const wi = argv.indexOf("--window");
  const windowSec = wi >= 0 ? Number(argv[wi + 1]) : DEFAULT_WINDOW_S;
  // skip the window's value only when the flag is present (wi = -1 would drop index 0)
  const dir = argv.find((a, i) => !a.startsWith("--") && (wi < 0 || i !== wi + 1));
  return { dir, windowSec };
}

function main(argv: string[]): void {
  const { dir = defaultLogDir(), windowSec } = parseArgs(argv);
  const lines = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n"))
    .filter(Boolean);
  process.stdout.write(`${JSON.stringify(pairSearchReads(lines, windowSec), null, 2)}\n`); // dev script: stdout is fine
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));

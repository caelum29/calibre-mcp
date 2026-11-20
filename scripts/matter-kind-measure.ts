// Matter-kind measurement for a classifier change (#722): before = the kinds stored in the index,
// after = `matterKinds` re-run over each book's extracted text and its stored chunk spans. Never
// writes the index (opened read-only). Two steps, so the slow extraction runs once:
//   --snapshot <file.jsonl.gz>: per indexed book, the extracted text (text cache, else re-extracted
//     through the Extractor, which writes only the temp text cache), its outline / EPUB TOC, the
//     stored spans, kinds and sections. Large (the whole text of every book): keep it in a scratch dir.
//   --report <file.jsonl.gz>: the before/after tables, changed chunks and a seeded random sample.
// Run: node --import tsx scripts/matter-kind-measure.ts --library Humanities --snapshot <f> [--ids 1,2]
//      node --import tsx scripts/matter-kind-measure.ts --report <f> [--sample 20] [--seed 722]

import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip, createGzip } from "node:zlib";
import { ContentServerClient } from "../src/calibre/content-server.js";
import { Extractor, peekTextCache } from "../src/calibre/extract.js";
import { FigureInventoryService } from "../src/calibre/figure-inventory.js";
import { chooseExtractFormat } from "../src/domain/extract-format.js";
import type { EpubToc } from "../src/domain/structure/epub-toc.js";
import { isIndexTitle } from "../src/domain/structure/front-matter-titles.js";
import { type MatterKind, matterKinds, toMatterKind } from "../src/domain/structure/matter-kind.js";
import type { OutlineEntry } from "../src/domain/structure/pdf-outline.js";
import { log } from "../src/logging.js";
import { loadRuntimeConfig } from "../src/runtime-config.js";
import { structureOf } from "../src/semantic/book-encoder.js";
import { textMatchesChunks } from "../src/semantic/content-match.js";
import { IndexFileOwners } from "../src/semantic/store/library-owner.js";
import { IndexConnections } from "../src/semantic/store/schema.js";

const { values: opt } = parseArgs({
  options: {
    library: { type: "string" },
    snapshot: { type: "string" },
    report: { type: "string" },
    ids: { type: "string" },
    concurrency: { type: "string", default: "2" },
    "index-dir": { type: "string" },
    sample: { type: "string", default: "20" },
    seed: { type: "string", default: "722" },
  },
});

/** One book as the snapshot stores it. */
interface BookSnap {
  libraryId: string;
  bookId: number;
  title: string;
  source: "cache" | "extract";
  text: string;
  outline: OutlineEntry[];
  epubToc: EpubToc | null;
  /** [charStart, charEnd, stored kind] per chunk, in text order. */
  spans: [number, number, string][];
  /** [level, title, charStart, charEnd, source] per stored section. */
  sections: [number, string, number, number, string][];
  /** The flags-only refresh refuses a book whose text no longer matches its chunks. */
  textMatches: boolean;
}

function say(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

async function snapshot(libraryId: string, out: string): Promise<void> {
  const config = loadRuntimeConfig(process.env);
  const indexDir = path.resolve(opt["index-dir"] ?? config.indexDir);
  const content = new ContentServerClient(config);
  const extractor = new Extractor(config, new FigureInventoryService(config));
  // IndexConnections.read opens a short-lived READ-ONLY handle per call: never creates or writes.
  const conn = new IndexConnections({ ...config, indexDir }, log, new IndexFileOwners(indexDir));
  const read = <T>(sql: string, ...args: number[]): T[] =>
    conn.read(libraryId, (db) => db.prepare(sql).all(...args) as unknown as T[], [] as T[]);
  const indexed = read<{ book_id: number }>("SELECT book_id FROM books ORDER BY book_id").map((r) => Number(r.book_id));
  const ids = opt.ids ? opt.ids.split(",").map((s) => Number(s.trim())) : indexed;

  const gz = createGzip();
  const done = new Promise<void>((res, rej) => {
    gz.pipe(createWriteStream(out))
      .on("finish", () => res())
      .on("error", rej);
  });
  let next = 0;
  let n = 0;
  const one = async (bookId: number): Promise<void> => {
    const book = await content.getBook(bookId, libraryId);
    const fmt = chooseExtractFormat(book.formats);
    if (!fmt) throw new Error("no extractable format");
    // Same key as indexing (src/app/index-book.ts), so a cached extract is the indexed text.
    const cacheKey = `${bookId}:${fmt}:${book.lastModified ?? ""}`;
    const hit = await peekTextCache(cacheKey);
    const base = config.serverUrl.replace(/\/+$/, "");
    const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${bookId}/${encodeURIComponent(libraryId)}`;
    const src = hit
      ? { text: hit.text, outline: hit.outline ?? [], epubToc: hit.epubToc ?? null }
      : await extractor.getText({ bookId, format: fmt, downloadUrl, cacheKey });
    const rows = read<{ char_start: number; char_end: number; matter_kind: string; body: string }>(
      "SELECT char_start, char_end, matter_kind, body FROM chunks WHERE book_id = ? ORDER BY char_start",
      bookId,
    );
    const sections = read<{ level: number; title: string; char_start: number; char_end: number; source: string }>(
      "SELECT level, title, char_start, char_end, source FROM sections WHERE book_id = ? ORDER BY char_start",
      bookId,
    );
    const spans = rows.map((r) => ({ charStart: Number(r.char_start), charEnd: Number(r.char_end), body: r.body }));
    const snap: BookSnap = {
      libraryId,
      bookId,
      title: book.title,
      source: hit ? "cache" : "extract",
      text: src.text,
      outline: src.outline,
      epubToc: src.epubToc,
      spans: rows.map((r) => [Number(r.char_start), Number(r.char_end), r.matter_kind]),
      sections: sections.map((s) => [Number(s.level), s.title, Number(s.char_start), Number(s.char_end), s.source]),
      textMatches: textMatchesChunks(src.text, spans),
    };
    gz.write(JSON.stringify(snap) + "\n");
  };
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const bookId = ids[next++]!;
      try {
        await one(bookId);
      } catch (err) {
        say(`#${bookId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (++n % 25 === 0) say(`${n}/${ids.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(opt.concurrency)) }, worker));
  gz.end();
  await done;
  say(`snapshot of ${n} books → ${out}`);
}

async function* books(file: string): AsyncGenerator<BookSnap> {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as BookSnap;
}

/** Deterministic PRNG (mulberry32), so a report's sample is reproducible from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Changed {
  libraryId: string;
  bookId: number;
  title: string;
  charStart: number;
  charEnd: number;
  before: MatterKind;
  after: MatterKind;
  position: number;
  inIndexSection: boolean;
  /** The book has no level-1 Index section at all: only the locator-density rule can flag it. */
  noIndexSection: boolean;
  text: string;
}

/** Kind → [chunks, distinct books] tally. */
class Tally {
  readonly #m = new Map<string, { chunks: number; books: Set<string> }>();
  add(kind: string, book: string): void {
    const e = this.#m.get(kind) ?? { chunks: 0, books: new Set<string>() };
    e.chunks++;
    e.books.add(book);
    this.#m.set(kind, e);
  }
  cell(kind: string): string {
    const e = this.#m.get(kind);
    return e ? `${e.chunks.toLocaleString("en-US")} / ${e.books.size}` : "0";
  }
}

async function report(file: string): Promise<void> {
  const KINDS: MatterKind[] = ["back_index", "back_other", "back_biblio", "body", "front"];
  const libs = new Map<string, { before: Tally; after: Tally; books: number; mismatched: number }>();
  const changed: Changed[] = [];
  for await (const b of books(file)) {
    const lib = libs.get(b.libraryId) ?? { before: new Tally(), after: new Tally(), books: 0, mismatched: 0 };
    libs.set(b.libraryId, lib);
    lib.books++;
    // The flags-only refresh refuses these books (TEXT_CHANGED): their stored kinds stay as they are.
    if (!b.textMatches) {
      lib.mismatched++;
      continue;
    }
    const spans = b.spans.map(([charStart, charEnd]) => ({ charStart, charEnd }));
    const after = matterKinds(b.text, spans, structureOf(b));
    // "Index section": a level-1 outline / EPUB TOC section whose title names an index (#722 table).
    const indexSections = b.sections.filter(
      ([level, title, , , source]) => level === 1 && source !== "chapters" && isIndexTitle(title),
    );
    const key = `${b.libraryId}:${b.bookId}`;
    b.spans.forEach(([s, e, stored], i) => {
      const before = toMatterKind(stored);
      const inIndexSection = indexSections.some(([, , from, to]) => from <= s && s < to);
      if (inIndexSection) {
        lib.before.add(before, key);
        lib.after.add(after[i]!, key);
      }
      if (before !== after[i]) {
        const position = s / b.text.length;
        changed.push({
          libraryId: b.libraryId,
          bookId: b.bookId,
          title: b.title,
          charStart: s,
          charEnd: e,
          before,
          after: after[i]!,
          position,
          inIndexSection,
          noIndexSection: indexSections.length === 0,
          text: b.text.slice(s, e),
        });
      }
    });
  }

  const out: string[] = [];
  out.push("## Chunks under a level-1 outline / TOC Index section, by kind (chunks / books)\n");
  out.push(`| Library | when | ${KINDS.map((k) => `\`${k}\``).join(" | ")} |`);
  out.push(`|---|---|${KINDS.map(() => "---").join("|")}|`);
  for (const [id, l] of libs) {
    out.push(`| \`${id}\` | before | ${KINDS.map((k) => l.before.cell(k)).join(" | ")} |`);
    out.push(`| \`${id}\` | after | ${KINDS.map((k) => l.after.cell(k)).join(" | ")} |`);
  }
  out.push("\n## Chunks that change kind\n");
  out.push(
    "| Library | books | books skipped (text changed) | in an Index section | elsewhere | of which books with no Index section | total chunks | total books |",
  );
  out.push("|---|---|---|---|---|---|---|---|");
  for (const [id, l] of libs) {
    const c = changed.filter((x) => x.libraryId === id);
    const inIdx = c.filter((x) => x.inIndexSection);
    const out1 = c.filter((x) => !x.inIndexSection);
    const noIdx = c.filter((x) => x.noIndexSection);
    const nb = (xs: Changed[]) => new Set(xs.map((x) => x.bookId)).size;
    out.push(
      `| \`${id}\` | ${l.books} | ${l.mismatched} | ${inIdx.length} / ${nb(inIdx)} | ${out1.length} / ${nb(out1)} | ${noIdx.length} / ${nb(noIdx)} | ${c.length} | ${nb(c)} |`,
    );
  }
  const transitions = new Map<string, number>();
  for (const c of changed)
    transitions.set(
      `${c.libraryId} ${c.before} → ${c.after}`,
      (transitions.get(`${c.libraryId} ${c.before} → ${c.after}`) ?? 0) + 1,
    );
  out.push("\nTransitions: " + [...transitions].map(([t, n]) => `${t}: ${n}`).join("; "));

  const flagged = changed.filter((c) => c.after === "back_index" && c.before !== "back_index");
  const rand = rng(Number(opt.seed));
  const pool = [...flagged];
  const sample: Changed[] = [];
  while (sample.length < Number(opt.sample) && pool.length > 0)
    sample.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  out.push(`\n## Sample: ${sample.length} of ${flagged.length} newly flagged back_index chunks (seed ${opt.seed})\n`);
  for (const c of sample) {
    out.push(
      `### ${c.libraryId} #${c.bookId} @${c.charStart} (${c.before} → ${c.after}, pos ${c.position.toFixed(3)}, index section: ${c.inIndexSection})`,
    );
    out.push(`_${c.title}_\n`);
    out.push("```\n" + c.text.slice(0, 600).replaceAll("```", "'''") + "\n```");
  }
  const unflagged = changed.filter((c) => c.before === "back_index");
  out.push(`\n## Chunks that lose back_index: ${unflagged.length}\n`);
  for (const c of unflagged.slice(0, 20)) out.push(`- ${c.libraryId} #${c.bookId} @${c.charStart} → ${c.after}`);
  process.stdout.write(out.join("\n") + "\n");
}

if (opt.snapshot && opt.library) await snapshot(opt.library, opt.snapshot);
else if (opt.report) await report(opt.report);
else throw new Error("--library <libId> --snapshot <file.jsonl.gz>, or --report <file.jsonl.gz>");

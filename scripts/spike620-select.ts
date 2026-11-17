// #620 spike (never merged): deterministic 30-book subset of Programming_Books for the
// section-path prefix A/B, with a reason per book. Rules 1–5 are the issue's "The 30-book subset".
// Read-only: the index snapshot (books table), Content Server metadata, PDF outlines / EPUB TOCs
// from the extract cache or a scratch download. Never writes the index or the cache.
// Run: node --import tsx scripts/spike620-select.ts --queries <queries.json> --index <Programming_Books.sqlite> --out <subset.json>

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ContentServerClient } from "../src/calibre/content-server.js";
import type { Book } from "../src/domain/book.js";
import { peekTextCache } from "../src/calibre/extract.js";
import { readEpubToc, unzipBinary } from "../src/calibre/epub-toc.js";
import { downloadToFile } from "../src/calibre/http.js";
import { pdftohtmlBinary, readPdfOutline } from "../src/calibre/pdf-outline.js";
import { chooseExtractFormat } from "../src/domain/extract-format.js";
import { isFrontMatterTitle } from "../src/domain/structure/front-matter-titles.js";
import type { OutlineEntry } from "../src/domain/structure/pdf-outline.js";
import { loadRuntimeConfig } from "../src/runtime-config.js";
import type { JudgedQuery } from "./judged-lib.js";
import { log } from "../src/logging.js";
import { IndexFileOwners } from "../src/semantic/store/library-owner.js";
import { IndexConnections } from "../src/semantic/store/schema.js";

const LIB = "Programming_Books";
const SIZE = 30;
/** Most PDFs the step-2 scan downloads before giving up (it needs only 3 matches). */
const SCAN_CAP = 300;

const { values: opt } = parseArgs({
  options: { queries: { type: "string" }, index: { type: "string" }, out: { type: "string" } },
});
if (!opt.queries || !opt.index || !opt.out) throw new Error("--queries, --index and --out are required");

const config = loadRuntimeConfig(process.env);
const content = new ContentServerClient(config);
const queries = (JSON.parse(readFileSync(opt.queries, "utf8")) as JudgedQuery[]).filter((q) => q.library === LIB);
// Read-only handle per call through the one connection owner (#272); never creates or migrates.
const indexDir = path.dirname(path.resolve(opt.index));
const conn = new IndexConnections({ ...config, indexDir }, log, new IndexFileOwners(indexDir));
const indexed = new Set(
  conn.read(
    LIB,
    (db) =>
      (db.prepare("SELECT book_id FROM books WHERE embedded_chunks > 0").all() as { book_id: number }[]).map((r) =>
        Number(r.book_id),
      ),
    [] as number[],
  ),
);
const scratch = path.join(tmpdir(), `spike620-${process.pid}`);
mkdirSync(scratch, { recursive: true });

const say = (m: string) => process.stderr.write(`${m}\n`);
const metaCache = new Map<number, Book>();
async function meta(id: number): Promise<Book> {
  let b = metaCache.get(id);
  if (!b) {
    b = await content.getBook(id, LIB);
    metaCache.set(id, b);
  }
  return b;
}
const fmtOf = async (id: number) => chooseExtractFormat((await meta(id)).formats) ?? "none";
const isRu = async (id: number) => (await meta(id)).languages.some((l) => /^(rus|ru)$/i.test(l));

/** Structure from the extract cache (same key as indexing), else a scratch download. */
async function structure(id: number): Promise<{ outline: OutlineEntry[]; tocEntries: number }> {
  const b = await meta(id);
  const fmt = await fmtOf(id);
  const hit = await peekTextCache(`${id}:${fmt}:${b.lastModified ?? ""}`);
  if (hit) return { outline: hit.outline ?? [], tocEntries: hit.epubToc?.entries.length ?? 0 };
  if (fmt !== "pdf" && fmt !== "epub") return { outline: [], tocEntries: 0 };
  const file = path.join(scratch, `${id}.${fmt}`);
  const url = `${config.serverUrl.replace(/\/+$/, "")}/get/${fmt.toUpperCase()}/${id}/${LIB}`;
  try {
    await downloadToFile(url, file, { maxBytes: config.maxBookBytes });
    if (fmt === "pdf") {
      const bin = pdftohtmlBinary();
      return { outline: bin ? await readPdfOutline(bin, file) : [], tocEntries: 0 };
    }
    const unzip = unzipBinary();
    const toc = unzip ? await readEpubToc(unzip, file, "", { scratchRoot: scratch }) : null;
    return { outline: [], tocEntries: toc?.entries.length ?? 0 };
  } finally {
    rmSync(file, { force: true });
  }
}

/** The #625 pattern: a title-page entry, then at least two named front-matter entries. */
function titleThenFrontMatter(o: OutlineEntry[]): boolean {
  if (o.length < 3 || isFrontMatterTitle(o[0]!.title) || /^\s*\d/.test(o[0]!.title)) return false;
  return isFrontMatterTitle(o[1]!.title) && isFrontMatterTitle(o[2]!.title);
}

interface Pick {
  id: number;
  title: string;
  format: string;
  language: string;
  step: number;
  reason: string;
}
const picks: Pick[] = [];
const has = (id: number) => picks.some((p) => p.id === id);
async function add(id: number, step: number, reason: string): Promise<void> {
  const b = await meta(id);
  picks.push({ id, title: b.title, format: await fmtOf(id), language: b.languages.join(","), step, reason });
  say(`+ ${id} [${await fmtOf(id)}] step ${step}: ${reason}`);
}

// 1. Greedy set cover over the expected books of the judged long + problem queries.
const lp = queries.filter((q) => q.category === "long" || q.category === "problem");
const uncovered = new Set(lp.map((q) => q.id));
while (uncovered.size > 0 && picks.length < SIZE) {
  const votes = new Map<number, string[]>();
  for (const q of lp) {
    if (!uncovered.has(q.id)) continue;
    for (const e of q.expectedBooks) {
      if (!indexed.has(e.id) || has(e.id)) continue;
      votes.set(e.id, [...(votes.get(e.id) ?? []), q.id]);
    }
  }
  if (votes.size === 0) break; // the rest name no indexed book
  const [id, qids] = [...votes.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0]!;
  await add(id, 1, `set cover: ${qids.join(", ")}`);
  for (const q of qids) uncovered.delete(q);
}
if (uncovered.size > 0) say(`step 1: ${uncovered.size} long/problem queries name no indexed book: ${[...uncovered]}`);

// 2. At least 3 PDFs whose outline opens with a title page then named front matter (#625).
const fmPdf = new Set<number>();
for (const p of picks) if (p.format === "pdf" && titleThenFrontMatter((await structure(p.id)).outline)) fmPdf.add(p.id);
const pdfIds = [...indexed].sort((a, b) => a - b);
let scanned = 0;
for (const id of [1075, ...pdfIds.filter((x) => x !== 1075)]) {
  if (fmPdf.size >= 3 || scanned >= SCAN_CAP) break;
  if (has(id) || (await fmtOf(id)) !== "pdf") continue;
  scanned++;
  if (titleThenFrontMatter((await structure(id)).outline)) {
    fmPdf.add(id);
    await add(id, 2, "PDF outline: title-page entry then named front matter (#625)");
  }
}

// 3. At least 4 Russian books: xling expected books first, then the lowest ids with structure.
const count = async (f: (id: number) => Promise<boolean>) => {
  let n = 0;
  for (const p of picks) if (await f(p.id)) n++;
  return n;
};
const byVotes = (cats: string[]): number[] => {
  const v = new Map<number, number>();
  for (const q of queries.filter((x) => cats.includes(x.category))) {
    for (const e of q.expectedBooks) v.set(e.id, (v.get(e.id) ?? 0) + 1);
  }
  return [...v.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
};
for (const id of byVotes(["xling"])) {
  if ((await count(isRu)) >= 4) break;
  if (indexed.has(id) && !has(id) && (await isRu(id))) await add(id, 3, "Russian; expected book of an xling query");
}
if ((await count(isRu)) < 4) {
  const ru = (await content.search({ query: "languages:rus", library: LIB, num: 5000 })).bookIds
    .filter((id) => indexed.has(id))
    .sort((a, b) => a - b);
  for (const id of ru) {
    if ((await count(isRu)) >= 4) break;
    if (has(id)) continue;
    const s = await structure(id);
    if (s.outline.length > 0 || s.tocEntries > 0) await add(id, 3, "Russian; lowest id with an outline or TOC");
  }
}

// 4. At least 8 EPUB and 8 PDF; 5. fill to 30 — both from para + concept expected books.
const order = byVotes(["para", "concept"]).filter((id) => indexed.has(id));
for (const fmt of ["epub", "pdf"]) {
  for (const id of order) {
    if ((await count(async (x) => (await fmtOf(x)) === fmt)) >= 8 || picks.length >= SIZE) break;
    if (!has(id) && (await fmtOf(id)) === fmt)
      await add(id, 4, `${fmt.toUpperCase()} quota; para/concept expected book`);
  }
}
for (const id of order) {
  if (picks.length >= SIZE) break;
  if (!has(id)) await add(id, 5, "fill; para/concept expected book");
}

rmSync(scratch, { recursive: true, force: true });
const summary = {
  books: picks.length,
  pdf: await count(async (x) => (await fmtOf(x)) === "pdf"),
  epub: await count(async (x) => (await fmtOf(x)) === "epub"),
  russian: await count(isRu),
  frontMatterOutlinePdfs: [...fmPdf],
  uncoveredLongProblem: [...uncovered],
};
writeFileSync(
  opt.out,
  JSON.stringify({ library: LIB, ids: picks.map((p) => p.id).sort((a, b) => a - b), summary, books: picks }, null, 1) +
    "\n",
);
say(JSON.stringify(summary));

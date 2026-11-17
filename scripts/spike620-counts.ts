// #620 spike step 1 (never merged): bound the gain before any embedding. Per subset book, from
// the chunks stored today: (a) chunks that would get a section path deeper than the book title
// (the only ones arm 1 changes) and (b) straddling chunks, whose span holds a body-section start
// after its first char (what arm 2 changes). Text = the stored chunks laid back at their offsets
// (gaps = dropped whitespace-only chunks, refilled with spaces), so offsets are the indexed ones;
// structure comes from the extract cache or a scratch download. Read-only everywhere.
// Run: node --import tsx scripts/spike620-counts.ts --index <Programming_Books.sqlite> --subset <subset.json> --out <counts.json>

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ContentServerClient } from "../src/calibre/content-server.js";
import { peekTextCache } from "../src/calibre/extract.js";
import { readEpubToc, unzipBinary } from "../src/calibre/epub-toc.js";
import { downloadToFile } from "../src/calibre/http.js";
import { pdftohtmlBinary, readPdfOutline } from "../src/calibre/pdf-outline.js";
import { chooseExtractFormat } from "../src/domain/extract-format.js";
import type { EpubToc } from "../src/domain/structure/epub-toc.js";
import type { OutlineEntry } from "../src/domain/structure/pdf-outline.js";
import { bookSections, sectionPathAt, sectionStarts } from "../src/domain/structure/sections.js";
import { loadRuntimeConfig } from "../src/runtime-config.js";

const LIB = "Programming_Books";
const { values: opt } = parseArgs({
  options: { index: { type: "string" }, subset: { type: "string" }, out: { type: "string" } },
});
if (!opt.index || !opt.subset || !opt.out) throw new Error("--index, --subset and --out are required");

const config = loadRuntimeConfig(process.env);
const content = new ContentServerClient(config);
const ids = (JSON.parse(readFileSync(opt.subset, "utf8")) as { ids: number[] }).ids;
const db = new DatabaseSync(opt.index, { readOnly: true });
const scratch = path.join(tmpdir(), `spike620c-${process.pid}`);
mkdirSync(scratch, { recursive: true });

interface Row {
  char_start: number;
  char_end: number;
  body: string;
  front_matter: number;
}

/** The indexed text in its stored coordinates. */
function rebuild(rows: Row[]): string {
  let text = "";
  for (const r of rows) {
    if (r.char_start > text.length) text += " ".repeat(r.char_start - text.length);
    text = text.slice(0, r.char_start) + r.body;
  }
  return text;
}

/** Outline / TOC for the stored text: the cache when its text is the indexed one, else a download. */
async function structureFor(
  id: number,
  fmt: string,
  lastModified: string,
  text: string,
): Promise<{ outline: OutlineEntry[]; epubToc: EpubToc | null; from: string }> {
  const hit = await peekTextCache(`${id}:${fmt}:${lastModified}`);
  if (hit && hit.text.length === text.length) {
    return { outline: hit.outline ?? [], epubToc: hit.epubToc ?? null, from: "cache" };
  }
  const file = path.join(scratch, `${id}.${fmt}`);
  try {
    await downloadToFile(`${config.serverUrl.replace(/\/+$/, "")}/get/${fmt.toUpperCase()}/${id}/${LIB}`, file, {
      maxBytes: config.maxBookBytes,
    });
    if (fmt === "pdf") {
      const bin = pdftohtmlBinary();
      return { outline: bin ? await readPdfOutline(bin, file) : [], epubToc: null, from: "download" };
    }
    if (fmt === "epub") {
      const unzip = unzipBinary();
      const toc = unzip ? await readEpubToc(unzip, file, text, { scratchRoot: scratch }) : null;
      return { outline: [], epubToc: toc, from: "download" };
    }
    return { outline: [], epubToc: null, from: "download" };
  } finally {
    rmSync(file, { force: true });
  }
}

interface BookCount {
  id: number;
  title: string;
  format: string;
  source: string;
  sections: number;
  bodySections: number;
  chunks: number;
  frontMatterChunks: number;
  deeperPath: number;
  chapterOnlyPath: number;
  straddling: number;
  straddlingChapter: number;
}
const books: BookCount[] = [];
for (const id of ids) {
  const b = await content.getBook(id, LIB);
  const fmt = chooseExtractFormat(b.formats) ?? "none";
  const rows = db
    .prepare("SELECT char_start, char_end, body, front_matter FROM chunks WHERE book_id = ? ORDER BY char_start")
    .all(id) as unknown as Row[];
  const text = rebuild(rows);
  const st = await structureFor(id, fmt, b.lastModified ?? "", text);
  const { source, sections } = bookSections(text, { ...st, markdown: fmt === "epub" });
  const starts = sectionStarts(sections);
  const chapterStarts = new Set(sections.filter((s) => s.chapter && !s.frontMatter).map((s) => s.start));
  let deeper = 0;
  let chapterOnly = 0;
  let straddling = 0;
  let straddlingChapter = 0;
  let si = 0;
  for (const r of rows) {
    const p = Number(r.front_matter) === 1 ? [] : sectionPathAt(sections, Number(r.char_start));
    if (p.length > 0) deeper++;
    if (p.length === 1) chapterOnly++;
    while (si < starts.length && starts[si]! <= Number(r.char_start)) si++;
    let k = si;
    let any = false;
    let chap = false;
    while (k < starts.length && starts[k]! < Number(r.char_end)) {
      any = true;
      if (chapterStarts.has(starts[k]!)) chap = true;
      k++;
    }
    if (any) straddling++;
    if (chap) straddlingChapter++;
  }
  const row: BookCount = {
    id,
    title: b.title,
    format: fmt,
    source: `${source} (${st.from})`,
    sections: sections.length,
    bodySections: sections.filter((s) => !s.frontMatter).length,
    chunks: rows.length,
    frontMatterChunks: rows.filter((r) => Number(r.front_matter) === 1).length,
    deeperPath: deeper,
    chapterOnlyPath: chapterOnly,
    straddling,
    straddlingChapter,
  };
  books.push(row);
  process.stderr.write(
    `${id} ${fmt} ${row.source} sections=${row.bodySections}/${row.sections} chunks=${row.chunks} deeper=${deeper} straddling=${straddling}\n`,
  );
}
db.close();
rmSync(scratch, { recursive: true, force: true });

const sum = (rows: BookCount[]) => {
  const t = (k: keyof BookCount) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const chunks = t("chunks");
  const pct = (n: number) => Number(((100 * n) / Math.max(1, chunks)).toFixed(1));
  return {
    books: rows.length,
    chunks,
    frontMatterChunks: t("frontMatterChunks"),
    deeperPath: t("deeperPath"),
    deeperPathPct: pct(t("deeperPath")),
    straddling: t("straddling"),
    straddlingPct: pct(t("straddling")),
    straddlingChapter: t("straddlingChapter"),
    straddlingChapterPct: pct(t("straddlingChapter")),
  };
};
const total = sum(books);
const out = {
  rule: "straddling < 10% of the subset's chunks → arm 2 is not run (bounded, not worth the boundary change)",
  arm2: total.straddlingPct < 10 ? "not run" : "run",
  total,
  perFormat: Object.fromEntries(
    [...new Set(books.map((b) => b.format))].map((f) => [f, sum(books.filter((b) => b.format === f))]),
  ),
  books,
};
writeFileSync(opt.out, JSON.stringify(out, null, 1) + "\n");
process.stderr.write(`${JSON.stringify({ total, arm2: out.arm2, perFormat: out.perFormat })}\n`);

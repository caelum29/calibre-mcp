// Chapter-map dump for the front-matter regression check (#625): per indexed book, the chapter
// detector, its chapter headings with offsets, frontMatterEnd and how many stored chunk spans that
// boundary flags. Never writes the index (opened read-only). Default text source is the extract
// cache, read without touching it; --extract re-extracts cache misses through the Extractor,
// which writes the text cache (a temp LRU) but nothing else.
// Run: node --import tsx scripts/chapter-map-dump.ts --library Programming_Books --out <file.jsonl>
//      [--ids 1075,116] [--extract] [--index-dir <dir>]

import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ContentServerClient } from "../src/calibre/content-server.js";
import { Extractor, peekTextCache } from "../src/calibre/extract.js";
import { FigureInventoryService } from "../src/calibre/figure-inventory.js";
import { chooseExtractFormat } from "../src/domain/extract-format.js";
import { detectChapters } from "../src/domain/structure/chapters.js";
import type { EpubToc } from "../src/domain/structure/epub-toc.js";
import type { OutlineEntry } from "../src/domain/structure/pdf-outline.js";
import { frontMatterEnd } from "../src/domain/structure/front-matter.js";
import { loadRuntimeConfig } from "../src/runtime-config.js";
import { structureOf } from "../src/semantic/book-encoder.js";
import { isFrontMatterSpan } from "../src/domain/structure/matter-kind.js";
import { log } from "../src/logging.js";
import { IndexFileOwners } from "../src/semantic/store/library-owner.js";
import { IndexConnections } from "../src/semantic/store/schema.js";

const { values: opt } = parseArgs({
  options: {
    library: { type: "string" },
    out: { type: "string" },
    ids: { type: "string" },
    extract: { type: "boolean", default: false },
    "index-dir": { type: "string" },
  },
});
if (!opt.library || !opt.out) throw new Error("--library <libId> and --out <file.jsonl> are required");

const config = loadRuntimeConfig(process.env);
const libraryId = opt.library;
const indexDir = path.resolve(opt["index-dir"] ?? config.indexDir);
const content = new ContentServerClient(config);
// Only built for --extract: a cache hit never reaches the Extractor, so the default run writes nothing.
const extractor = opt.extract ? new Extractor(config, new FigureInventoryService(config)) : undefined;

// IndexConnections.read opens a short-lived READ-ONLY handle per call (never creates,
// migrates or writes the file); the dump must never touch the production index.
const conn = new IndexConnections({ ...config, indexDir }, log, new IndexFileOwners(indexDir));
interface SpanRow {
  char_start: number;
  char_end: number;
  matter_kind: string;
}
const spansOf = (bookId: number): SpanRow[] =>
  conn.read(
    libraryId,
    (db) =>
      db
        .prepare("SELECT char_start, char_end, matter_kind FROM chunks WHERE book_id = ? ORDER BY char_start")
        .all(bookId) as unknown as SpanRow[],
    [],
  );
const indexed = conn.read(
  libraryId,
  (db) =>
    (db.prepare("SELECT book_id FROM books ORDER BY book_id").all() as { book_id: number }[]).map((r) =>
      Number(r.book_id),
    ),
  [] as number[],
);
const ids = opt.ids ? opt.ids.split(",").map((s) => Number(s.trim())) : indexed;

function say(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

const lines: string[] = [];
for (const [i, bookId] of ids.entries()) {
  try {
    const book = await content.getBook(bookId, libraryId);
    const fmt = chooseExtractFormat(book.formats);
    if (!fmt) throw new Error("no extractable format");
    // Same key as indexing (src/app/index-book.ts), so a cached extract is the indexed text.
    const cacheKey = `${bookId}:${fmt}:${book.lastModified ?? ""}`;
    let src: { text: string; outline: OutlineEntry[]; epubToc: EpubToc | null };
    let source: "cache" | "extract";
    const hit = await peekTextCache(cacheKey);
    if (hit) {
      src = { text: hit.text, outline: hit.outline ?? [], epubToc: hit.epubToc ?? null };
      source = "cache";
    } else if (extractor) {
      const base = config.serverUrl.replace(/\/+$/, "");
      const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${bookId}/${encodeURIComponent(libraryId)}`;
      const x = await extractor.getText({ bookId, format: fmt, downloadUrl, cacheKey });
      src = { text: x.text, outline: x.outline, epubToc: x.epubToc };
      source = "extract";
    } else {
      lines.push(JSON.stringify({ bookId, title: book.title, format: fmt, source: "miss" }));
      say(`${i + 1}/${ids.length} #${bookId} cache miss (pass --extract to re-extract)`);
      continue;
    }
    const structure = structureOf(src);
    const { chapters, detector } = detectChapters(src.text, structure);
    const fmEnd = frontMatterEnd(src.text, structure);
    const spans = spansOf(bookId);
    const flagged = spans.filter((s) =>
      isFrontMatterSpan({ charStart: Number(s.char_start), charEnd: Number(s.char_end) }, fmEnd),
    ).length;
    lines.push(
      JSON.stringify({
        bookId,
        title: book.title,
        format: fmt,
        source,
        chars: src.text.length,
        detector,
        chapters: chapters.map((c) => ({ heading: c.heading, startChar: c.startChar })),
        frontMatterEnd: fmEnd,
        spans: spans.length,
        flagged,
        storedFlagged: spans.filter((s) => s.matter_kind === "front").length,
      }),
    );
    say(`${i + 1}/${ids.length} #${bookId} ${detector} fmEnd=${fmEnd} flagged=${flagged}/${spans.length}`);
  } catch (err) {
    lines.push(JSON.stringify({ bookId, error: err instanceof Error ? err.message : String(err) }));
    say(`${i + 1}/${ids.length} #${bookId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
writeFileSync(opt.out, lines.join("\n") + "\n", "utf8");
say(`wrote ${lines.length} rows to ${opt.out}`);

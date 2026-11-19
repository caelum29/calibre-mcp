// #654 wiring: the index trip detects the book's language from its text (ADR-0032 item 2) and
// stores it as books.lang with the chunks; Calibre's `languages` field is not read.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ExtractedText } from "../../src/calibre/extract.js";
import type { Embedder } from "../../src/semantic/embedder.js";
import { inThreadEncoder, type EncodeJob } from "../../src/semantic/book-encoder.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import { prepareBook, type PrepareOptions } from "../../src/app/index-book.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIB = "Humanities";

// Self-authored prose, repeated to book length.
const RU = "Эта книга рассказывает о потоках и блокировках, которые возникают в программах. ".repeat(60);
const EN = "This book explains threads and the deadlocks that appear in programs. ".repeat(60);

const embedder: Embedder = {
  async embedQuery() {
    return new Float32Array(EMBED_DIM);
  },
  async embedPassages(texts) {
    return texts.map(() => {
      const v = new Float32Array(EMBED_DIM);
      v[0] = 1;
      return v;
    });
  },
  async warmup() {},
  countTokens: (s) => Math.ceil(s.length / 4) + 2,
};

function deps(text: string, languages: string[]): ToolDeps {
  const book: Book = {
    id: 1,
    uuid: "u-1",
    title: "Title",
    authors: ["Someone"],
    identifiers: {},
    formats: ["epub"],
    tags: [],
    languages,
    lastModified: "2026-01-01",
  };
  return {
    config: loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }),
    content: { getBook: async () => book, resolveLibraryId: async () => LIB } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {
      getText: async (): Promise<ExtractedText> => ({
        text,
        backend: "epub",
        chars: text.length,
        cached: true,
        markers: [],
        unplaced: 0,
        outline: [],
        epubToc: null,
      }),
    } satisfies Partial<ToolDeps["extractor"]> as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder,
    index: new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" })),
    log,
  };
}

const opts: PrepareOptions = {
  libraryId: LIB,
  library: undefined,
  force: false,
  keywordOnly: false,
  tokenBudgeted: true,
};

async function detectedLang(text: string, languages: string[]): Promise<string | undefined> {
  const p = await prepareBook(deps(text, languages), 1, opts);
  if (p.kind !== "ready") throw new Error(`expected ready, got ${p.kind}`);
  return p.meta.lang;
}

describe("book language in the index trip (#654)", () => {
  it("detects the language from the text, not from Calibre's languages field", async () => {
    expect([await detectedLang(RU, ["eng"]), await detectedLang(EN, ["rus"])]).toEqual(["ru", "en"]);
  });

  it("hands the detected language to the chunker as its sentence locale (ADR-0033 item 7)", async () => {
    const jobs: EncodeJob[] = [];
    const real = inThreadEncoder(embedder);
    const encoder = { encode: (job: EncodeJob) => (jobs.push(job), real.encode(job)) };
    await prepareBook(deps(RU, []), 1, { ...opts, encoder });
    await prepareBook(deps(EN, []), 1, { ...opts, encoder });
    expect(jobs.map((j) => j.locale)).toEqual(["ru", "en"]);
  });
});

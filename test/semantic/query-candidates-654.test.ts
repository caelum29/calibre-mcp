// #716 review: query-side candidate packs (ADR-0032 item 4). A book with no detected language, or
// with a language of another script, stems its words with that script's default pack, so the
// default stays a candidate. A query's distinctive letters switch the whole query only to a pack
// that is a candidate in the library; the evidence token itself always gets its own pack (item 3).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ru } from "../../src/semantic/language/ru.js";
import { uk } from "../../src/semantic/language/uk.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { queryStemmedTokens } from "../../src/semantic/stem.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const stems = (query: string, langs: readonly (string | undefined)[]) =>
  [...queryStemmedTokens(query, new Set(langs))].map((t) => t.stems);

describe("candidate packs keep the script default (#716 review, fix 1)", () => {
  it("adds Russian when a book of another script could hold Russian-stemmed Cyrillic", () => {
    expect(stems("програмування", ["en", "uk"])).toEqual([[ru.stem("програмування"), uk.stem("програмування")]]);
  });

  it("adds Russian when a book has no detected language", () => {
    expect(stems("програмування", [undefined, "uk"])).toEqual([[ru.stem("програмування"), uk.stem("програмування")]]);
  });

  it("keeps Ukrainian alone when every book is Ukrainian", () => {
    expect(stems("програмування", ["uk"])).toEqual([[uk.stem("програмування")]]);
  });
});

describe("distinctive letters switch the query only to a candidate pack (#716 review, fix 2)", () => {
  it("keeps Russian stems for ambiguous tokens in a library without Ukrainian books", () => {
    expect(stems("взаємного блокування потоків", ["en", "ru"])).toEqual([
      [uk.stem("взаємного")],
      [ru.stem("блокування")],
      [uk.stem("потоків")],
    ]);
  });

  it("stems the whole query as Ukrainian when the library has Ukrainian books", () => {
    expect(stems("взаємного блокування потоків", ["en", "ru", "uk"])).toEqual([
      [uk.stem("взаємного")],
      [uk.stem("блокування")],
      [uk.stem("потоків")],
    ]);
  });
});

describe("a NULL-language book and a Ukrainian book both match (#716 review, fix 1)", () => {
  let dir: string;
  const LIB = "Test_Lib";
  const chunk = (i: number, body: string): IndexedChunk => {
    const v = new Float32Array(EMBED_DIM);
    v[i] = 1;
    return { body, charStart: 0, charEnd: body.length, vector: l2normalize(v) };
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-candidates-654-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds both books for `програмування`", () => {
    const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    s.replaceBook(LIB, { bookId: 1, title: "Legacy", authors: ["A"] }, [chunk(0, "основи програмування")]);
    s.replaceBook(LIB, { bookId: 2, title: "Uk", authors: ["B"], lang: "uk" }, [chunk(1, "основи програмування")]);
    const books = s.searchLibraryFts(LIB, "програмування", 10).map((h) => h.bookId);
    s.close();
    expect(books.sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

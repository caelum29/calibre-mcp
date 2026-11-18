// #695 review: section rows change in the chunks' transaction. A replaceBook that fails part
// way leaves both the chunks and the sections as they were, whichever insert threw; and the
// stored lookup puts an offset at a shared end (levels 1..3) in the next span.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { BookSections } from "../../src/domain/structure/sections.js";
import { EMBED_DIM } from "../../src/semantic/model.js";
import { type IndexedChunk, SqliteIndexStore } from "../../src/semantic/store/index.js";
import { l2normalize } from "../../src/semantic/vector.js";

const LIB = "Test_Lib";
const meta = { bookId: 1, title: "Book", authors: ["A"] };

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i] = 1;
  return l2normalize(v);
}

const chunks = (n: number, word: string): IndexedChunk[] =>
  Array.from({ length: n }, (_, i) => ({
    body: `${word} ${i}`,
    charStart: i * 100,
    charEnd: i * 100 + 100,
    vector: axis(i),
  }));

const OLD: BookSections = {
  source: "chapters",
  sections: [{ title: "Old Chapter", level: 1, charStart: 0, charEnd: 400, parent: null, matterKind: "body" }],
};
// Part [0,300) > Chapter [100,300) > Section [200,300) all end at 300, where Next starts.
const NESTED: BookSections = {
  source: "pdf-outline",
  sections: [
    { title: "Part", level: 1, charStart: 0, charEnd: 300, parent: null, matterKind: "body" },
    { title: "Chapter", level: 2, charStart: 100, charEnd: 300, parent: 0, matterKind: "body" },
    { title: "Section", level: 3, charStart: 200, charEnd: 300, parent: 1, matterKind: "body" },
    { title: "Next", level: 1, charStart: 300, charEnd: 400, parent: null, matterKind: "body" },
  ],
};

describe("sections: atomic with the chunks (#695 review)", () => {
  let dir: string;
  let s: SqliteIndexStore;
  const titles = (offset: number) => s.sectionPathAt(LIB, 1, offset).map((r) => r.title);
  const bodies = () => s.searchBookFts(LIB, 1, "old", 10).length;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calibre-mcp-sections-review-695-"));
    s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    s.replaceBook(LIB, meta, chunks(4, "old"), [], { sections: OLD });
  });

  afterEach(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a chunk insert that throws after the section write leaves the old section rows", () => {
    const bad = [...chunks(3, "new"), { body: "new 3", charStart: null as unknown as number, charEnd: 400 }];
    expect(() => s.replaceBook(LIB, meta, bad, [], { sections: NESTED })).toThrow(/NOT NULL/);
    expect(titles(250)).toEqual(["Old Chapter"]);
  });

  it("a section insert that throws leaves the old chunks and the old section rows", () => {
    const bad: BookSections = {
      source: "pdf-outline",
      sections: [{ ...NESTED.sections[0]!, title: null as unknown as string }],
    };
    expect(() => s.replaceBook(LIB, meta, chunks(4, "new"), [], { sections: bad })).toThrow(/NOT NULL/);
    expect([bodies(), titles(250)]).toEqual([4, ["Old Chapter"]]);
  });
});

describe("sections: lookup at a shared end, levels 1..3 (#695 review)", () => {
  const s = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: ":memory:" }));
  s.replaceBook(LIB, meta, chunks(4, "body"), [], { sections: NESTED });
  const titles = (offset: number) => s.sectionPathAt(LIB, 1, offset).map((r) => r.title);

  it("one char before the shared end is in all three spans", () => {
    expect(titles(299)).toEqual(["Part", "Chapter", "Section"]);
  });

  it("the shared end itself is only in the next span", () => {
    expect(titles(300)).toEqual(["Next"]);
  });
});

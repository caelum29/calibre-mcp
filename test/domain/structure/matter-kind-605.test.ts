// #605: one matter kind per chunk (front, body, back_index, back_biblio, back_other) from a pure
// classifier over the chunk text and its position in the book; the prose guard keeps real prose
// out of the strong kinds, and strong vs weak decides how search ranks the chunk.

import { describe, expect, it } from "vitest";
import { carriesProse, classifyChunk, isStrongMatter, matterKinds } from "../../../src/domain/structure/matter-kind.js";
import { isBibliographyTitle, isIndexTitle } from "../../../src/domain/structure/front-matter-titles.js";

const INDEX_PAGE = [
  "Index",
  "A",
  "abstraction, 12, 45",
  "agents, 101-105",
  "attention 289-292",
  "B",
  "batching, 77",
  "bm25, 130, 131",
  "C",
  "chunking, 54, 56, 60",
  "cosine similarity 88",
  "cross-encoder, 140–142",
  "D",
  "dense retrieval, 33",
].join("\n");

// Same entries without any comma before the locator.
const COMMALESS_INDEX = [
  "abstraction 12",
  "agents 101-105",
  "attention 289-292",
  "batching 77",
  "bm25 130",
  "chunking 54",
  "cosine similarity 88",
  "cross-encoder 140",
  "dense retrieval 33",
].join("\n");

const REFERENCES = [
  "Lewis, P., Perez, E., et al. (2020). Retrieval-augmented generation for NLP. NeurIPS, pp. 9459-9474.",
  "Karpukhin, V., et al. (2020). Dense passage retrieval for open-domain QA. arXiv:2004.04906.",
  "Robertson, S. and Zaragoza, H. (2009). The probabilistic relevance framework. doi:10.1561/1500000019.",
  "Manning, C., Raghavan, P. and Schütze, H. (2008). Introduction to Information Retrieval. pp. 1-482.",
  "Devlin, J., et al. (2019). BERT: pre-training of deep bidirectional transformers. arXiv:1810.04805.",
  "Some trailing remark about the list above that carries no citation at all.",
].join("\n");

const COPYRIGHT = [
  "Copyright © 2024 Example Press. All rights reserved.",
  "ISBN 978-1-234-56789-0",
  "Printed in the United States of America.",
].join("\n");

// pdftotext shape: dot leaders run the entry lines past 60 characters.
const TOC = [
  "Contents",
  "Preface ................................................................ xi",
  "1. Retrieval Basics ......................................................... 1",
  "   What Is a Query? ......................................................... 3",
  "   Inverted Indexes ......................................................... 9",
  "2. Dense Retrieval .......................................................... 21",
  "   Embedding Models ......................................................... 24",
  "   Vector Search at Scale ................................................... 37",
  "3. Rerankers ................................................................ 45",
].join("\n");

const PREFACE = [
  "Preface",
  "This book grew out of a series of workshops on retrieval systems that we ran for",
  "engineers who had shipped a chatbot and then watched it answer confidently from the",
  "wrong documents. We wanted a practical guide that starts from the failure cases and",
  "works back to the design decisions that prevent them, with code you can run locally.",
].join("\n");

const at = (position: number, inFront = false, heading?: string) => ({
  position,
  inFront,
  ...(heading ? { heading } : {}),
});

describe("classifyChunk (#605)", () => {
  it("an index page past 0.85 is back_index; the same page at 0.5 is body", () => {
    expect([classifyChunk(INDEX_PAGE, at(0.9)), classifyChunk(INDEX_PAGE, at(0.5))]).toEqual(["back_index", "body"]);
  });

  it("comma-less locator lines count like comma ones", () => {
    expect(classifyChunk(COMMALESS_INDEX, at(0.95))).toBe("back_index");
  });

  it("fewer than 8 non-empty lines are no index by density, but are under an Index heading", () => {
    const short = "abstraction, 12\nagents, 101\nattention, 289";
    expect([classifyChunk(short, at(0.95)), classifyChunk(short, at(0.95, false, "Index"))]).toEqual([
      "body",
      "back_index",
    ]);
  });

  it("an Index heading does not override the prose guard", () => {
    expect(classifyChunk(PREFACE, at(0.95, false, "Index"))).toBe("body");
  });

  it("a bibliography under a heading line at 0.4 is back_biblio", () => {
    expect(classifyChunk(`References\n${REFERENCES}`, at(0.4))).toBe("back_biblio");
  });

  it("a bibliography under a Bibliography chapter heading at 0.4 is back_biblio", () => {
    expect(classifyChunk(REFERENCES, at(0.4, false, "Bibliography"))).toBe("back_biblio");
  });

  it("a citation-dense chunk without a heading is body at 0.5 and back_biblio at 0.9", () => {
    expect([classifyChunk(REFERENCES, at(0.5)), classifyChunk(REFERENCES, at(0.9))]).toEqual(["body", "back_biblio"]);
  });

  it("fewer than 4 citation lines never make a bibliography", () => {
    const three = REFERENCES.split("\n").slice(0, 3).join("\n");
    expect(classifyChunk(three, at(0.95))).toBe("body");
  });

  it("a copyright page in the first 10% or after 0.85 is back_other, mid-book it is body", () => {
    expect([
      classifyChunk(COPYRIGHT, at(0.05)),
      classifyChunk(COPYRIGHT, at(0.95)),
      classifyChunk(COPYRIGHT, at(0.5)),
    ]).toEqual(["back_other", "back_other", "body"]);
  });

  it("a chunk in the front region is front whatever else matches", () => {
    expect([INDEX_PAGE, COPYRIGHT, REFERENCES, PREFACE].map((t) => classifyChunk(t, at(0.01, true)))).toEqual([
      "front",
      "front",
      "front",
      "front",
    ]);
  });
});

describe("carriesProse (#605)", () => {
  it("a pdftotext table of contents with dot leaders carries no prose", () => {
    expect(carriesProse(TOC)).toBe(false);
  });

  it("a preface paragraph carries prose", () => {
    expect(carriesProse(PREFACE)).toBe(true);
  });

  it("an index page carries no prose", () => {
    expect(carriesProse(INDEX_PAGE)).toBe(false);
  });
});

describe("isStrongMatter (#605)", () => {
  it("index, copyright/ads and prose-less front are strong; bibliography, prose front and body are not", () => {
    expect([
      isStrongMatter("back_index", INDEX_PAGE),
      isStrongMatter("back_other", COPYRIGHT),
      isStrongMatter("front", TOC),
      isStrongMatter("back_biblio", REFERENCES),
      isStrongMatter("front", PREFACE),
      isStrongMatter("body", TOC),
    ]).toEqual([true, true, true, false, false, false]);
  });
});

describe("heading words (#605)", () => {
  it("index and bibliography headings, EN + RU/UK, normalised", () => {
    expect(["Index", "INDEX", "Указатель", "Предметный указатель"].every(isIndexTitle)).toBe(true);
    expect(["Bibliography", "References", "Литература", "Список літератури"].every(isBibliographyTitle)).toBe(true);
    expect([isIndexTitle("Indexing Strategies"), isBibliographyTitle("Reference Architecture")]).toEqual([
      false,
      false,
    ]);
  });
});

describe("matterKinds over a whole book (#605)", () => {
  // Structural headings: the Index heading is a chapter-map span of its own.
  const filler = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `Body sentence ${i} explains retrieval in plain prose for the reader here.`,
    ).join("\n");
  const text = [
    "Getting Started",
    "===============",
    filler(60),
    "",
    "Going Deeper",
    "============",
    filler(60),
    "",
    "Index",
    "=====",
    "abstraction, 12",
    "agents, 101",
    "attention, 289",
  ].join("\n");
  const indexAt = text.indexOf("Index\n=====");
  const spans = [
    { charStart: 0, charEnd: 2000 },
    { charStart: 2000, charEnd: indexAt },
    { charStart: indexAt, charEnd: text.length },
  ];

  it("labels each span; the index span gets back_index through its chapter heading", () => {
    expect(matterKinds(text, spans)).toEqual(["body", "body", "back_index"]);
  });

  it("an empty text or no spans gives no kinds", () => {
    expect([matterKinds("", []), matterKinds(text, [])]).toEqual([[], []]);
  });
});

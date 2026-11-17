// #605, Artem's decision after the fmt-02 STOP: front matter that holds a contents block is
// strong even when praise quotes or a foreword around it read as prose; a preface or foreword
// without one stays weak and competes on its rerank score.

import { describe, expect, it } from "vitest";
import { isStrongMatter } from "../../../src/domain/structure/matter-kind.js";

// Praise quotes, a contents block with dot leaders, then the opening of a foreword: one chunk.
const PRAISE_CONTENTS_FOREWORD = [
  "Praise for Practical Search Engineering",
  "",
  '"A clear, hands-on account of ranking that any engineer on a search team can put',
  'to work on Monday. The evaluation chapters alone justify the purchase price."',
  "— A Grateful Practitioner",
  "",
  '"I have read many books about relevance, and none of them explains query parsing,',
  'scoring and evaluation with this much patience and this many worked examples."',
  "— A Satisfied Reader",
  "",
  "Contents",
  "",
  "Chapter 1: Tokens and Terms ............................. 1",
  "Chapter 2: Scoring with BM25 ............................ 23",
  "Chapter 3: Learning to Rank ............................. 51",
  "Chapter 4: Measuring Relevance .......................... 77",
  "",
  "Foreword",
  "",
  "When I first saw the outline of this book I doubted that another treatment of",
  "ranking was needed. Having read the manuscript, I no longer doubt it at all.",
].join("\n");

// An EPUB navigation export: a heading and bare titles, no page numbers, no chapter keyword.
const EPUB_CONTENTS = [
  "Table of Contents",
  "Getting Started with Rust Ownership",
  "Borrowing, References and Lifetimes",
  "Structs, Enums and Pattern Matching",
  "Error Handling Without Exceptions",
  "Fearless Concurrency in Practice",
].join("\n");

// A plain preface (the book-888 shape): prose paragraphs, a chapter overview written as prose.
const PREFACE = [
  "Preface",
  "",
  "Retrieval-augmented generation lets a language model answer from your own documents",
  "instead of from whatever it memorised during training. This book shows how to build",
  "such a system step by step, from loading documents to evaluating the answers.",
  "",
  "What this book covers",
  "",
  "Chapter 1, Why Retrieval Matters, explains the failure modes of a model that answers",
  "from memory alone and what retrieval changes about them.",
  "Chapter 2, Loading and Splitting Documents, walks through parsers and chunk sizes and",
  "shows how both decisions show up later in the quality of the answers.",
].join("\n");

// A foreword whose wrapped prose lines happen to start with the word "chapter".
const FOREWORD_MENTIONS_CHAPTERS = [
  "Foreword",
  "",
  "I first met the author at a conference where she presented what became the third",
  "chapter of this book, and the room went quiet in the way it does when people realise",
  "chapter and verse of their own production incidents are being described on stage.",
  "Part of what makes the book work is that every claim comes with a measurement, and",
  "chapter after chapter the measurements are honest about what did not work as well.",
].join("\n");

describe("a contents block makes front matter strong (#605, Artem's decision)", () => {
  it("praise quotes + a dot-leader contents block + a foreword opening is strong", () => {
    expect(isStrongMatter("front", PRAISE_CONTENTS_FOREWORD)).toBe(true);
  });

  it("an EPUB contents list under a contents heading, without page numbers, is strong", () => {
    expect(isStrongMatter("front", EPUB_CONTENTS)).toBe(true);
  });

  it("a preface with a prose chapter overview stays weak", () => {
    expect(isStrongMatter("front", PREFACE)).toBe(false);
  });

  it("a foreword that mentions chapters in prose stays weak", () => {
    expect(isStrongMatter("front", FOREWORD_MENTIONS_CHAPTERS)).toBe(false);
  });

  it("a contents block never makes a body chunk strong", () => {
    expect(isStrongMatter("body", PRAISE_CONTENTS_FOREWORD)).toBe(false);
  });
});

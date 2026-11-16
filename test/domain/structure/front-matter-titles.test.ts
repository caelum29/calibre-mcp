// #625: one front-matter title list for the heading rule and the outline/TOC picker, one
// normalisation (NFKC, lowercase, non-letter/digit runs → one space).

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFrontMatterTitle } from "../../../src/domain/structure/front-matter-titles.js";

describe("isFrontMatterTitle — merged list", () => {
  it("accepts titles that only the heading list had", () => {
    const only = [
      "Using Code Examples",
      "Colophon",
      "Errata",
      "How to Contact Us",
      "Why subscribe?",
      "Revision History",
    ];
    expect(only.filter((t) => !isFrontMatterTitle(t))).toEqual([]);
  });

  it("accepts titles that only the outline list had", () => {
    const only = ["Cover", "Title", "List of Figures", "List of Tables", "Обложка", "Титульный лист", "Присвята"];
    expect(only.filter((t) => !isFrontMatterTitle(t))).toEqual([]);
  });

  it("matches punctuated patterns after normalisation", () => {
    const punct = [
      "Author's Note",
      "Author’s note",
      "O'Reilly Online Learning",
      "O’Reilly Safari",
      "Packt.com",
      "www.packtpub.com",
      "What's in this book?",
      "Who is this book for?",
      "liveBook discussion forum",
      "Preface.",
      "CONTENTS:",
    ];
    expect(punct.filter((t) => !isFrontMatterTitle(t))).toEqual([]);
  });

  it("rejects body titles", () => {
    const body = [
      "AI-Powered Search",
      "1 Introducing AI-powered search",
      "Prefaces in Kotlin",
      "Part I",
      "Introduction",
    ];
    expect(body.filter((t) => isFrontMatterTitle(t))).toEqual([]);
  });
});

describe("one front-matter title list under src/domain/structure", () => {
  it("only front-matter-titles.ts carries the list or defines isFrontMatterTitle", () => {
    const dir = new URL("../../../src/domain/structure/", import.meta.url);
    const holders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const src = readFileSync(new URL(f, dir), "utf8");
        return /["'`]brief contents["'`]/.test(src) || /function isFrontMatterTitle\b/.test(src);
      });
    expect(holders).toEqual(["front-matter-titles.ts"]);
  });
});

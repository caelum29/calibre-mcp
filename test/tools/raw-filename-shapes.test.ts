// #558: the shared raw-filename predicate also flags dot slugs, download-site suffixes,
// [source] prefixes, " copy" / " (1)" suffixes and "Kindle img" — and every newly flagged
// shape is recoverable through #549's de-slug path (or still refused when only an id is left).
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ProviderHit } from "../../src/domain/enrich/types.js";
import { runQualityChecks } from "../../src/domain/curation/quality.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

function book(over: Partial<Book> = {}): Book {
  return { id: 1, uuid: "u", title: "", authors: [], identifiers: {}, formats: [], tags: [], languages: [], ...over };
}

/** Deps whose providers record each title query and return `hits`. */
function deps(b: Book, hits: ProviderHit[], seen: string[]): BaseDeps {
  const content = { resolveLibraryId: async () => "Lib", getBook: async () => b };
  const extractor = { getText: async () => ({ text: "", backend: "test", chars: 0, cached: false, markers: [] }) };
  const provider = (name: "openlibrary" | "googlebooks") => ({
    name,
    lookupByIsbn: async () => [],
    searchByTitleAuthor: async (title: string) => {
      seen.push(title);
      return hits;
    },
  });
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: extractor as unknown as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    providers: { openlibrary: provider("openlibrary"), googlebooks: provider("googlebooks") },
    log,
  };
}

const flagged = (title: string) => runQualityChecks([book({ title })], ["raw_filename_title"]).map((i) => i.check);
const hits: ProviderHit[] = [{ source: "openlibrary", confidence: 0.6, title: "Some Real Title", publisher: "P" }];
const text = (r: { content: Array<{ type: string }> }) => (r.content[0] as unknown as { text: string }).text;

// [raw title, the title query recover_metadata must search]. The first four are books
// 1080, 470, 1325 and 863 from the acceptance pass.
const RECOVERABLE: Array<[string, string]> = [
  ["building.large.language.models.from.scratch", "building large language models from scratch"],
  ["1233 2 PostgreSQL MADE EASY Kindle img", "PostgreSQL MADE EASY"],
  ["Bayesian Methods for Hackers - PDFDrive.com", "Bayesian Methods for Hackers"],
  ["[LeanPub] Software Engineering - The Soft Parts copy", "Software Engineering - The Soft Parts"],
  ["Designing Data-Intensive Applications (z-lib.org)", "Designing Data-Intensive Applications"],
  ["Effective Java - libgen.li", "Effective Java"],
  ["The Pragmatic Programmer copy 2", "The Pragmatic Programmer"],
  ["Clean Code (1)", "Clean Code"],
];

describe("raw_filename_title widened shapes (#558)", () => {
  it.each(RECOVERABLE)("flags %j and recover_metadata searches %j at capped confidence", async (raw, query) => {
    expect(flagged(raw)).toEqual(["raw_filename_title"]);

    const seen: string[] = [];
    const r = await recoverMetadataTool.handler({ id: 1 }, deps(book({ title: raw }), hits, seen));
    expect(r.isError).toBeFalsy();
    expect(seen[0]).toBe(query);
    expect(r.structuredContent?.lookupKey).toBe(`title:${query}`);
    expect(r.structuredContent?.confidence).toBe(0.4);
    expect(r.structuredContent?.warnings).toEqual([
      `title query "${query}" was derived from the filename-like title "${raw}"; verify the match before applying`,
    ]);
    expect(text(r)).toContain("(confidence 0.40)");
  });

  it.each(["795731065 copy", "[LeanPub] B0CZS7H23N", "215479-01 - PDFDrive.com"])(
    "flags %j but still refuses it: only an identifier is left",
    async (raw) => {
      expect(flagged(raw)).toEqual(["raw_filename_title"]);
      const seen: string[] = [];
      const r = await recoverMetadataTool.handler({ id: 1 }, deps(book({ title: raw }), hits, seen));
      expect(r.isError).toBe(true);
      expect(text(r)).toContain(`its title "${raw}" looks like a raw filename`);
      expect(seen).toEqual([]);
    },
  );

  it.each([
    "Node.js in Action",
    "C++ Primer",
    "Site Reliability Engineering - 2nd ed",
    "Self-Hosting",
    "Docker-Deep-Dive",
    "ASP.NET Core in Action",
    "Vue.js 3 By Example",
    "[Re]Thinking Design",
    "Advertising Copy",
    "Kindle Fire for Dummies",
    "Dive Into Python 3",
  ])("leaves the real title %j unflagged and searches it as-is", async (raw) => {
    expect(flagged(raw)).toEqual([]);
    const seen: string[] = [];
    // the provider agrees on the title, so no #198 mismatch warning muddies the check
    const same: ProviderHit[] = [{ source: "openlibrary", confidence: 0.6, title: raw, publisher: "P" }];
    const r = await recoverMetadataTool.handler({ id: 1 }, deps(book({ title: raw }), same, seen));
    expect(r.isError).toBeFalsy();
    expect(seen[0]).toBe(raw);
    expect(r.structuredContent?.lookupKey).toBe(`title:${raw}`);
    expect(r.structuredContent?.warnings).toEqual([]);
  });
});

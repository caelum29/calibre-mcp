// #549: slug-shaped titles that quality_report flags get a de-slugged title lookup in
// calibre_recover_metadata (flagged as lower confidence); bare identifiers are still refused.
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

interface Seen {
  titles: Array<{ title: string; author: string | undefined }>;
}

/** Deps whose providers record the title query they were asked for and return `hits`. */
function deps(b: Book, hits: ProviderHit[], seen: Seen): BaseDeps {
  const content = { resolveLibraryId: async () => "Lib", getBook: async () => b };
  const extractor = { getText: async () => ({ text: "", backend: "test", chars: 0, cached: false, markers: [] }) };
  const provider = (name: "openlibrary" | "googlebooks") => ({
    name,
    lookupByIsbn: async () => [],
    searchByTitleAuthor: async (title: string, author?: string) => {
      seen.titles.push({ title, author });
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

const text = (r: { content: Array<{ type: string }> }) => (r.content[0] as unknown as { text: string }).text;

// Real titles of books 1370, 1229 and 595 from the acceptance pass.
const SLUGS: Array<[string, string]> = [
  ["modular-monoliths", "modular monoliths"],
  ["functional-design-and-architecture", "functional design and architecture"],
  [
    "Microsoft Word - OWASP Top 10 for Agentic Applications 2026 12.6.docx",
    "OWASP Top 10 for Agentic Applications 2026 12.6",
  ],
  ["domain_driven_design_distilled", "domain driven design distilled"],
];

describe("calibre_recover_metadata — slug titles (#549)", () => {
  it.each(SLUGS)("looks up %j as the title query %j, flagged lower confidence", async (raw, query) => {
    const seen: Seen = { titles: [] };
    const hits: ProviderHit[] = [{ source: "openlibrary", confidence: 0.6, title: "Some Real Title", publisher: "P" }];
    const r = await recoverMetadataTool.handler(
      { id: 1 },
      deps(book({ title: raw, authors: ["Unknown"] }), hits, seen),
    );

    expect(r.isError).toBeFalsy();
    expect(seen.titles[0]).toEqual({ title: query, author: undefined });
    expect(r.structuredContent?.lookupKey).toBe(`title:${query}`);
    // lower confidence: capped below the provider's own title-search score, in both channels
    expect(r.structuredContent?.confidence).toBe(0.4);
    const warnings = r.structuredContent?.warnings as string[];
    expect(warnings).toEqual([
      `title query "${query}" was derived from the filename-like title "${raw}"; verify the match before applying`,
    ]);
    expect(text(r)).toContain("(confidence 0.40)");
    expect(text(r)).toContain(`WARNING ${warnings[0]}`);
  });

  it.each(["795731065", "B0CZS7H23N", "215479-01", "top.dvi"])("still refuses the identifier title %j", async (raw) => {
    const seen: Seen = { titles: [] };
    const r = await recoverMetadataTool.handler({ id: 1 }, deps(book({ title: raw }), [], seen));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nothing to look up for book 1: no ISBN");
    expect(text(r)).toContain(`its title "${raw}" looks like a raw filename`);
    expect(seen.titles).toEqual([]);
  });

  it.each(["Node.js in Action", "C++ Primer", "Site Reliability Engineering - 2nd ed"])(
    "leaves the real title %j unflagged",
    async (raw) => {
      const seen: Seen = { titles: [] };
      const hits: ProviderHit[] = [{ source: "openlibrary", confidence: 0.6, title: raw, publisher: "P" }];
      const r = await recoverMetadataTool.handler({ id: 1 }, deps(book({ title: raw }), hits, seen));
      expect(r.isError).toBeFalsy();
      expect(seen.titles[0]).toEqual({ title: raw, author: undefined });
      expect(r.structuredContent?.lookupKey).toBe(`title:${raw}`);
      expect(r.structuredContent?.confidence).toBe(0.6);
      expect(r.structuredContent?.warnings).toEqual([]);
    },
  );

  // quality_report's raw_filename_title hint steers to recover_metadata: it must act on a slug.
  it("agrees with quality_report: a flagged slug is looked up, a flagged identifier is refused", async () => {
    const slug = book({ id: 1370, title: "modular-monoliths" });
    const ident = book({ id: 2, title: "795731065" });
    expect(runQualityChecks([slug, ident], ["raw_filename_title"]).map((i) => i.bookId)).toEqual([1370, 2]);

    const hits: ProviderHit[] = [
      { source: "openlibrary", confidence: 0.6, title: "Modular Monoliths", publisher: "P" },
    ];
    const onSlug = await recoverMetadataTool.handler({ id: 1370 }, deps(slug, hits, { titles: [] }));
    expect(onSlug.isError).toBeFalsy();
    const onIdent = await recoverMetadataTool.handler({ id: 2 }, deps(ident, hits, { titles: [] }));
    expect(onIdent.isError).toBe(true);
  });
});

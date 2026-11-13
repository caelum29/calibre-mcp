// #593: when the ISBN lookup finds nothing on every provider, calibre_recover_metadata falls back
// to a title(+author) query on the same providers and says which query matched.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import type { ProviderHit } from "../../src/domain/enrich/types.js";
import { recoverMetadataTool } from "../../src/tools/calibre_recover_metadata.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";

const ISBN = "9798868822964";
const TITLE = "Building Large Language Models from Scratch";

const book: Book = {
  id: 1080,
  uuid: "u",
  title: TITLE,
  authors: ["Sebastian Raschka"],
  identifiers: { isbn: ISBN },
  formats: [],
  tags: [],
  languages: [],
};

/** Providers know the title (when `titleHits` is non-empty) but never the ISBN. */
function deps(titleHits: ProviderHit[], calls: string[]): BaseDeps {
  const provider = (name: "openlibrary" | "googlebooks") => ({
    name,
    lookupByIsbn: async (isbn: string) => {
      calls.push(`${name}:isbn:${isbn}`);
      return [];
    },
    searchByTitleAuthor: async (title: string, author?: string) => {
      calls.push(`${name}:title:${title}/${author}`);
      return titleHits;
    },
  });
  return {
    config: loadConfig({}),
    content: { resolveLibraryId: async () => "Lib", getBook: async () => book } as unknown as ToolDeps["content"],
    calibre: {} as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    providers: { openlibrary: provider("openlibrary"), googlebooks: provider("googlebooks") },
    log,
  };
}

const text = (r: { content: Array<{ type: string }> }) => (r.content[0] as unknown as { text: string }).text;

describe("calibre_recover_metadata — ISBN miss falls back to title (#593)", () => {
  it("matches by title after the ISBN finds nothing and names both queries", async () => {
    const calls: string[] = [];
    const hits: ProviderHit[] = [{ source: "openlibrary", confidence: 0.6, title: TITLE, publisher: "Manning" }];
    const r = await recoverMetadataTool.handler({ id: 1080 }, deps(hits, calls));

    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([
      `openlibrary:isbn:${ISBN}`,
      `googlebooks:isbn:${ISBN}`,
      `openlibrary:title:${TITLE}/Sebastian Raschka`,
    ]);
    expect(r.structuredContent?.lookupKey).toBe(`title:${TITLE} / Sebastian Raschka`);
    expect(r.structuredContent?.warnings).toContain(`isbn:${ISBN} found nothing; matched by title`);
    expect(text(r)).toContain(`WARNING isbn:${ISBN} found nothing; matched by title`);
  });

  it("returns not_found naming both queries when neither ISBN nor title match", async () => {
    const r = await recoverMetadataTool.handler({ id: 1080 }, deps([], []));

    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`isbn:${ISBN}`);
    expect(text(r)).toContain(`title:${TITLE} / Sebastian Raschka`);
    expect(text(r)).toContain("not_found");
  });
});

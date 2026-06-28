import { describe, it, expect } from "vitest";
import { buildFtsArgs, parseFtsResults } from "../../src/calibre/client.js";

describe("buildFtsArgs", () => {
  it("emits json output and puts the query last", () => {
    expect(buildFtsArgs("rust")).toEqual(["fts_search", "--output-format=json", "rust"]);
  });
  it("adds snippet markers and restrict-to ids", () => {
    const args = buildFtsArgs("rust", {
      snippets: true,
      matchStartMarker: ">>",
      matchEndMarker: "<<",
      restrictToIds: [658, 704],
    });
    expect(args).toContain("--include-snippets");
    expect(args).toContain("--match-start-marker=>>");
    expect(args).toContain("--restrict-to=ids:658,704");
    expect(args[args.length - 1]).toBe("rust");
  });
});

describe("parseFtsResults", () => {
  it("strips the leading 'Integration status' line before the JSON", () => {
    const stdout = 'Integration status: False\n[{"book_id": 776, "format": "PDF"}]';
    const hits = parseFtsResults(stdout);
    expect(hits).toEqual([{ bookId: 776, snippet: undefined, format: "pdf" }]);
  });
  it("prefers snippet, falls back to text", () => {
    const stdout = '[{"book_id": 1, "text": "…match…"}]';
    expect(parseFtsResults(stdout)[0]?.snippet).toBe("…match…");
  });
  it("treats no array (zero hits) as empty", () => {
    expect(parseFtsResults("Integration status: False\n")).toEqual([]);
  });
  it("throws on malformed JSON after the bracket", () => {
    expect(() => parseFtsResults("[not json")).toThrow();
  });
});

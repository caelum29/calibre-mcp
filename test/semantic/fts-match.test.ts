// MATCH builder of the keyword half (#634): the query's stems OR-ed as before, plus every
// identifier-like raw token (c++, c#, node.js) as "t" and "t." so it reaches the raw body column.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ftsMatch } from "../../src/semantic/store/shared.js";

describe("ftsMatch (#634)", () => {
  it("adds an identifier-like token in its raw and sentence-final forms after the stems", () => {
    expect(ftsMatch("c++ templates")).toBe('"c" OR "templat" OR "c++" OR "c++."');
  });

  it("strips trailing periods from a query-final identifier before adding both forms", () => {
    expect(ftsMatch("streams in node.js.")).toBe('"stream" OR "in" OR "node" OR "js" OR "node.js" OR "node.js."');
  });

  it("emits a repeated identifier once, case-folded", () => {
    expect(ftsMatch("C# and c# again")).toBe('"c" OR "and" OR "c" OR "again" OR "c#" OR "c#."');
  });

  it("keeps the query's double quotes out of the phrases, so the MATCH stays valid FTS5 syntax", () => {
    const match = ftsMatch('"c++" say "hi"');
    expect(match).toBe('"c" OR "say" OR "hi" OR "c++" OR "c++."');
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.''')");
    db.prepare("INSERT INTO t(body) VALUES (?)").run("modern c++ code");
    expect(db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH ?").get(match)).toEqual({ n: 1 });
    db.close();
  });

  it("treats leading-dot, versioned and hyphenated tokens as identifiers", () => {
    expect(ftsMatch(".net utf-8 v2.0")).toBe(
      '"net" OR "utf" OR "8" OR "v2" OR "0" OR ".net" OR ".net." OR "utf-8" OR "utf-8." OR "v2.0" OR "v2.0."',
    );
  });

  it("returns null for punctuation-only input", () => {
    expect(ftsMatch("+++ ... -- #")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(ftsMatch("   ")).toBeNull();
  });

  // Strings below are what ftsMatch(stemText(q)) returned on main before #634: a query with no
  // identifier-like token must keep its exact MATCH, so its ranking and latency don't move.
  it.each([
    ["how does the raft consensus work", '"how" OR "doe" OR "the" OR "raft" OR "consensus" OR "work"'],
    ["Как работает репликация в PostgreSQL?", '"как" OR "работа" OR "репликац" OR "в" OR "postgresql"'],
    ["snake_case __init__ camelCase v2", '"snake_case" OR "__init__" OR "camelcase" OR "v2"'],
  ])("leaves a query without identifier-like tokens unchanged: %s", (query, before) => {
    expect(ftsMatch(query)).toBe(before);
  });
});

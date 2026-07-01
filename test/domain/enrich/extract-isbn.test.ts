import { describe, expect, it } from "vitest";
import { extractIsbns } from "../../../src/domain/enrich/extract-isbn.js";

describe("extractIsbns", () => {
  it("finds a labeled ISBN-13 with hyphens", () => {
    expect(extractIsbns("Foo\nISBN-13: 978-0-306-40615-7\nBar")).toEqual(["9780306406157"]);
  });

  it("finds a labeled ISBN-10 (incl. X) and normalizes it", () => {
    expect(extractIsbns("ISBN: 1-55860-832-X")).toEqual(["155860832X"]);
  });

  it("finds a bare 13-digit ISBN without a label", () => {
    expect(extractIsbns("published 9780306406157 by someone")).toContain("9780306406157");
  });

  it("rejects digit runs that fail the checksum", () => {
    // 9780306406158 has a bad EAN check digit; 1234567890 is not a valid ISBN-10.
    expect(extractIsbns("ISBN 9780306406158 and 1234567890 here")).toEqual([]);
  });

  it("dedupes and ranks labeled before bare, honoring the limit", () => {
    const text = "9780306406157 ... ISBN: 0-306-40615-2 ... 9780306406157";
    const out = extractIsbns(text, 5);
    expect(out).toEqual(["0306406152", "9780306406157"]); // labeled first, then bare, no dupes
    expect(extractIsbns(text, 1)).toHaveLength(1);
  });
});

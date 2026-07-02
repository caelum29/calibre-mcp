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

  it("prefers ISBN-13 over ISBN-10 when both are labeled", () => {
    const text = "ISBN-10: 0-306-40615-2\nISBN-13: 978-0-306-40615-7";
    expect(extractIsbns(text)[0]).toBe("9780306406157");
  });

  it("rejects all-same-digit runs that fool the ISBN-10 checksum", () => {
    // 1111111111 and 0000000000 both satisfy Σ i·dᵢ ≡ 0 (mod 11) but are never real ISBNs.
    expect(extractIsbns("ISBN 1111111111 or 0000000000")).toEqual([]);
  });

  it("rejects a 13-digit run without a Bookland prefix (977/978/979)", () => {
    // 1234567890128 has a valid EAN-13 check digit but is not an ISBN (prefix 123).
    expect(extractIsbns("barcode 1234567890128 here")).toEqual([]);
  });
});

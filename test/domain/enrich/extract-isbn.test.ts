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

  it("honors a restricted prefix set (excludes an otherwise-valid 978 ISBN)", () => {
    // 9780306406157 is a valid ISBN-13, but 978 is not in the allowed set here.
    expect(extractIsbns("ISBN 978-0-306-40615-7", 5, { prefixes: ["979"] })).toEqual([]);
    expect(extractIsbns("ISBN 978-0-306-40615-7", 5, { prefixes: ["978", "979"] })).toEqual(["9780306406157"]);
  });

  it("admits a configured non-default prefix (e.g. a future GS1 980 block)", () => {
    // 9800000000007 has a valid EAN-13 check digit; prefix 980 is not Bookland-default.
    expect(extractIsbns("ISBN 980-0-000-00000-7")).toEqual([]);
    expect(extractIsbns("ISBN 980-0-000-00000-7", 5, { prefixes: ["980"] })).toEqual(["9800000000007"]);
  });

  it("labeledOnly keeps tagged ISBNs and skips bare digit runs", () => {
    expect(extractIsbns("published 9780306406157 by someone", 5, { labeledOnly: true })).toEqual([]);
    expect(extractIsbns("ISBN: 978-0-306-40615-7", 5, { labeledOnly: true })).toEqual(["9780306406157"]);
  });
});

// #198: Pragmatic Bookshelf PDFs end with "You May Be Interested In…" ad pages that list other
// titles' ISBNs; those must never be taken as the book's own ISBN.
describe("extractIsbns — ad/catalog listings (#198)", () => {
  const AD = "You May Be Interested In…\nA Common-Sense Guide to Data Structures and Algorithms\nJay Wengrow\n";

  it("skips an ISBN in a '(NNN pages) ISBN: … $NN' ad entry", () => {
    expect(extractIsbns(`${AD}(218 pages) ISBN: 9781680502442 $45.95\n`)).toEqual([]);
  });

  it("skips the ad ISBN in labeledOnly mode too", () => {
    expect(extractIsbns(`${AD}(218 pages) ISBN: 9781680502442 $45.95`, 5, { labeledOnly: true })).toEqual([]);
  });

  it("keeps the book's own ISBN when ad entries follow it", () => {
    const text = `Copyright page\nISBN-13: 978-0-306-40615-7\n...\n${AD}(218 pages) ISBN: 9781680502442 $45.95`;
    expect(extractIsbns(text)).toEqual(["9780306406157"]);
  });

  it("skips several price-tagged ISBNs listed close together (catalog page)", () => {
    const text =
      "More from us\nSome Book\nISBN: 978-1-68050-635-8 $39.95\n" + "Another Book\nISBN: 978-1-61729-454-9 $49.99\n";
    expect(extractIsbns(text)).toEqual([]);
  });

  it("keeps a single price-tagged ISBN (a back cover, not a catalog)", () => {
    expect(extractIsbns("ISBN: 978-0-306-40615-7 $39.99")).toEqual(["9780306406157"]);
  });

  it("keeps a back-cover ISBN printed after the price", () => {
    expect(extractIsbns("US $59.99 CAN $74.99\nISBN: 978-0-306-40615-7")).toEqual(["9780306406157"]);
  });

  it("keeps print + ebook ISBNs of a copyright page (no prices, no page counts)", () => {
    const text = "ISBN 978-0-306-40615-7 (paperback)\nISBN 978-1-68050-635-8 (ebook)";
    expect(extractIsbns(text)).toEqual(["9780306406157", "9781680506358"]);
  });

  it("does not treat a page count far before the ISBN as an ad entry", () => {
    const text = `Printed book (300 pages).${" filler".repeat(40)}\nISBN: 978-0-306-40615-7`;
    expect(extractIsbns(text)).toEqual(["9780306406157"]);
  });
});

describe("extractIsbns — ad/catalog edge cases (#198)", () => {
  it("skips an ad entry that starts the scanned text", () => {
    expect(extractIsbns("(218 pages) ISBN: 9781680502442 $45.95")).toEqual([]);
  });

  it("ignores a page count on the previous line (same-line ad entries only)", () => {
    expect(extractIsbns("Hardcover (300 pages)\nISBN: 978-0-306-40615-7")).toEqual(["9780306406157"]);
  });

  it("detects a catalog page deep inside a long text (ads sit at the end of a book)", () => {
    const text =
      `${"x".repeat(5000)}\nSome Book\nISBN: 978-1-68050-635-8 $39.95\n` +
      "Another Book\nISBN: 978-1-61729-454-9 $49.99\n";
    expect(extractIsbns(text)).toEqual([]);
  });

  it("keeps price-tagged ISBNs that are far apart (not one catalog page)", () => {
    const text = `ISBN: 978-0-306-40615-7 $39.99\n${"x".repeat(3000)}\nISBN: 978-1-68050-635-8 $45.95`;
    expect(extractIsbns(text)).toEqual(["9780306406157", "9781680506358"]);
  });
});

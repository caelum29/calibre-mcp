import { describe, it, expect } from "vitest";
import {
  anchorSpineDocs,
  type EpubToc,
  epubTocChapters,
  parseNavToc,
  parseNcxToc,
  parseOpfTocRefs,
  pickToc,
  type SpineHtml,
} from "../../../src/domain/structure/epub-toc.js";
import { chapterNumber, detectChapters } from "../../../src/domain/structure/chapters.js";

// Shapes mirror real library EPUBs probed for #135: an O'Reilly book re-packaged by Calibre
// (NCX only, `_split_NNN` docs), a Packt book (nav + NCX), and RU books whose TOC nests
// "Глава N" under "Раздел N" wrappers.

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="Text/ch%201.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`;

const NAV = `<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="landmarks"><ol><li><a href="Text/cover.xhtml">Cover</a></li></ol></nav>
<nav epub:type="toc" id="toc"><h1>Contents</h1>
<ol>
  <li><a href="Text/preface.xhtml">Preface</a></li>
  <li><a href="Text/ch1.xhtml">Chapter 1. <em>Getting</em> Started</a>
    <ol>
      <li><a href="Text/ch1.xhtml#install">Installing &amp; Running</a></li>
    </ol>
  </li>
  <li><a href="Text/ch2.xhtml">Chapter 2. Going Further</a></li>
  <li><a href="https://example.com">External</a></li>
</ol>
</nav></body></html>`;

const NCX = `<?xml version='1.0' encoding='utf-8'?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:depth" content="2"/></head>
  <docTitle><text>Book</text></docTitle>
  <navMap>
    <navPoint id="p1" playOrder="1">
      <navLabel><text>Раздел I. Понтийский фронтир</text></navLabel>
      <content src="ch1-4.xhtml#id3"/>
      <navPoint id="p2" playOrder="2">
        <navLabel><text>Глава 1. На краю света</text></navLabel>
        <content src="ch1-5.xhtml#id4"/>
      </navPoint>
      <navPoint id="p3" playOrder="3">
        <navLabel><text>Глава 2. Явление славян</text></navLabel>
        <content src="ch1-6.xhtml"/>
      </navPoint>
    </navPoint>
    <navPoint id="p4" playOrder="4">
      <navLabel><text>Эпилог</text></navLabel>
      <content src="ch9.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

const doc = (href: string, body: string): SpineHtml => ({
  href,
  html: `<?xml version="1.0"?><html><head><title>Ignored Title</title><style>p{}</style></head><body>${body}</body></html>`,
});

describe("parseOpfTocRefs", () => {
  it("finds the nav by properties and the NCX by the spine toc id", () => {
    expect(parseOpfTocRefs(OPF, "OEBPS/content.opf")).toEqual({ nav: "OEBPS/nav.xhtml", ncx: "OEBPS/toc.ncx" });
  });

  it("finds an NCX by media type when the spine names no toc", () => {
    const opf = `<manifest><item id="x" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine/>`;
    expect(parseOpfTocRefs(opf, "content.opf")).toEqual({ ncx: "toc.ncx" });
  });
});

describe("parseNavToc", () => {
  const entries = parseNavToc(NAV, "OEBPS/nav.xhtml");

  it("reads the toc nav, not the landmarks nav, with ol-depth levels", () => {
    expect(entries.map((e) => [e.title, e.level])).toEqual([
      ["Preface", 1],
      ["Chapter 1. Getting Started", 1],
      ["Installing & Running", 2],
      ["Chapter 2. Going Further", 1],
    ]);
  });

  it("resolves hrefs against the nav doc and splits off the fragment", () => {
    expect(entries[2]).toMatchObject({ href: "OEBPS/Text/ch1.xhtml", fragment: "install" });
  });

  it("returns [] for markup without a nav", () => {
    expect(parseNavToc("<html><body><p>nothing</p></body></html>", "nav.xhtml")).toEqual([]);
  });
});

describe("parseNcxToc", () => {
  const entries = parseNcxToc(NCX, "OPS/toc.ncx");

  it("reads nested navPoints in document order with nesting levels", () => {
    expect(entries.map((e) => [e.title, e.level])).toEqual([
      ["Раздел I. Понтийский фронтир", 1],
      ["Глава 1. На краю света", 2],
      ["Глава 2. Явление славян", 2],
      ["Эпилог", 1],
    ]);
  });

  it("keeps fragments and resolves srcs against the NCX dir", () => {
    expect(entries[1]).toEqual({ title: "Глава 1. На краю света", level: 2, href: "OPS/ch1-5.xhtml", fragment: "id4" });
  });

  it("tolerates a truncated NCX", () => {
    expect(parseNcxToc(NCX.slice(0, NCX.indexOf("p3")), "toc.ncx")).toHaveLength(2);
  });
});

describe("pickToc", () => {
  it("prefers the nav, falls back to the NCX when the nav is empty", () => {
    const ncx = parseNcxToc(NCX, "toc.ncx");
    expect(pickToc([], ncx)).toBe(ncx);
  });
});

describe("anchorSpineDocs", () => {
  const text = [
    "# Contents",
    "Chapter 1. Getting Started 1",
    "Chapter 2. Going Further 9",
    "",
    "# **Chapter 1. **Getting Started",
    "",
    "Welcome to the book\\! We begin with the very basics of the tool.",
    "",
    "# **Chapter 2. **Going Further",
    "",
    "Now that the basics are done, we go deeper into the advanced parts.",
  ].join("\n");
  const docs = [
    doc("cover.xhtml", `<img src="c.jpg" alt="Cover"/>`),
    doc(
      "ch1.xhtml",
      `<h1><b>Chapter 1. </b>Getting Started</h1><p>Welcome to the book! We begin with the very basics of the tool.</p>`,
    ),
    doc(
      "ch2.xhtml",
      `<h1><b>Chapter 2. </b>Going Further</h1><p>Now that the basics are done, we go deeper into the advanced parts.</p>`,
    ),
  ];

  it("anchors each doc at its heading line despite Markdown escapes and emphasis", () => {
    expect(anchorSpineDocs(text, docs)).toEqual([
      { href: "ch1.xhtml", start: text.indexOf("# **Chapter 1.") },
      { href: "ch2.xhtml", start: text.indexOf("# **Chapter 2.") },
    ]);
  });

  it("is not captured by the TOC lines that repeat the chapter titles", () => {
    expect(anchorSpineDocs(text, docs)[0]!.start).toBeGreaterThan(text.indexOf("Going Further 9"));
  });

  it("skips a doc whose text is not in the extraction", () => {
    const missing = doc("gone.xhtml", "<p>This paragraph was never converted into the text at all.</p>");
    expect(anchorSpineDocs(text, [docs[1]!, missing, docs[2]!]).map((a) => a.href)).toEqual(["ch1.xhtml", "ch2.xhtml"]);
  });

  it("falls back to a later probe when the doc opening differs (figure marker, odd heading)", () => {
    const odd = doc(
      "ch2.xhtml",
      `<h1>Two: A Retitled Heading That The Converter Never Wrote</h1><p>Now that the basics are done, we go deeper into the advanced parts.</p>`,
    );
    expect(anchorSpineDocs(text, [docs[1]!, odd]).map((a) => a.href)).toEqual(["ch1.xhtml", "ch2.xhtml"]);
  });

  it("folds Cyrillic case and NFKC forms", () => {
    const ru = "# ГЛАВА 1. ВВЕДЕНИЕ\n\nДобро пожаловать в книгу о системах контроля версий.";
    const d = doc("ru.xhtml", "<h1>Глава 1. Введение</h1><p>Добро пожаловать в книгу о системах контроля версий.</p>");
    expect(anchorSpineDocs(ru, [d])).toEqual([{ href: "ru.xhtml", start: 0 }]);
  });
});

describe("epubTocChapters", () => {
  const body = (title: string) => `# ${title}\n\n${"Body text for this chapter. ".repeat(20)}\n\n`;
  const text =
    body("Preface") +
    body("Раздел I. Понтийский фронтир") +
    body("Глава 1. На краю света") +
    body("Глава 2. Явление славян") +
    body("Эпилог");
  const at = (s: string) => text.indexOf(`# ${s}`);
  const toc: EpubToc = {
    entries: [{ title: "Preface", level: 1, href: "pre.xhtml" }, ...parseNcxToc(NCX, "toc.ncx")],
    anchors: [
      { href: "pre.xhtml", start: at("Preface") },
      { href: "ch1-4.xhtml", start: at("Раздел I") },
      { href: "ch1-5.xhtml", start: at("Глава 1") },
      { href: "ch1-6.xhtml", start: at("Глава 2") },
      { href: "ch9.xhtml", start: at("Эпилог") },
    ],
  };
  const isChapter = (t: string) => chapterNumber(t) !== null;

  it("drops leading front matter and expands a wrapper whose children are numbered chapters", () => {
    expect(epubTocChapters(text, toc, isChapter)?.map((c) => c.heading)).toEqual([
      "Глава 1. На краю света",
      "Глава 2. Явление славян",
      "Эпилог",
    ]);
  });

  it("expands numbered-chapter wrappers only through the injected chapter test", () => {
    // Five top-level body entries — the "< 4 entries → descend" rule never fires here.
    const kids = (n: number) => [`Глава ${n}. A`, `Глава ${n + 1}. B`].map((title) => ({ title, level: 2 }));
    const tree = [
      { title: "Раздел I", level: 1 },
      ...kids(1),
      { title: "Раздел II", level: 1 },
      ...kids(3),
      ...["Эпилог", "Хронология", "Литература"].map((title) => ({ title, level: 1 })),
    ];
    const entries = tree.map((e, i) => ({ ...e, href: `${i}.xhtml` }));
    const lines = entries.map((e) => `# ${e.title}\n\nbody\n`);
    const t = lines.join("\n");
    const anchors = entries.map((e, i) => ({ href: e.href, start: t.indexOf(lines[i]!) }));
    const headings = (test?: (s: string) => boolean) =>
      epubTocChapters(t, { entries, anchors }, test)?.map((c) => c.heading);
    expect([headings(isChapter)?.length, headings()?.length]).toEqual([7, 5]);
  });

  it("starts each chapter at its doc anchor and ends at the next chapter", () => {
    const ch = epubTocChapters(text, toc, isChapter)!;
    expect(ch.map((c) => [c.startChar, c.endChar])).toEqual([
      [at("Глава 1"), at("Глава 2")],
      [at("Глава 2"), at("Эпилог")],
      [at("Эпилог"), text.length],
    ]);
  });

  it("snaps fragment entries sharing one doc to their own heading lines", () => {
    const one = body("Intro") + body("Alpha Section") + body("Beta Section") + body("Gamma Section");
    const t: EpubToc = {
      entries: ["Alpha Section", "Beta Section", "Gamma Section"].map((title, i) => ({
        title,
        level: 1,
        href: "all.xhtml",
        fragment: `s${i}`,
      })),
      anchors: [
        { href: "all.xhtml", start: 0 },
        { href: "end.xhtml", start: one.length },
      ],
    };
    expect(epubTocChapters(one, t)?.map((c) => c.startChar)).toEqual([
      one.indexOf("# Alpha"),
      one.indexOf("# Beta"),
      one.indexOf("# Gamma"),
    ]);
  });

  it("degrades an unfound fragment to the doc start, de-duplicated against its predecessor", () => {
    const t: EpubToc = {
      entries: [
        { title: "Preface", level: 1, href: "a.xhtml" },
        { title: "Not In The Text", level: 1, href: "a.xhtml", fragment: "x" },
        { title: "Эпилог", level: 1, href: "b.xhtml" },
        { title: "Глава 1. На краю света", level: 1, href: "c.xhtml" },
      ],
      anchors: [
        { href: "a.xhtml", start: at("Раздел I") },
        { href: "c.xhtml", start: at("Глава 1") },
        { href: "b.xhtml", start: at("Эпилог") },
      ],
    };
    // "Preface" is leading front matter; the fragment collapses onto a.xhtml's start and
    // survives as the first chapter; the out-of-order c.xhtml entry is dropped.
    expect(epubTocChapters(text, t)?.map((c) => c.heading)).toEqual(["Not In The Text", "Эпилог"]);
  });

  it("returns null when fewer than two entries resolve to anchored docs", () => {
    expect(epubTocChapters(text, { entries: toc.entries, anchors: toc.anchors.slice(0, 1) })).toBeNull();
  });
});

describe("detectChapters with an EPUB TOC", () => {
  const text = "Chapter 1. One\n\nalpha body\n\nChapter 2. Two\n\nbeta body\n";
  const toc: EpubToc = {
    entries: [
      { title: "One Retitled", level: 1, href: "1.xhtml" },
      { title: "Two Retitled", level: 1, href: "2.xhtml" },
    ],
    anchors: [
      { href: "1.xhtml", start: 0 },
      { href: "2.xhtml", start: text.indexOf("Chapter 2") },
    ],
  };

  it("prefers the TOC over the text heuristics and labels it epub-toc", () => {
    const r = detectChapters(text, { epubToc: toc });
    expect([r.detector, r.chapters.map((c) => c.heading)]).toEqual(["epub-toc", ["One Retitled", "Two Retitled"]]);
  });

  it("falls back to the text heuristics when the TOC is unusable", () => {
    expect(detectChapters(text, { epubToc: { entries: toc.entries, anchors: [] } }).detector).toBe("numeric");
  });
});

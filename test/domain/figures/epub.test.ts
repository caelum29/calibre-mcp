// EPUB figure-scan tests. Markup fixtures mirror the 2026-07-22 library probe:
// O'Reilly (figure > img + h6 caption), Packt (img + p.IMG---Caption, en-dash),
// pandoc (uncaptioned inline equation images).

import { describe, expect, it } from "vitest";
import {
  adjacentCaption,
  buildEpubInventory,
  parseContainerRootfile,
  parseOpfSpine,
  resolveHref,
} from "../../../src/domain/figures/epub.js";

const OREILLY_DOC = {
  href: "text/part0010.html",
  html: `<p class="author1">Some prose before.</p>
<figure class="calibre33"><div class="image1">
<img src="../images/00025.jpeg" alt="Conformist relationship" class="calibre34"/>
<h6 class="calibre35"><span class="calibre">Figure 4-4. </span>Conformist relationship</h6>
</div></figure>
<p class="author1">The downstream team&#8217;s decision follows.</p>`,
};

const PACKT_DOC = {
  href: "OEBPS/B21183_12.xhtml",
  html: `<div><div><span>
<img alt="Figure 12.1 – Logical architecture" src="image/B21183_12_1.0.jpg"/></span> </div> </div>
<p class="IMG---Caption"><span class="koboSpan" id="kobo.53.1">Figure 12.1 – Logical architecture for the autonomous vehicle platform</span></p>
<p><span>In this chapter we build it.</span></p>`,
};

const PANDOC_DOC = {
  href: "OEBPS/Text/chapter-12.html",
  html: `<p>DPO is using gradient ascent <span><img alt="equation image" src="../Images/eq-chapter-12-2-1.png"/></span> to solve the objective.</p>
<p>More prose without any caption.</p>`,
};

describe("buildEpubInventory", () => {
  it("pairs O'Reilly figure/h6 captions across inline spans", () => {
    const inv = buildEpubInventory([OREILLY_DOC]);
    expect(inv.counts.figures).toBe(1);
    expect(inv.entries[0]).toMatchObject({
      page: 1,
      captioned: true,
      label: "4-4",
      caption: "Conformist relationship",
      source: "raster",
      spineHref: "text/part0010.html",
      imageHref: "images/00025.jpeg",
    });
  });

  it("pairs Packt p.IMG---Caption captions with the en-dash separator", () => {
    const inv = buildEpubInventory([PACKT_DOC]);
    expect(inv.counts.figures).toBe(1);
    expect(inv.entries[0]).toMatchObject({
      label: "12.1",
      caption: "Logical architecture for the autonomous vehicle platform",
      imageHref: "OEBPS/image/B21183_12_1.0.jpg",
    });
  });

  it("leaves pandoc equation images uncaptioned (prose after them is not a caption)", () => {
    const inv = buildEpubInventory([PANDOC_DOC]);
    expect(inv.counts.figures).toBe(0);
    expect(inv.counts.uncaptioned).toBe(1);
    expect(inv.entries[0]?.captioned).toBe(false);
  });

  it("numbers pages by spine ordinal and indexes across docs in one space", () => {
    const inv = buildEpubInventory([OREILLY_DOC, PACKT_DOC, PANDOC_DOC]);
    expect(inv.pageCount).toBe(3);
    expect(inv.entries.map((e) => [e.index, e.page])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(inv.scanned).toBe(false);
    expect(inv.counts).toEqual({ figures: 2, uncaptioned: 1, pageRender: 0 });
  });

  it("marks inline <svg> as svg-render and unwraps svg-wrapped raster refs", () => {
    const doc = {
      href: "ch1.html",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="1" y="1"/></svg>
<p>Figure 2-1. A vector diagram</p>
<svg viewBox="0 0 600 800"><image xlink:href="images/cover.jpg" width="600" height="800"/></svg>`,
    };
    const inv = buildEpubInventory([doc]);
    expect(inv.entries[0]).toMatchObject({ source: "svg-render", captioned: true, label: "2-1", width: 400, height: 200 });
    expect(inv.entries[0]?.imageHref).toBeUndefined();
    expect(inv.entries[1]).toMatchObject({ source: "raster", imageHref: "images/cover.jpg", captioned: false });
  });

  it("routes .svg files referenced via <img> to svg-render", () => {
    const inv = buildEpubInventory([{ href: "ch1.html", html: `<img src="img/fig1.svg"/><p>Figure 1.1: Flow</p>` }]);
    expect(inv.entries[0]).toMatchObject({ source: "svg-render", imageHref: "img/fig1.svg", captioned: true });
  });

  it("does not let a caption-less image steal the next figure's caption", () => {
    const doc = {
      href: "ch1.html",
      html: `<img src="a.png"/><p>Plain prose paragraph.</p><img src="b.png"/><p>Figure 3-3. Real caption</p>`,
    };
    const inv = buildEpubInventory([doc]);
    expect(inv.entries[0]?.captioned).toBe(false);
    expect(inv.entries[1]).toMatchObject({ captioned: true, label: "3-3" });
  });

  it("bails to uncaptioned when another image starts before any caption text", () => {
    const doc = { href: "c.html", html: `<img src="a.png"/><img src="b.png"/><p>Figure 5-1. Only for b</p>` };
    const inv = buildEpubInventory([doc]);
    expect(inv.entries[0]?.captioned).toBe(false);
    expect(inv.entries[1]?.captioned).toBe(true);
  });
});

describe("adjacentCaption", () => {
  it("accepts separator-less captions in caption elements (pandoc h5 style)", () => {
    const html = `<h5 class="figure-container-h5"><span class="num-string">Figure <span>4.1</span></span> Standard RL loop</h5>`;
    expect(adjacentCaption(html, 0)).toEqual({ label: "4.1", text: "Standard RL loop" });
  });

  it("still requires the separator in prose blocks", () => {
    expect(adjacentCaption(`<p>Figure 4.1 and how it compares to the loop.</p>`, 0)).toBeNull();
  });

  it("decodes entities and collapses whitespace before matching", () => {
    const html = `<p>Figure&#160;7-2.&nbsp; The A&amp;B\n  pipeline</p>`;
    expect(adjacentCaption(html, 0)).toEqual({ label: "7-2", text: "The A&B pipeline" });
  });

  it("returns null when the following block is prose", () => {
    expect(adjacentCaption(`<p>Figure 7 shows the flow of data.</p>`, 0)).toBeNull();
  });
});

describe("OPF discovery", () => {
  it("resolves container.xml to the OPF path", () => {
    const xml = `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
    expect(parseContainerRootfile(xml)).toBe("OEBPS/content.opf");
  });

  it("orders spine hrefs by itemref, resolved against the OPF dir", () => {
    const opf = `<package><manifest>
<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="ghost"/></spine></package>`;
    expect(parseOpfSpine(opf, "OEBPS/content.opf")).toEqual(["OEBPS/text/ch1.xhtml", "OEBPS/text/ch2.xhtml"]);
  });

  it("resolveHref normalizes ../ against the doc dir", () => {
    expect(resolveHref("OEBPS/text", "../images/a.png")).toBe("OEBPS/images/a.png");
    expect(resolveHref("", "images/a.png")).toBe("images/a.png");
  });
});

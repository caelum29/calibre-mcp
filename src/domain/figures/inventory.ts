// Figure inventory builder (D-018 / #74): pairs raster image objects from
// `pdfimages -list` with caption lines from extracted text, per page, in order.
// Pure logic — IO (downloading, spawning poppler) lives in src/calibre/figure-inventory.ts.

import { type Caption, scanCaptions, splitPages } from "./captions.js";

/** A raster image object as reported by `pdfimages -list`. */
export interface RasterImage {
  /** 1-based page the object is drawn on. */
  page: number;
  /** pdfimages object number (`num` column) — the handle for later extraction. */
  num: number;
  width: number;
  height: number;
  /** Row type: only `image` rows count; `smask`/`stencil` are transparency plumbing. */
  type: string;
}

/** One inventory entry, document-ordered. See CONTEXT.md: Figure vs Embedded image. */
export interface FigureEntry {
  /** Stable per-(book, format) ordinal in document order — the Figure index. */
  index: number;
  /** PDF: 1-based page. EPUB: 1-based spine-document ordinal (the position unit). */
  page: number;
  /** True when a caption anchored this entry (a Figure); false = uncaptioned image. */
  captioned: boolean;
  /** Caption label + text when captioned (`1-1`, `The fundamental mental model…`). */
  label?: string;
  caption?: string;
  /** Pixels: raster object, PDF page render (vector figure), or EPUB SVG rasterization. */
  source: "raster" | "page-render" | "svg-render";
  /** Raster geometry / pdfimages handle; absent for page-render entries. */
  width?: number;
  height?: number;
  pdfImageNum?: number;
  /** EPUB fetch handles: spine doc, and the image file inside the zip (absent = inline SVG). */
  spineHref?: string;
  imageHref?: string;
}

export interface FigureInventory {
  /** All entries in document order, one index space (captioned + uncaptioned). */
  entries: FigureEntry[];
  pageCount: number;
  /** Scanned-book verdict: page images with no captions and next to no text. */
  scanned: boolean;
  counts: { figures: number; uncaptioned: number; pageRender: number };
}

/** Parse `pdfimages -list` output. Tolerates the two header lines and blank lines. */
export function parsePdfImagesList(output: string): RasterImage[] {
  const rasters: RasterImage[] = [];
  for (const line of output.split("\n")) {
    const cols = line.trim().split(/\s+/);
    // page num type width height color comp bpc enc interp object …
    if (cols.length < 5) continue;
    const [page, num, type, width, height] = cols;
    if (!page || !num || !/^\d+$/.test(page) || !/^\d+$/.test(num)) continue; // header/noise
    rasters.push({
      page: Number(page),
      num: Number(num),
      type: type ?? "",
      width: Number(width),
      height: Number(height),
    });
  }
  return rasters;
}

/**
 * Build the inventory: per page, pair captions with raster `image` objects in order.
 * Leftover rasters on a page become uncaptioned entries; leftover captions become
 * page-render entries — the vector-figure case pdfimages cannot see (D-018 probe:
 * JWT Handbook has 29 captions and 2 rasters).
 */
export function buildInventory(extractedText: string, rasters: RasterImage[]): FigureInventory {
  const pages = splitPages(extractedText);
  const captions = scanCaptions(extractedText);
  const images = rasters.filter((r) => r.type === "image");

  const byPageCaptions = groupBy(captions, (c) => c.page);
  const byPageImages = groupBy(images, (r) => r.page);
  const pagesWithContent = [...new Set([...byPageCaptions.keys(), ...byPageImages.keys()])].sort(
    (a, b) => a - b,
  );

  const entries: FigureEntry[] = [];
  for (const page of pagesWithContent) {
    const caps = byPageCaptions.get(page) ?? [];
    const imgs = byPageImages.get(page) ?? [];
    const paired = Math.min(caps.length, imgs.length);
    for (let i = 0; i < paired; i++) {
      const cap = caps[i];
      const img = imgs[i];
      if (cap && img) entries.push(figureFromPair(cap, img));
    }
    // vector figures: caption present, raster missing → render the page later
    for (const cap of caps.slice(paired)) {
      entries.push({ index: 0, page, captioned: true, label: cap.label, caption: cap.text, source: "page-render" });
    }
    // decorations/covers/openers: raster present, caption missing
    for (const r of imgs.slice(paired)) {
      entries.push({ index: 0, page, captioned: false, source: "raster", width: r.width, height: r.height, pdfImageNum: r.num });
    }
  }
  entries.forEach((e, i) => (e.index = i));

  const figures = entries.filter((e) => e.captioned);
  return {
    entries,
    pageCount: pages.length,
    scanned: detectScanned(pages, captions, images),
    counts: {
      figures: figures.length,
      uncaptioned: entries.length - figures.length,
      pageRender: figures.filter((e) => e.source === "page-render").length,
    },
  };
}

function figureFromPair(cap: Caption, img: RasterImage): FigureEntry {
  return {
    index: 0,
    page: cap.page,
    captioned: true,
    label: cap.label,
    caption: cap.text,
    source: "raster",
    width: img.width,
    height: img.height,
    pdfImageNum: img.num,
  };
}

/**
 * Scanned-book heuristic (Calibre has no OCR — these honestly report 0 figures):
 * no captions anywhere, an image on most pages, and almost no extractable text.
 */
export function detectScanned(pages: string[], captions: Caption[], images: RasterImage[]): boolean {
  if (captions.length > 0 || pages.length === 0) return false;
  const pagesWithImage = new Set(images.map((r) => r.page)).size;
  const avgChars = pages.reduce((sum, p) => sum + p.trim().length, 0) / pages.length;
  return pagesWithImage >= pages.length * 0.5 && avgChars < 200;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

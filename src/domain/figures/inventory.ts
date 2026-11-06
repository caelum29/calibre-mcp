// Figure inventory builder (D-018 / #74): pairs raster image objects from
// `pdfimages -list` with caption lines from extracted text, per page, in order.
// Pure logic — IO (downloading, spawning poppler) lives in src/calibre/figure-inventory.ts.

import { type LayoutPage, recoverLabelOnlyCaptions } from "./caption-layout.js";
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
  /** Effective resolution as drawn on the page; with width/height it gives the printed size (#422). */
  xPpi?: number;
  yPpi?: number;
}

/** One inventory entry, document-ordered. See GLOSSARY.md: Figure vs Embedded image. */
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
  /**
   * Raster geometry / pdfimages handle; absent for page-render entries — except a demoted pair
   * (#422) keeps the handle of the fragment it consumed, so per-page raster ordinals stay aligned.
   */
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
    // counted from the end: inline images print `[inline]` where others print `<obj> <gen>`
    const xPpi = Number(cols[cols.length - 4]);
    const yPpi = Number(cols[cols.length - 3]);
    rasters.push({
      page: Number(page),
      num: Number(num),
      type: type ?? "",
      width: Number(width),
      height: Number(height),
      ...(xPpi > 0 && yPpi > 0 ? { xPpi, yPpi } : {}),
    });
  }
  return rasters;
}

/**
 * Build the inventory: per page, pair captions with raster `image` objects in order.
 * Leftover rasters on a page become uncaptioned entries; leftover captions become
 * page-render entries — the vector-figure case pdfimages cannot see (D-018 probe:
 * JWT Handbook has 29 captions and 2 rasters). `layout` (from `pdftotext -bbox-layout`,
 * label-only pages only) recovers caption text the line scan couldn't reach.
 */
export function buildInventory(
  extractedText: string,
  rasters: RasterImage[],
  layout?: ReadonlyMap<number, LayoutPage>,
): FigureInventory {
  const pages = splitPages(extractedText);
  const scanned = scanCaptions(extractedText);
  const captions = layout ? recoverLabelOnlyCaptions(scanned, layout) : scanned;
  const images = rasters.filter((r) => r.type === "image");

  const byPageCaptions = groupBy(captions, (c) => c.page);
  const byPageImages = groupBy(images, (r) => r.page);
  const pagesWithContent = [...new Set([...byPageCaptions.keys(), ...byPageImages.keys()])].sort((a, b) => a - b);

  const entries: FigureEntry[] = [];
  for (const page of pagesWithContent) {
    const caps = byPageCaptions.get(page) ?? [];
    const imgs = byPageImages.get(page) ?? [];
    const paired = Math.min(caps.length, imgs.length);
    // magazines build one figure from dozens of tiles — any single raster is a fragment (#422)
    const composite = imgs.length > 1 && imgs.length >= COMPOSITE_RATIO * caps.length;
    for (let i = 0; i < paired; i++) {
      const cap = caps[i];
      const img = imgs[i];
      if (!cap || !img) continue;
      // demote in place: same slot, same index — the semantic index and text markers point at it
      entries.push(composite || tooSmallForFigure(img) ? demotedPair(cap, img) : figureFromPair(cap, img));
    }
    // vector figures: caption present, raster missing → render the page later
    for (const cap of caps.slice(paired)) {
      entries.push({ index: 0, page, captioned: true, label: cap.label, caption: cap.text, source: "page-render" });
    }
    // decorations/covers/openers: raster present, caption missing
    for (const r of imgs.slice(paired)) {
      entries.push({
        index: 0,
        page,
        captioned: false,
        source: "raster",
        width: r.width,
        height: r.height,
        pdfImageNum: r.num,
      });
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

/**
 * Printed area below which a raster is page furniture, not a figure (#422 calibration over
 * Magazines + 120 Programming Books PDFs): colour bars, tiles, icons, section banners all sit
 * under 1 in², while real figures — even narrow screenshot strips (5.5×0.64 in) — sit above.
 * A rare small real figure loses little: its page render still shows it.
 */
const MIN_FIGURE_AREA_IN2 = 1;
/** Rasters per caption at which a page is a composite figure (panels, markers, backgrounds). */
const COMPOSITE_RATIO = 3;

/** True when the raster prints too small to be the captioned figure; unknown ppi → keep. */
function tooSmallForFigure(img: RasterImage): boolean {
  if (!img.xPpi || !img.yPpi) return false;
  return (img.width / img.xPpi) * (img.height / img.yPpi) < MIN_FIGURE_AREA_IN2;
}

/** A caption whose paired raster is a fragment: render the page band instead (#422). */
function demotedPair(cap: Caption, img: RasterImage): FigureEntry {
  return {
    index: 0,
    page: cap.page,
    captioned: true,
    label: cap.label,
    caption: cap.text,
    source: "page-render",
    pdfImageNum: img.num,
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

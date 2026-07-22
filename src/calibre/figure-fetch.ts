// Figure pixel production (D-018 / #79): turn one FigureEntry into image bytes.
// PDF rasters come out of `pdfimages` (single-page run, row↔file mapping probed
// 2026-07-22: per-range numbering restarts at 0 and includes smask rows); vector
// figures render as a band crop above the caption (`pdftotext -bbox` + `pdftoppm`,
// probe #77); EPUB images come out of the zip; SVG rasterizes via macOS qlmanage
// (#78 — zero new deps). Encoding: PNG vs JPEG via sips, smaller wins (JPEG
// artifacts hurt line-art; sharp/PNG-8 is not resolvable in the MCPB bundle).

import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeBand, findAnchors, parseBboxPage, selectAnchor } from "../domain/figures/band.js";
import type { FigureEntry, FigureInventory } from "../domain/figures/inventory.js";
import { parsePdfImagesList } from "../domain/figures/inventory.js";

/** Longest-side pixel cap per detail tier (D-018: resolution is the token lever). */
export const DETAIL_MAX_SIDE: Record<"standard" | "high", number> = {
  standard: 1024,
  high: 1568,
};

const RENDER_DPI = 150;
const PT_TO_PX = RENDER_DPI / 72;

export const PDFTOPPM_CANDIDATES = [
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/usr/bin/pdftoppm",
];
const SIPS_CANDIDATES = ["/usr/bin/sips"];
const QLMANAGE_CANDIDATES = ["/usr/bin/qlmanage"];

/** Encoded image ready for an MCP ImageContent block. */
export interface EncodedImage {
  data: string; // base64, no data: prefix
  mimeType: "image/png" | "image/jpeg";
  bytes: number;
}

/** Subprocess runner injected by the service (shares timeout/logging discipline). */
export type Runner = (bin: string, args: string[], okCodes?: number[]) => Promise<string>;

export function findBin(candidates: string[]): string | null {
  return candidates.find(existsSync) ?? null;
}

/**
 * Extract a raster figure from a single PDF page. `pdfimages` numbering restarts
 * per range, so the mapping is: k-th `-list` row for the page ↔ `root-00k.png`,
 * and our figure is the j-th `image`-type row, where j = the entry's position
 * among same-page raster entries ordered by their global pdfImageNum.
 */
export async function extractPdfRaster(
  run: Runner,
  pdfimages: string,
  src: string,
  scratch: string,
  entry: FigureEntry,
  inventory: FigureInventory,
): Promise<string> {
  const page = String(entry.page);
  const listOut = await run(pdfimages, ["-list", "-f", page, "-l", page, src]);
  const rows = parsePdfImagesList(listOut);
  const siblings = inventory.entries
    .filter((e) => e.page === entry.page && e.pdfImageNum !== undefined)
    .sort((a, b) => (a.pdfImageNum ?? 0) - (b.pdfImageNum ?? 0));
  const ordinal = siblings.findIndex((e) => e.index === entry.index);
  const imageRows = rows.filter((r) => r.type === "image");
  const row = imageRows[ordinal];
  if (ordinal < 0 || !row) throw new Error("FIGURES_FETCH_FAILED");
  const rowIndex = rows.indexOf(row); // file numbering counts smask rows too
  const root = path.join(scratch, "px");
  await run(pdfimages, ["-png", "-f", page, "-l", page, src, root]);
  const file = `${root}-${String(rowIndex).padStart(3, "0")}.png`;
  if (!existsSync(file)) throw new Error("FIGURES_FETCH_FAILED");
  return file;
}

/**
 * Render a vector figure as the band above its caption (probe #77: 92% fully
 * captured, both failures fixed by lowest-match anchoring). No anchor found in
 * bbox → whole-page render, never an error (the page still shows the figure).
 */
export async function renderPdfBand(
  run: Runner,
  bins: { pdftotext: string; pdftoppm: string },
  src: string,
  scratch: string,
  entry: FigureEntry,
  inventory: FigureInventory,
): Promise<string> {
  const page = String(entry.page);
  const bboxFile = path.join(scratch, "bbox.html");
  await run(bins.pdftotext, ["-q", "-bbox", "-f", page, "-l", page, src, bboxFile]);
  const bbox = parseBboxPage(await readFile(bboxFile, "utf8"));

  let crop: string[] = [];
  if (bbox && entry.label) {
    const anchor = selectAnchor(findAnchors(bbox, entry.label));
    if (anchor) {
      // other captions on the page bound the band top (their figure ends there)
      const others = inventory.entries
        .filter((e) => e.page === entry.page && e.captioned && e.index !== entry.index && e.label)
        .map((e) => selectAnchor(findAnchors(bbox, e.label as string)))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      const band = computeBand(bbox, anchor, others);
      const w = Math.round(bbox.width * PT_TO_PX);
      const y = Math.round(band.top * PT_TO_PX);
      const h = Math.round((band.bottom - band.top) * PT_TO_PX);
      if (h > 20) crop = ["-x", "0", "-y", String(y), "-W", String(w), "-H", String(h)];
    }
  }
  const out = path.join(scratch, `band-${entry.index}`);
  await run(bins.pdftoppm, [
    "-png",
    "-r",
    String(RENDER_DPI),
    "-f",
    page,
    "-l",
    page,
    ...crop,
    "-singlefile",
    src,
    out,
  ]);
  const file = `${out}.png`;
  if (!existsSync(file)) throw new Error("FIGURES_FETCH_FAILED");
  return file;
}

/**
 * Rasterize an SVG with qlmanage (#78: aspect preserved on a square canvas,
 * bottom-padded — accepted for v1; SVG figures are near-absent in the library).
 * qlmanage writes `<name>.svg.png` into the -o dir and cannot run inside another
 * sandbox — live only, unit tests stub it.
 */
export async function rasterizeSvg(
  run: Runner,
  qlmanage: string,
  svgFile: string,
  scratch: string,
  maxSide: number,
): Promise<string> {
  await run(qlmanage, ["-t", "-s", String(maxSide), "-o", scratch, svgFile]);
  const produced = path.join(scratch, `${path.basename(svgFile)}.png`);
  if (!existsSync(produced)) throw new Error("FIGURES_FETCH_FAILED");
  // rename away from the .svg.png double extension before sips sees it
  const clean = produced.replace(/\.svg\.png$/, ".png");
  if (clean !== produced) await rename(produced, clean);
  return clean;
}

/** Pull the n-th inline `<svg>` block (no imageHref) out of a spine doc into a file. */
export async function inlineSvgToFile(
  html: string,
  ordinal: number,
  scratch: string,
): Promise<string> {
  const blocks = [...html.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)]
    .map((m) => m[0])
    // wrapped-raster svgs (an <image href> inside) carry an imageHref in the
    // inventory instead — mirror that split or the ordinal drifts
    .filter((b) => !/<image\b[^>]*\b(?:xlink:)?href=/i.test(b));
  const block = blocks[ordinal];
  if (!block) throw new Error("FIGURES_FETCH_FAILED");
  const svg = /\bxmlns=/.test(block)
    ? block
    : block.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const file = path.join(scratch, `inline-${ordinal}.svg`);
  await writeFile(file, svg, "utf8");
  return file;
}

/**
 * Resize to the detail cap and encode PNG vs JPEG, returning the smaller
 * (line-art keeps PNG, photos flip to JPEG). sips is macOS-only; without it the
 * original bytes pass through untouched (the byte cap still protects the response).
 */
export async function encodeSmallest(
  run: Runner,
  imageFile: string,
  maxSide: number,
): Promise<EncodedImage> {
  const sips = findBin(SIPS_CANDIDATES);
  if (!sips) {
    const raw = await readFile(imageFile);
    return { data: raw.toString("base64"), mimeType: "image/png", bytes: raw.length };
  }
  const dims = await run(sips, ["-g", "pixelWidth", "-g", "pixelHeight", imageFile]);
  const wh = [...dims.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => Number(m[1]));
  const longest = Math.max(...(wh.length ? wh : [0]));

  const dir = path.dirname(imageFile);
  const base = path.join(dir, `enc-${path.basename(imageFile).replace(/\.[^.]+$/, "")}`);
  const pngOut = `${base}.png`;
  const jpgOut = `${base}.jpg`;
  // -Z resamples to the given longest side — guard against upscaling small rasters
  const resize = longest > maxSide ? ["-Z", String(maxSide)] : [];
  await run(sips, [...resize, "-s", "format", "png", imageFile, "--out", pngOut]);
  await run(sips, [...resize, "-s", "format", "jpeg", "-s", "formatOptions", "80", imageFile, "--out", jpgOut]);
  const [png, jpg] = await Promise.all([readFile(pngOut), readFile(jpgOut)]);
  return png.length <= jpg.length
    ? { data: png.toString("base64"), mimeType: "image/png", bytes: png.length }
    : { data: jpg.toString("base64"), mimeType: "image/jpeg", bytes: jpg.length };
}

export function pdftoppmBinary(): string | null {
  return findBin(PDFTOPPM_CANDIDATES);
}

export function qlmanageBinary(): string | null {
  return findBin(QLMANAGE_CANDIDATES);
}

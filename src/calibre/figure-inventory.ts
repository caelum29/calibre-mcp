// Figure-inventory orchestration (D-018 / #74): download the PDF from the Content
// Server (GUI-safe), run poppler (pdftotext for caption pages, pdfimages -list for
// raster objects), build the inventory, and cache it as JSON beside the text cache.
// The inventory is derived data — same cacheKey discipline as extract.ts, no DB.

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../config.js";
import { labelOnlyPages, type LayoutPage, parseBboxLayout } from "../domain/figures/caption-layout.js";
import { scanCaptions } from "../domain/figures/captions.js";
import { buildEpubInventory, parseContainerRootfile, parseOpfSpine, type SpineDoc } from "../domain/figures/epub.js";
import { buildInventory, type FigureInventory, parsePdfImagesList } from "../domain/figures/inventory.js";
import { log } from "../logging.js";
import {
  DETAIL_MAX_SIDE,
  type EncodedImage,
  encodeSmallest,
  extractPdfRaster,
  inlineSvgToFile,
  pdftoppmBinary,
  qlmanageBinary,
  rasterizeSvg,
  renderPdfBand,
  type Runner,
} from "./figure-fetch.js";
import { FiguresError, type FiguresErrorCode } from "../domain/errors.js";
import type { FigureEntry } from "../domain/figures/inventory.js";
import { unzipBinary } from "./epub-toc.js";
import { downloadToFile } from "./http.js";
import { findBin, runTool } from "./binaries.js";

export interface GetInventoryArgs {
  bookId: number;
  format: string;
  downloadUrl: string;
  /** Cache key — include something that changes on edit (e.g. lastModified). */
  cacheKey: string;
  maxBytes?: number;
  timeoutMs?: number;
  /** Cancellation: aborts the download and kills the scanner's process group. */
  signal?: AbortSignal;
}

export interface InventoryResult {
  inventory: FigureInventory;
  cached: boolean;
}

export interface FetchFiguresArgs {
  format: string;
  downloadUrl: string;
  inventory: FigureInventory;
  /** Inventory indexes to fetch — the tool validates them; ≤3 per call (D-018). */
  indexes: number[];
  detail: "standard" | "high";
  /** Raw-byte response budget across all figures (base64 adds ~1/3 on top). */
  maxTotalBytes?: number;
  timeoutMs?: number;
}

export interface FetchedFigure {
  index: number;
  image: EncodedImage;
}

/** A figure that was not returned: prose reason, or a coded failure the tool words. */
export type SkippedFigure = { index: number; reason: string } | { index: number; code: FiguresErrorCode };

export interface FetchOutcome {
  images: FetchedFigure[];
  skipped: SkippedFigure[];
}

/** Raw bytes; base64 inflates ×4/3, so this keeps the response near the ~2 MB cap. */
const RESPONSE_BYTE_BUDGET = 1_500_000;
/** Fallback sides when a figure alone would blow the budget at the asked detail. */
const SHRINK_LADDER = [768, 512];

const CACHE_DIR = path.join(tmpdir(), "calibre-mcp-cache");
/** Bump when FigureEntry/matching semantics change — stale JSON must not survive. */
// v2: EPUB entries (spineHref/imageHref, svg-render source)
// v3: caption context guard — wrapped in-text references no longer become figures (#116)
// v4: multi-line + bare-label captions, reference-tail rejects (#107) — indexes renumber
// v5: label-only captions recovered from page layout (pdftotext -bbox-layout)
const INVENTORY_VERSION = 5;
const RUN_TIMEOUT_MS = 120_000;
const MAX_LIST_BUFFER = 8 * 1024 * 1024;

interface CacheEnvelope {
  v: number;
  inventory: FigureInventory;
}

/** Figure inventory + pixel fetch as tool handlers see them (#258, D-018). */
export interface FigureSource {
  getInventory(args: GetInventoryArgs): Promise<InventoryResult>;
  fetchFigures(args: FetchFiguresArgs): Promise<FetchOutcome>;
}

/** Figure inventory: poppler over PDFs, system unzip over EPUBs (spine HTML scan). */
export class FigureInventoryService implements FigureSource {
  constructor(private readonly cfg: Config) {}

  /** Both poppler binaries, or null when the toolchain is missing. */
  binaries(): { pdfimages: string; pdftotext: string } | null {
    const pdfimages = findBin("pdfimages");
    const pdftotext = findBin("pdftotext");
    if (!pdfimages || !pdftotext) return null;
    return { pdfimages, pdftotext };
  }

  /** System unzip, or null when missing (never on macOS; minimal Linux images only). */
  unzipBinary(): string | null {
    return unzipBinary();
  }

  /** Cache-keyed inventory. Downloads + scans on miss; JSON round-trip on hit. */
  async getInventory(args: GetInventoryArgs): Promise<InventoryResult> {
    const format = args.format.toLowerCase();
    if (format !== "pdf" && format !== "epub") throw new FiguresError("FORMAT_UNSUPPORTED");
    const bins = format === "pdf" ? this.binaries() : null;
    if (format === "pdf" && !bins) throw new FiguresError("NO_POPPLER");
    const unzip = format === "epub" ? this.unzipBinary() : null;
    if (format === "epub" && !unzip) throw new FiguresError("NO_UNZIP");

    const cacheFile = path.join(CACHE_DIR, `fg-${hashKey(args.cacheKey)}.json`);
    if (!path.resolve(cacheFile).startsWith(path.resolve(CACHE_DIR) + path.sep)) {
      throw new Error("cache path escaped the cache directory");
    }

    const cached = await readCache(cacheFile);
    if (cached) return { inventory: cached, cached: true };

    await mkdir(CACHE_DIR, { recursive: true });
    const tmpSrc = path.join(CACHE_DIR, `dl-${randomUUID()}.${format}`);
    const tmpTxt = path.join(CACHE_DIR, `fg-${randomUUID()}.txt`);
    try {
      await downloadToFile(args.downloadUrl, tmpSrc, {
        maxBytes: args.maxBytes ?? this.cfg.maxBookBytes,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      });
      const inventory =
        format === "epub" && unzip
          ? await this.scanEpubFile(unzip, tmpSrc, args.timeoutMs, args.signal)
          : await this.scanFile(
              bins as { pdfimages: string; pdftotext: string },
              tmpSrc,
              tmpTxt,
              args.timeoutMs,
              args.signal,
            );
      const envelope: CacheEnvelope = { v: INVENTORY_VERSION, inventory };
      await writeFile(cacheFile, JSON.stringify(envelope), "utf8");
      return { inventory, cached: false };
    } finally {
      await unlink(tmpSrc).catch(() => {});
      await unlink(tmpTxt).catch(() => {});
    }
  }

  /**
   * Fetch selected figures as encoded images: download the source once, produce
   * pixels per entry (pdfimages raster / band-crop page render / EPUB zip member /
   * qlmanage SVG), encode smaller-of-PNG-and-JPEG, and enforce the response byte
   * budget — over-budget figures shrink down the ladder, then skip with a reason
   * (never a thrown error once the source is local; the model can re-call).
   */
  async fetchFigures(args: FetchFiguresArgs): Promise<FetchOutcome> {
    const format = args.format.toLowerCase();
    if (format !== "pdf" && format !== "epub") throw new FiguresError("FORMAT_UNSUPPORTED");
    const timeout = args.timeoutMs ?? RUN_TIMEOUT_MS;
    const run: Runner = (bin, a, okCodes) => this.#run(bin, a, timeout, okCodes ?? [0]);

    await mkdir(CACHE_DIR, { recursive: true });
    const scratch = path.join(CACHE_DIR, `fx-${randomUUID()}`);
    await mkdir(scratch, { recursive: true });
    const src = path.join(scratch, `src.${format}`);
    try {
      await downloadToFile(args.downloadUrl, src, {
        maxBytes: this.cfg.maxBookBytes,
        timeoutMs: args.timeoutMs,
      });
      let epubDir: string | null = null;
      if (format === "epub") {
        const unzip = this.unzipBinary();
        if (!unzip) throw new FiguresError("NO_UNZIP");
        epubDir = path.join(scratch, "ep");
        await this.#run(unzip, ["-o", "-qq", src, "-d", epubDir], timeout, [0, 1]);
      }

      const images: FetchedFigure[] = [];
      const skipped: FetchOutcome["skipped"] = [];
      let remaining = args.maxTotalBytes ?? RESPONSE_BYTE_BUDGET;
      for (const index of args.indexes) {
        const entry = args.inventory.entries[index];
        if (!entry) {
          skipped.push({ index, reason: "no such figure index" });
          continue;
        }
        try {
          const file = await this.#produce(run, format, src, epubDir, scratch, entry, args.inventory);
          let image = await encodeSmallest(run, file, DETAIL_MAX_SIDE[args.detail]);
          for (const side of SHRINK_LADDER) {
            if (image.bytes <= remaining) break;
            image = await encodeSmallest(run, file, side);
          }
          if (image.bytes > remaining) {
            skipped.push({
              index,
              reason:
                images.length > 0
                  ? "response byte cap reached — re-call with this index alone"
                  : "figure exceeds the response byte cap even at reduced resolution",
            });
            continue;
          }
          remaining -= image.bytes;
          images.push({ index, image });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("figure fetch failed", { index, msg: msg.slice(0, 300) });
          // anything that is not a coded figures failure (incl. cancellation) reads as a failed extraction
          skipped.push({ index, code: err instanceof FiguresError ? err.code : "FETCH_FAILED" });
        }
      }
      return { images, skipped };
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Produce a raw image file for one entry (dispatch on format + source). */
  async #produce(
    run: Runner,
    format: string,
    src: string,
    epubDir: string | null,
    scratch: string,
    entry: FigureEntry,
    inventory: FigureInventory,
  ): Promise<string> {
    if (format === "pdf") {
      const bins = this.binaries();
      if (!bins) throw new FiguresError("NO_POPPLER");
      if (entry.source === "raster") {
        return extractPdfRaster(run, bins.pdfimages, src, scratch, entry, inventory);
      }
      const pdftoppm = pdftoppmBinary();
      if (!pdftoppm) throw new FiguresError("NO_POPPLER");
      return renderPdfBand(run, { pdftotext: bins.pdftotext, pdftoppm }, src, scratch, entry, inventory);
    }
    // EPUB: zip member (raster), .svg member, or inline <svg> in the spine doc
    if (!epubDir) throw new FiguresError("FETCH_FAILED");
    const readInside = (href: string): string => {
      const abs = path.resolve(epubDir, href);
      if (!abs.startsWith(path.resolve(epubDir) + path.sep)) throw new FiguresError("FETCH_FAILED");
      return abs;
    };
    if (entry.source === "raster" && entry.imageHref) {
      const abs = readInside(entry.imageHref);
      if (!existsSync(abs)) throw new FiguresError("FETCH_FAILED");
      return abs;
    }
    const qlmanage = qlmanageBinary();
    if (!qlmanage) throw new FiguresError("NO_QLMANAGE");
    if (entry.imageHref) {
      const abs = readInside(entry.imageHref);
      if (!existsSync(abs)) throw new FiguresError("FETCH_FAILED");
      return rasterizeSvg(run, qlmanage, abs, scratch, DETAIL_MAX_SIDE.high);
    }
    // inline SVG: ordinal among this spine doc's inline-svg entries, re-scan the doc
    if (!entry.spineHref) throw new FiguresError("FETCH_FAILED");
    const siblings = inventory.entries.filter(
      (e) => e.spineHref === entry.spineHref && e.source === "svg-render" && !e.imageHref,
    );
    const ordinal = siblings.findIndex((e) => e.index === entry.index);
    if (ordinal < 0) throw new FiguresError("FETCH_FAILED");
    const html = await readFile(readInside(entry.spineHref), "utf8");
    const svgFile = await inlineSvgToFile(html, ordinal, scratch);
    return rasterizeSvg(run, qlmanage, svgFile, scratch, DETAIL_MAX_SIDE.high);
  }

  /**
   * Unzip a local EPUB into a scratch dir, resolve container→OPF→spine, and scan
   * the spine HTML for figures (no cache, no download). DRM/corrupt zips surface
   * as FIGURES_SCAN_FAILED — unzip exits non-zero on them.
   */
  async scanEpubFile(unzip: string, src: string, timeoutMs?: number, signal?: AbortSignal): Promise<FigureInventory> {
    const extractDir = path.join(CACHE_DIR, `ep-${randomUUID()}`);
    try {
      // `unzip -d` creates only ONE missing level, so a not-yet-existing CACHE_DIR (fresh
      // boot, tmp reaper) made it exit 2 → FIGURES_SCAN_FAILED. Own the dir here instead of
      // relying on the caller having mkdir'd it.
      await mkdir(extractDir, { recursive: true });
      // -o overwrite, -qq silent; unzip itself refuses paths that escape -d.
      // Exit 1 = warnings only (EPUB mimetype quirks trigger it) — extraction still succeeded.
      await this.#run(unzip, ["-o", "-qq", src, "-d", extractDir], timeoutMs ?? RUN_TIMEOUT_MS, [0, 1], signal);
      const readInside = async (href: string): Promise<string> => {
        const abs = path.resolve(extractDir, href);
        if (!abs.startsWith(path.resolve(extractDir) + path.sep)) throw new FiguresError("SCAN_FAILED");
        return readFile(abs, "utf8");
      };
      const opfPath = parseContainerRootfile(await readInside("META-INF/container.xml"));
      if (!opfPath) throw new FiguresError("SCAN_FAILED");
      const spineHrefs = parseOpfSpine(await readInside(opfPath), opfPath);
      const docs: SpineDoc[] = [];
      for (const href of spineHrefs) {
        // missing/binary spine items (rare, broken books) are skipped, not fatal
        if (!/\.(x?html?|xml)$/i.test(href)) continue;
        try {
          docs.push({ href, html: await readInside(href) });
        } catch {
          log.error("epub spine doc unreadable", { href });
        }
      }
      if (docs.length === 0) throw new FiguresError("SCAN_FAILED");
      return buildEpubInventory(docs);
    } finally {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Run poppler over a local PDF and build the inventory (no cache, no download). */
  async scanFile(
    bins: { pdfimages: string; pdftotext: string },
    src: string,
    tmpTxt: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<FigureInventory> {
    const timeout = timeoutMs ?? RUN_TIMEOUT_MS;
    // pdftotext keeps \f page breaks — that's what page-scoped caption matching needs.
    await this.#run(bins.pdftotext, ["-q", "-enc", "UTF-8", src, tmpTxt], timeout, [0], signal);
    const listOut = await this.#run(bins.pdfimages, ["-list", src], timeout, [0], signal);
    const text = await readFile(tmpTxt, "utf8");
    const layout = await this.#readLayout(bins.pdftotext, src, tmpTxt, text, timeout);
    return buildInventory(text, parsePdfImagesList(listOut), layout);
  }

  /**
   * Word geometry for pages with label-only captions, where the caption text sits apart
   * from its label. One `-bbox-layout` run over the page range: a per-page run costs a
   * process spawn each, and Manning books carry 100+ such pages. Best-effort — a failed
   * run leaves those Figures label-only, never fails the inventory.
   */
  async #readLayout(
    pdftotext: string,
    src: string,
    tmpTxt: string,
    text: string,
    timeout: number,
  ): Promise<Map<number, LayoutPage> | undefined> {
    const pages = labelOnlyPages(scanCaptions(text));
    if (pages.length === 0) return undefined;
    const first = pages[0] as number;
    const last = pages[pages.length - 1] as number;
    const tmpHtml = `${tmpTxt}.bbox.html`;
    try {
      await this.#run(
        pdftotext,
        ["-q", "-enc", "UTF-8", "-bbox-layout", "-f", String(first), "-l", String(last), src, tmpHtml],
        timeout,
      );
      return parseBboxLayout(await readFile(tmpHtml, "utf8"), new Set(pages), first);
    } catch {
      return undefined; // #run logged it
    } finally {
      await unlink(tmpHtml).catch(() => {});
    }
  }

  async #run(
    bin: string,
    args: string[],
    timeout: number,
    okCodes: number[] = [0],
    signal?: AbortSignal,
  ): Promise<string> {
    return runTool(bin, args, {
      timeoutMs: timeout,
      maxBuffer: MAX_LIST_BUFFER,
      signal,
      okCodes,
      fail: (timedOut) => new FiguresError(timedOut ? "SCAN_TIMEOUT" : "SCAN_FAILED"),
      logMessage: "figure inventory scan failed",
    });
  }
}

/** Read + validate a cache envelope; null on miss, corruption, or version mismatch. */
async function readCache(cacheFile: string): Promise<FigureInventory | null> {
  if (!existsSync(cacheFile)) return null;
  try {
    const envelope = JSON.parse(await readFile(cacheFile, "utf8")) as CacheEnvelope;
    if (envelope.v !== INVENTORY_VERSION || !Array.isArray(envelope.inventory?.entries)) return null;
    const now = new Date();
    await utimes(cacheFile, now, now).catch(() => {}); // LRU touch
    return envelope.inventory;
  } catch {
    return null;
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

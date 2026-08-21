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
import type { FigureEntry } from "../domain/figures/inventory.js";
import { downloadToFile } from "./http.js";
import { spawnCollect, SpawnTimeoutError } from "./spawn.js";

export interface GetInventoryArgs {
  bookId: number;
  format: string;
  downloadUrl: string;
  /** Cache key — include something that changes on edit (e.g. lastModified). */
  cacheKey: string;
  maxBytes?: number;
  timeoutMs?: number;
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

export interface FetchOutcome {
  images: FetchedFigure[];
  skipped: Array<{ index: number; reason: string }>;
}

/** Raw bytes; base64 inflates ×4/3, so this keeps the response near the ~2 MB cap. */
const RESPONSE_BYTE_BUDGET = 1_500_000;
/** Fallback sides when a figure alone would blow the budget at the asked detail. */
const SHRINK_LADDER = [768, 512];

const CACHE_DIR = path.join(tmpdir(), "calibre-mcp-cache");
/** Bump when FigureEntry/matching semantics change — stale JSON must not survive. */
// v2: EPUB entries (spineHref/imageHref, svg-render source)
// v3: caption context guard — wrapped in-text references no longer become figures (#116)
const INVENTORY_VERSION = 3;
const RUN_TIMEOUT_MS = 120_000;
const MAX_LIST_BUFFER = 8 * 1024 * 1024;

const PDFIMAGES_CANDIDATES = ["/opt/homebrew/bin/pdfimages", "/usr/local/bin/pdfimages", "/usr/bin/pdfimages"];
const PDFTOTEXT_CANDIDATES = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"];
// EPUB = zip; system unzip is universal on macOS/Linux, keeps the zero-new-deps rule.
const UNZIP_CANDIDATES = ["/usr/bin/unzip", "/opt/homebrew/bin/unzip", "/usr/local/bin/unzip"];

interface CacheEnvelope {
  v: number;
  inventory: FigureInventory;
}

/** Figure inventory: poppler over PDFs, system unzip over EPUBs (spine HTML scan). */
export class FigureInventoryService {
  constructor(private readonly cfg: Config) {}

  /** Both poppler binaries, or null when the toolchain is missing. */
  binaries(): { pdfimages: string; pdftotext: string } | null {
    const pdfimages = PDFIMAGES_CANDIDATES.find(existsSync);
    const pdftotext = PDFTOTEXT_CANDIDATES.find(existsSync);
    if (!pdfimages || !pdftotext) return null;
    return { pdfimages, pdftotext };
  }

  /** System unzip, or null when missing (never on macOS; minimal Linux images only). */
  unzipBinary(): string | null {
    return UNZIP_CANDIDATES.find(existsSync) ?? null;
  }

  /** Cache-keyed inventory. Downloads + scans on miss; JSON round-trip on hit. */
  async getInventory(args: GetInventoryArgs): Promise<InventoryResult> {
    const format = args.format.toLowerCase();
    if (format !== "pdf" && format !== "epub") throw new Error("FIGURES_FORMAT_UNSUPPORTED");
    const bins = format === "pdf" ? this.binaries() : null;
    if (format === "pdf" && !bins) throw new Error("FIGURES_NO_POPPLER");
    const unzip = format === "epub" ? this.unzipBinary() : null;
    if (format === "epub" && !unzip) throw new Error("FIGURES_NO_UNZIP");

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
      });
      const inventory =
        format === "epub" && unzip
          ? await this.scanEpubFile(unzip, tmpSrc, args.timeoutMs)
          : await this.scanFile(bins as { pdfimages: string; pdftotext: string }, tmpSrc, tmpTxt, args.timeoutMs);
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
    if (format !== "pdf" && format !== "epub") throw new Error("FIGURES_FORMAT_UNSUPPORTED");
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
        if (!unzip) throw new Error("FIGURES_NO_UNZIP");
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
          skipped.push({ index, reason: msg.startsWith("FIGURES_") ? msg : "FIGURES_FETCH_FAILED" });
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
      if (!bins) throw new Error("FIGURES_NO_POPPLER");
      if (entry.source === "raster") {
        return extractPdfRaster(run, bins.pdfimages, src, scratch, entry, inventory);
      }
      const pdftoppm = pdftoppmBinary();
      if (!pdftoppm) throw new Error("FIGURES_NO_POPPLER");
      return renderPdfBand(run, { pdftotext: bins.pdftotext, pdftoppm }, src, scratch, entry, inventory);
    }
    // EPUB: zip member (raster), .svg member, or inline <svg> in the spine doc
    if (!epubDir) throw new Error("FIGURES_FETCH_FAILED");
    const readInside = (href: string): string => {
      const abs = path.resolve(epubDir, href);
      if (!abs.startsWith(path.resolve(epubDir) + path.sep)) throw new Error("FIGURES_FETCH_FAILED");
      return abs;
    };
    if (entry.source === "raster" && entry.imageHref) {
      const abs = readInside(entry.imageHref);
      if (!existsSync(abs)) throw new Error("FIGURES_FETCH_FAILED");
      return abs;
    }
    const qlmanage = qlmanageBinary();
    if (!qlmanage) throw new Error("FIGURES_NO_QLMANAGE");
    if (entry.imageHref) {
      const abs = readInside(entry.imageHref);
      if (!existsSync(abs)) throw new Error("FIGURES_FETCH_FAILED");
      return rasterizeSvg(run, qlmanage, abs, scratch, DETAIL_MAX_SIDE.high);
    }
    // inline SVG: ordinal among this spine doc's inline-svg entries, re-scan the doc
    if (!entry.spineHref) throw new Error("FIGURES_FETCH_FAILED");
    const siblings = inventory.entries.filter(
      (e) => e.spineHref === entry.spineHref && e.source === "svg-render" && !e.imageHref,
    );
    const ordinal = siblings.findIndex((e) => e.index === entry.index);
    if (ordinal < 0) throw new Error("FIGURES_FETCH_FAILED");
    const html = await readFile(readInside(entry.spineHref), "utf8");
    const svgFile = await inlineSvgToFile(html, ordinal, scratch);
    return rasterizeSvg(run, qlmanage, svgFile, scratch, DETAIL_MAX_SIDE.high);
  }

  /**
   * Unzip a local EPUB into a scratch dir, resolve container→OPF→spine, and scan
   * the spine HTML for figures (no cache, no download). DRM/corrupt zips surface
   * as FIGURES_SCAN_FAILED — unzip exits non-zero on them.
   */
  async scanEpubFile(unzip: string, src: string, timeoutMs?: number): Promise<FigureInventory> {
    const extractDir = path.join(CACHE_DIR, `ep-${randomUUID()}`);
    try {
      // `unzip -d` creates only ONE missing level, so a not-yet-existing CACHE_DIR (fresh
      // boot, tmp reaper) made it exit 2 → FIGURES_SCAN_FAILED. Own the dir here instead of
      // relying on the caller having mkdir'd it.
      await mkdir(extractDir, { recursive: true });
      // -o overwrite, -qq silent; unzip itself refuses paths that escape -d.
      // Exit 1 = warnings only (EPUB mimetype quirks trigger it) — extraction still succeeded.
      await this.#run(unzip, ["-o", "-qq", src, "-d", extractDir], timeoutMs ?? RUN_TIMEOUT_MS, [0, 1]);
      const readInside = async (href: string): Promise<string> => {
        const abs = path.resolve(extractDir, href);
        if (!abs.startsWith(path.resolve(extractDir) + path.sep)) throw new Error("FIGURES_SCAN_FAILED");
        return readFile(abs, "utf8");
      };
      const opfPath = parseContainerRootfile(await readInside("META-INF/container.xml"));
      if (!opfPath) throw new Error("FIGURES_SCAN_FAILED");
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
      if (docs.length === 0) throw new Error("FIGURES_SCAN_FAILED");
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
  ): Promise<FigureInventory> {
    const timeout = timeoutMs ?? RUN_TIMEOUT_MS;
    // pdftotext keeps \f page breaks — that's what page-scoped caption matching needs.
    await this.#run(bins.pdftotext, ["-q", "-enc", "UTF-8", src, tmpTxt], timeout);
    const listOut = await this.#run(bins.pdfimages, ["-list", src], timeout);
    const text = await readFile(tmpTxt, "utf8");
    return buildInventory(text, parsePdfImagesList(listOut));
  }

  async #run(bin: string, args: string[], timeout: number, okCodes: number[] = [0]): Promise<string> {
    try {
      const { stdout, code } = await spawnCollect(bin, args, {
        timeoutMs: timeout,
        maxBuffer: MAX_LIST_BUFFER,
      });
      if (code === null || !okCodes.includes(code)) throw new Error(`exit ${code}`);
      return stdout;
    } catch (err) {
      const timedOut = err instanceof SpawnTimeoutError;
      log.error("figure inventory scan failed", {
        bin: path.basename(bin),
        killed: timedOut,
        msg: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      throw new Error(timedOut ? "FIGURES_SCAN_TIMEOUT" : "FIGURES_SCAN_FAILED");
    }
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

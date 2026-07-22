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

const CACHE_DIR = path.join(tmpdir(), "calibre-mcp-cache");
/** Bump when FigureEntry/matching semantics change — stale JSON must not survive. */
const INVENTORY_VERSION = 2; // v2: EPUB entries (spineHref/imageHref, svg-render source)
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
   * Unzip a local EPUB into a scratch dir, resolve container→OPF→spine, and scan
   * the spine HTML for figures (no cache, no download). DRM/corrupt zips surface
   * as FIGURES_SCAN_FAILED — unzip exits non-zero on them.
   */
  async scanEpubFile(unzip: string, src: string, timeoutMs?: number): Promise<FigureInventory> {
    const extractDir = path.join(CACHE_DIR, `ep-${randomUUID()}`);
    try {
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

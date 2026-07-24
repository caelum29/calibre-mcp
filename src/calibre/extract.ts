// Book-text extraction subsystem for calibre_get_content. Downloads a format file from
// the Content Server (GUI-safe HTTP), converts it to plain text via the best available
// backend, and caches the result so cursor-walking a book doesn't reconvert each page.
//
// Backend preference (detected at startup, logged to stderr):
//   PDF : pdftotext (poppler) > PyMuPDF (python bridge) > ebook-convert (Calibre)
//   EPUB/others : ebook-convert (--txt-output-formatting=markdown)
// Calibre has no OCR — scanned PDFs extract to empty text (the tool reports that).

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import { type FigureMarker, injectFigureMarkers } from "../domain/figures/markers.js";
import { log } from "../logging.js";
import type { GetInventoryArgs, InventoryResult } from "./figure-inventory.js";
import { downloadToFile } from "./http.js";
import { spawnCollect, SpawnMaxBufferError, SpawnTimeoutError } from "./spawn.js";

const execFileAsync = promisify(execFile);

export type PdfBackend = "pdftotext" | "pymupdf" | "ebook-convert";

export interface BackendReport {
  /** Chosen PDF extractor, or null if none is available. */
  pdf: PdfBackend | null;
  /** EPUB/other extractor (Calibre's ebook-convert), or null if missing. */
  epub: "ebook-convert" | null;
  pdftotextPath?: string;
  python3Path?: string;
  ebookConvertPath?: string;
  detectedAt: string;
}

export interface ExtractedText {
  text: string;
  backend: string;
  chars: number;
  cached: boolean;
  /** Placed image markers (D-018 Phase B); [] when the book has none or figures were unavailable. */
  markers: FigureMarker[];
  /** Inventory figures whose caption line was not found in the text (silent linkage gap signal). */
  unplaced: number;
}

/** Structural seam for the figure-inventory service — keeps the extractor testable. */
export interface InventorySource {
  getInventory(args: GetInventoryArgs): Promise<InventoryResult>;
}

export interface GetTextArgs {
  bookId: number;
  format: string;
  downloadUrl: string;
  /** Cache key — include something that changes on edit (e.g. lastModified). */
  cacheKey: string;
  maxBytes?: number;
  timeoutMs?: number;
}

const CACHE_DIR = path.join(tmpdir(), "calibre-mcp-cache");
/**
 * Bump when the extracted-text layout changes — v2: inline image markers (#84) shifted
 * every char offset, so pre-marker `.txt` cache entries must never be served again
 * (they become LRU-evicted orphans). Rides in the cache filename AND the JSON envelope.
 */
const TEXT_CACHE_VERSION = 2;
const MAX_CACHE_ENTRIES = 50;
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 120_000;

// Common install locations probed first — the MCP server may be spawned with a minimal
// PATH (e.g. from Claude Desktop) that omits Homebrew.
const PDFTOTEXT_CANDIDATES = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"];
const PYTHON_CANDIDATES = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"];

/** Extractable formats in preference order (best text structure first). */
const FORMAT_PREFERENCE = ["epub", "pdf", "txt", "azw3", "mobi", "docx", "htmlz", "fb2", "rtf"];

/** Pick a format to extract: honor `preference` if available, else first preferred present. */
export function chooseExtractFormat(formats: string[], preference?: string): string | undefined {
  const have = new Set(formats.map((f) => f.toLowerCase()));
  if (preference && have.has(preference.toLowerCase())) return preference.toLowerCase();
  for (const f of FORMAT_PREFERENCE) if (have.has(f)) return f;
  return undefined;
}

/** pdftotext argv: UTF-8 output, quiet, src → dest. */
export function pdftotextArgs(src: string, dest: string): string[] {
  return ["-q", "-enc", "UTF-8", src, dest];
}

/** Text flavors ebook-convert can emit, best structure first. */
export type TxtFormatting = "markdown" | "plain";

/** ebook-convert argv: text output. NEVER --asciiize (it transliterates Cyrillic). */
export function ebookConvertArgs(src: string, dest: string, formatting: TxtFormatting = "markdown"): string[] {
  return [src, dest, `--txt-output-formatting=${formatting}`];
}

/** Resolve a binary from candidate absolute paths, else fall back to the bare name (PATH). */
function resolveBinary(candidates: string[], bareName: string): string {
  for (const c of candidates) if (existsSync(c)) return c;
  return bareName;
}

/** True if `python3 -c "import fitz"` succeeds (PyMuPDF importable). */
async function python3HasFitz(python3: string): Promise<boolean> {
  try {
    await execFileAsync(python3, ["-c", "import fitz"], { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

export class Extractor {
  #report?: Promise<BackendReport>;

  constructor(
    private readonly cfg: Config,
    /** Optional: when present, PDF/EPUB text gets inline image markers at extraction time. */
    private readonly inventories?: InventorySource,
  ) {}

  /** Detect available extraction backends (memoized for the process lifetime). */
  detectBackends(): Promise<BackendReport> {
    if (!this.#report) this.#report = this.#detect();
    return this.#report;
  }

  async #detect(): Promise<BackendReport> {
    // ebook-convert lives beside calibredb (`.exe` on Windows). A bare "calibredb"
    // (PATH fallback, dirname ".") means probing the sibling from PATH too.
    const dbDir = path.dirname(this.cfg.calibredbPath);
    const convertName = process.platform === "win32" ? "ebook-convert.exe" : "ebook-convert";
    const ebookConvertPath = dbDir === "." ? "ebook-convert" : path.join(dbDir, convertName);
    const hasEbookConvert =
      dbDir === "." ? await binaryExists(ebookConvertPath) : existsSync(ebookConvertPath);

    const pdftotextPath = resolveBinary(PDFTOTEXT_CANDIDATES, "pdftotext");
    const hasPdftotext = PDFTOTEXT_CANDIDATES.some(existsSync) || (await binaryExists(pdftotextPath));

    const python3Path = resolveBinary(PYTHON_CANDIDATES, "python3");
    const hasFitz = await python3HasFitz(python3Path);

    let pdf: PdfBackend | null = null;
    if (hasPdftotext) pdf = "pdftotext";
    else if (hasFitz) pdf = "pymupdf";
    else if (hasEbookConvert) pdf = "ebook-convert";

    return {
      pdf,
      epub: hasEbookConvert ? "ebook-convert" : null,
      pdftotextPath: hasPdftotext ? pdftotextPath : undefined,
      python3Path: hasFitz ? python3Path : undefined,
      ebookConvertPath: hasEbookConvert ? ebookConvertPath : undefined,
      detectedAt: new Date().toISOString(),
    };
  }

  /** Cache-keyed full-text extraction (marker-injected, D-018). Returns cached text when available. */
  async getText(args: GetTextArgs): Promise<ExtractedText> {
    const report = await this.detectBackends();
    const fmt = args.format.toLowerCase();
    const cacheFile = path.join(CACHE_DIR, `${hashKey(args.cacheKey)}.v${TEXT_CACHE_VERSION}.json`);

    // Path-boundary guard: the resolved cache file must stay inside CACHE_DIR (DESIGN §5).
    if (!path.resolve(cacheFile).startsWith(path.resolve(CACHE_DIR) + path.sep)) {
      throw new Error("cache path escaped the cache directory");
    }

    if (existsSync(cacheFile)) {
      const hit = parseTextCacheEnvelope(await readFile(cacheFile, "utf8").catch(() => ""));
      if (hit) {
        const now = new Date();
        await utimes(cacheFile, now, now).catch(() => {}); // LRU touch
        // Pre-diagnostics cache entries lack the count — 0 keeps the field honest-optimistic.
        return { text: hit.text, backend: "cache", chars: hit.text.length, cached: true, markers: hit.markers, unplaced: hit.unplaced ?? 0 };
      }
      // unreadable/corrupt envelope: fall through and re-extract
    }

    await mkdir(CACHE_DIR, { recursive: true });
    const tmpSrc = path.join(CACHE_DIR, `dl-${randomUUID()}.${fmt}`);
    const tmpOut = path.join(CACHE_DIR, `tx-${randomUUID()}.txt`);
    try {
      await downloadToFile(args.downloadUrl, tmpSrc, {
        // Per-call override wins; otherwise the configured cap (callers like indexBook pass none).
        maxBytes: args.maxBytes ?? this.cfg.maxBookBytes,
        timeoutMs: args.timeoutMs,
      });
      const converted = await this.#convert(fmt, tmpSrc, tmpOut, report, args.timeoutMs);
      const { text, markers, unplaced } = await this.#injectMarkers(converted.text, fmt, args);
      const envelope: TextCacheEnvelope = { v: TEXT_CACHE_VERSION, backend: converted.backend, text, markers, unplaced };
      await writeFile(cacheFile, JSON.stringify(envelope), "utf8");
      await evictCache().catch(() => {});
      return { text, backend: converted.backend, chars: text.length, cached: false, markers, unplaced };
    } finally {
      await unlink(tmpSrc).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  }

  /**
   * Inject inline image markers into freshly extracted text (D-018 Phase B). Figures are
   * best-effort by design: a missing toolchain, an unsupported format, or a scan failure
   * degrades to plain text — extraction itself must never fail because figures did.
   */
  async #injectMarkers(
    text: string,
    fmt: string,
    args: GetTextArgs,
  ): Promise<{ text: string; markers: FigureMarker[]; unplaced: number }> {
    if (!this.inventories || (fmt !== "pdf" && fmt !== "epub") || text.trim().length === 0) {
      return { text, markers: [], unplaced: 0 };
    }
    try {
      const { inventory } = await this.inventories.getInventory({
        bookId: args.bookId,
        format: fmt,
        downloadUrl: args.downloadUrl,
        cacheKey: args.cacheKey,
        timeoutMs: args.timeoutMs,
      });
      const marked = injectFigureMarkers(text, inventory, fmt);
      if (marked.unplaced > 0) {
        log.warn("figure markers unplaced", { bookId: args.bookId, format: fmt, unplaced: marked.unplaced });
      }
      return { text: marked.text, markers: marked.markers, unplaced: marked.unplaced };
    } catch (err) {
      log.warn("figure marker injection skipped", {
        bookId: args.bookId,
        format: fmt,
        msg: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return { text, markers: [], unplaced: 0 };
    }
  }

  async #convert(
    fmt: string,
    src: string,
    out: string,
    report: BackendReport,
    timeoutMs?: number,
  ): Promise<{ text: string; backend: string }> {
    const timeout = timeoutMs ?? CONVERT_TIMEOUT_MS;

    // Plain text needs no conversion.
    if (fmt === "txt") {
      return { text: await readFile(src, "utf8"), backend: "raw" };
    }

    if (fmt === "pdf") {
      if (report.pdf === "pdftotext" && report.pdftotextPath) {
        await this.#run(report.pdftotextPath, pdftotextArgs(src, out), timeout);
        return { text: await readFile(out, "utf8"), backend: "pdftotext" };
      }
      if (report.pdf === "pymupdf" && report.python3Path) {
        await this.#run(report.python3Path, [pymupdfScriptPath(), src, out], timeout);
        return { text: await readFile(out, "utf8"), backend: "pymupdf" };
      }
      if (report.pdf === "ebook-convert" && report.ebookConvertPath) {
        return await this.#ebookConvert(report.ebookConvertPath, src, out, timeout);
      }
      throw new Error("NO_PDF_BACKEND");
    }

    // EPUB and other ebook formats → Calibre.
    if (report.epub === "ebook-convert" && report.ebookConvertPath) {
      return await this.#ebookConvert(report.ebookConvertPath, src, out, timeout);
    }
    throw new Error("NO_EPUB_BACKEND");
  }

  /**
   * ebook-convert → text, preferring markdown (headings survive, which chunking leans on) and
   * retrying once as plain. Calibre's own markdown writer throws on CSS values it can't parse to
   * a float (e.g. `calc(1em / 2)`), which would otherwise drop the whole book from the index for
   * a purely cosmetic reason. A timeout is NOT retried — that would double the time budget.
   */
  async #ebookConvert(bin: string, src: string, out: string, timeout: number): Promise<{ text: string; backend: string }> {
    try {
      await this.#run(bin, ebookConvertArgs(src, out, "markdown"), timeout);
      return { text: await readFile(out, "utf8"), backend: "ebook-convert" };
    } catch (err) {
      if ((err as Error).message !== "EXTRACT_FAILED") throw err;
      log.warn("markdown conversion failed, retrying as plain text", { src: path.basename(src) });
      await this.#run(bin, ebookConvertArgs(src, out, "plain"), timeout);
      return { text: await readFile(out, "utf8"), backend: "ebook-convert:plain" };
    }
  }

  /**
   * Run a converter. ebook-convert spawns conversion workers as grandchildren, so we go
   * through {@link spawnCollect} (process-group hard-kill on timeout) — not execFile,
   * whose timeout leaks the worker and never settles. Raw errors leak temp paths, so
   * re-throw a coded error.
   */
  async #run(bin: string, args: string[], timeout: number): Promise<void> {
    try {
      const { code } = await spawnCollect(bin, args, { timeoutMs: timeout, maxBuffer: 8 * 1024 * 1024 });
      if (code !== 0) throw new Error(`exit ${code}`);
    } catch (err) {
      const timedOut = err instanceof SpawnTimeoutError;
      log.error("extract convert failed", {
        bin: path.basename(bin),
        killed: timedOut,
        code: (err as NodeJS.ErrnoException).code,
        msg: err instanceof SpawnMaxBufferError ? "maxBuffer" : err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      throw new Error(timedOut ? "EXTRACT_TIMEOUT" : "EXTRACT_FAILED");
    }
  }
}

/** True if the binary at `bin` is runnable (non-ENOENT). pdftotext -v exits non-zero but exists. */
async function binaryExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["-v"], { timeout: 5_000 });
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** Absolute path to the bundled PyMuPDF bridge (resolved relative to this module). */
function pymupdfScriptPath(): string {
  return fileURLToPath(new URL("../../scripts/pymupdf_extract.py", import.meta.url));
}

interface TextCacheEnvelope {
  v: number;
  backend: string;
  text: string;
  markers: FigureMarker[];
  /** Optional (added post-#87 pre-flight): absent in older v2 entries — read as 0. */
  unplaced?: number;
}

/** Parse + validate a text-cache envelope; null on corruption or version mismatch. */
export function parseTextCacheEnvelope(raw: string): TextCacheEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TextCacheEnvelope>;
    if (parsed.v !== TEXT_CACHE_VERSION) return null;
    if (typeof parsed.text !== "string" || !Array.isArray(parsed.markers)) return null;
    return { v: parsed.v, backend: typeof parsed.backend === "string" ? parsed.backend : "cache", text: parsed.text, markers: parsed.markers };
  } catch {
    return null;
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** LRU sweep: drop oldest cache files when over the entry/byte caps. Best-effort. */
async function evictCache(): Promise<void> {
  const names = await readdir(CACHE_DIR).catch(() => [] as string[]);
  // .txt = extracted text; fg-*.json = figure inventories (same LRU pool, D-018).
  const files = names.filter((n) => n.endsWith(".txt") || n.endsWith(".json"));
  const entries = await Promise.all(
    files.map(async (n) => {
      const p = path.join(CACHE_DIR, n);
      const s = await stat(p).catch(() => null);
      return s ? { p, mtime: s.mtimeMs, size: s.size } : null;
    }),
  );
  const live = entries.filter((e): e is NonNullable<typeof e> => e !== null);
  let totalBytes = live.reduce((sum, e) => sum + e.size, 0);
  if (live.length <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_BYTES) return;

  live.sort((a, b) => a.mtime - b.mtime); // oldest first
  let count = live.length;
  for (const e of live) {
    if (count <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_BYTES) break;
    await unlink(e.p).catch(() => {});
    totalBytes -= e.size;
    count -= 1;
    log.debug("evicted extract cache entry", { file: path.basename(e.p) });
  }
}

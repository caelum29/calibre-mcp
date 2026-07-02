// Thin Calibre client — the only place that shells out. Kept free of any MCP
// SDK types (Clean Architecture). All invocations use execFile with an argv
// array (never a shell string) to defeat command injection (DESIGN §5).
//
// Reads/writes are routed THROUGH the running Content Server URL to respect the
// GUI-concurrency lock — never race the GUI on the on-disk DB (CLAUDE.md gotchas).

import type { Config } from "../config.js";
import { CalibreCliError, CalibreNotFoundError } from "../domain/errors.js";
import type { FtsHit } from "../domain/search.js";
import { log } from "../logging.js";
import { spawnCollect, SpawnTimeoutError } from "./spawn.js";

export interface CalibreClientOptions {
  /** Per-call timeout in ms. macOS calibredb can hang against a busy GUI. */
  timeoutMs?: number;
  /** Target library display name; defaults to config's library. */
  library?: string;
}

export interface FtsSearchOptions {
  /** Limit the search to these book ids (`--restrict-to=ids:…`). */
  restrictToIds?: number[];
  /** Return surrounding snippets (slower; `--include-snippets`). */
  snippets?: boolean;
  matchStartMarker?: string;
  matchEndMarker?: string;
  library?: string;
  timeoutMs?: number;
}

interface RawFtsHit {
  book_id?: number;
  id?: number;
  format?: string;
  text?: string;
  snippet?: string;
}

/** Build the `fts_search` argv (pure — exported for testing). Options precede the expression. */
export function buildFtsArgs(query: string, opts: FtsSearchOptions = {}): string[] {
  const args = ["fts_search", "--output-format=json"];
  if (opts.snippets) args.push("--include-snippets");
  if (opts.matchStartMarker) args.push(`--match-start-marker=${opts.matchStartMarker}`);
  if (opts.matchEndMarker) args.push(`--match-end-marker=${opts.matchEndMarker}`);
  if (opts.restrictToIds && opts.restrictToIds.length > 0) {
    args.push(`--restrict-to=ids:${opts.restrictToIds.join(",")}`);
  }
  args.push(query);
  return args;
}

/**
 * Parse `fts_search --output-format=json` stdout into domain hits (pure — exported for
 * testing). calibredb prepends an `Integration status: …` line, so we slice from the
 * first `[`; a missing array means zero hits. FTS is book-level (no page/spine location).
 */
export function parseFtsResults(stdout: string): FtsHit[] {
  const start = stdout.indexOf("[");
  if (start < 0) return []; // no array → zero hits
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    throw new CalibreCliError(null, "Could not parse full-text search results");
  }
  if (!Array.isArray(parsed)) return [];
  return (parsed as RawFtsHit[]).map((h) => ({
    bookId: h.book_id ?? h.id ?? 0,
    snippet: h.snippet ?? h.text,
    format: h.format?.toLowerCase(),
  }));
}

export class CalibreClient {
  constructor(private readonly cfg: Config) {}

  /** The `--with-library` value that routes calibredb through the live server. */
  private libraryUrl(library?: string): string {
    const lib = library || this.cfg.defaultLibrary;
    // No library anywhere → fragment-less URL, letting calibredb hit the server default.
    // Callers normally resolve the libId first (content.resolveLibraryId); this is a net.
    if (!lib) return this.cfg.serverUrl;
    return `${this.cfg.serverUrl}/#${encodeURIComponent(lib)}`;
  }

  /**
   * Run a calibredb subcommand. `args` is a literal argv array — callers never
   * interpolate user input into a shell string. A non-zero exit (or spawn failure)
   * becomes a {@link CalibreCliError} carrying stderr for caller-side classification.
   */
  async calibredb(
    args: readonly string[],
    opts: CalibreClientOptions = {},
  ): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = ["--with-library", this.libraryUrl(opts.library), ...args];
    let result;
    try {
      result = await spawnCollect(this.cfg.calibredbPath, fullArgs, {
        timeoutMs: opts.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CalibreNotFoundError(
          `calibredb not found at "${this.cfg.calibredbPath}". Install Calibre ` +
            "(https://calibre-ebook.com/download) or set CALIBRE_MCP_CALIBREDB_PATH.",
        );
      }
      // A hung child (worker grandchild) is now force-killed as a group and surfaced
      // as a settled error instead of an infinite hang (spawn.ts).
      if (err instanceof SpawnTimeoutError) {
        log.error("calibredb timed out", { args, timeoutMs: opts.timeoutMs ?? 30_000 });
        throw new CalibreCliError(null, "calibredb command timed out");
      }
      log.error("calibredb spawn failed", { args, msg: (err as Error).message });
      throw new CalibreCliError(null, "calibredb command failed");
    }
    if (result.code !== 0) {
      // Forbidden/write-refused text can land on either stream; keep both for the classifier.
      const diag = [result.stdout, result.stderr].filter(Boolean).join("\n");
      log.error("calibredb failed", { args, code: result.code, diag: diag.slice(0, 500) });
      throw new CalibreCliError(result.code, "calibredb command failed", diag);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }

  /**
   * Full-text search via `calibredb fts_search`. Returns book-level hits (FTS has no
   * page/spine location). Requires the library's FTS index to be enabled + built.
   */
  async ftsSearch(query: string, opts: FtsSearchOptions = {}): Promise<FtsHit[]> {
    // FTS (esp. with snippets) is slower than metadata calls — allow more headroom.
    const { stdout } = await this.calibredb(buildFtsArgs(query, opts), {
      library: opts.library,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    return parseFtsResults(stdout);
  }

  /** Library list as JSON, proving connectivity to the live server. */
  async listLibraries(library?: string): Promise<string> {
    const { stdout } = await this.calibredb(["list_categories", "--csv"], { library });
    return stdout;
  }
}

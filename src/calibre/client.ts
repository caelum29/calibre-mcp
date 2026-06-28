// Thin Calibre client — the only place that shells out. Kept free of any MCP
// SDK types (Clean Architecture). All invocations use execFile with an argv
// array (never a shell string) to defeat command injection (DESIGN §5).
//
// Reads/writes are routed THROUGH the running Content Server URL to respect the
// GUI-concurrency lock — never race the GUI on the on-disk DB (CLAUDE.md gotchas).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import { CalibreCliError } from "../domain/errors.js";
import type { FtsHit } from "../domain/search.js";
import { log } from "../logging.js";

const execFileAsync = promisify(execFile);

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
    const lib = library ?? this.cfg.defaultLibrary;
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
    try {
      const { stdout, stderr } = await execFileAsync(this.cfg.calibredbPath, fullArgs, {
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      // Forbidden/write-refused text can land on either stream; keep both for the classifier.
      const diag = [e.stdout, e.stderr].filter(Boolean).join("\n");
      const code = typeof e.code === "number" ? e.code : null;
      log.error("calibredb failed", { args, code, diag: diag.slice(0, 500) });
      throw new CalibreCliError(code, "calibredb command failed", diag);
    }
  }

  /**
   * Full-text search via `calibredb fts_search`. Returns book-level hits (FTS has no
   * page/spine location). Requires the library's FTS index to be enabled + built.
   */
  async ftsSearch(query: string, opts: FtsSearchOptions = {}): Promise<FtsHit[]> {
    const { stdout } = await this.calibredb(buildFtsArgs(query, opts), {
      library: opts.library,
      timeoutMs: opts.timeoutMs,
    });
    return parseFtsResults(stdout);
  }

  /** Library list as JSON, proving connectivity to the live server. */
  async listLibraries(): Promise<string> {
    const { stdout } = await this.calibredb(["list_categories", "--csv"]);
    return stdout;
  }
}

// Thin Calibre client — the only place that shells out. Kept free of any MCP
// SDK types (Clean Architecture). All invocations use execFile with an argv
// array (never a shell string) to defeat command injection (DESIGN §5).
//
// Reads/writes are routed THROUGH the running Content Server URL to respect the
// GUI-concurrency lock — never race the GUI on the on-disk DB (CLAUDE.md gotchas).

import type { Config } from "../config.js";
import {
  CalibreCliError,
  CalibreCliTimeoutError,
  CalibreNotFoundError,
  OperationCancelledError,
} from "../domain/errors.js";
import { log } from "../logging.js";
import { redactArgvEchoes, summarizeArgv } from "../call-log.js";
import type { LibraryBusyTracker } from "./busy.js";
import type { LibId } from "./lib-id.js";
import { SpawnAbortedError, spawnCollect, SpawnTimeoutError } from "./spawn.js";

export interface CalibreClientOptions {
  /** Per-call timeout in ms. macOS calibredb can hang against a busy GUI. */
  timeoutMs?: number;
  /** Target library, resolved via content.resolveLibraryId (never a display name, D-008). */
  library: LibId;
  /** Cancellation: kills the calibredb process group and throws OperationCancelledError. */
  signal?: AbortSignal;
}

/**
 * `calibredb` routed through the running Content Server (#258): library writes, plus one read,
 * `listLibraries`, that calibre_ping uses to probe the calibredb path end to end.
 */
export interface LibraryWriter {
  calibredb(args: readonly string[], opts: CalibreClientOptions): Promise<{ stdout: string; stderr: string }>;
  listLibraries(library: LibId): Promise<string>;
}

/** Shells out to `calibredb` (routed through the Content Server URL) and Calibre CLI tools. */
export class CalibreClient implements LibraryWriter {
  /** `busy` is the per-library breaker shared with ContentServerClient; absent = no breaker (tests). */
  constructor(
    private readonly cfg: Config,
    private readonly busy?: LibraryBusyTracker,
  ) {}

  /** The `--with-library` value that routes calibredb through the live server. */
  private libraryUrl(library: LibId): string {
    return `${this.cfg.serverUrl}/#${encodeURIComponent(library)}`;
  }

  /**
   * Run a calibredb subcommand. `args` is a literal argv array — callers never
   * interpolate user input into a shell string. A non-zero exit (or spawn failure)
   * becomes a {@link CalibreCliError} carrying stderr for caller-side classification.
   */
  async calibredb(args: readonly string[], opts: CalibreClientOptions): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = ["--with-library", this.libraryUrl(opts.library), ...args];
    // Fail fast instead of queueing behind a stalled request (calibre/busy.ts).
    this.busy?.assertAvailable(opts.library);
    let result;
    try {
      result = await spawnCollect(this.cfg.calibredbPath, fullArgs, {
        timeoutMs: opts.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
        signal: opts.signal,
      });
    } catch (err) {
      // a timeout re-arms the breaker below; any other failure must not leave the probe slot taken
      this.busy?.releaseProbe(opts.library);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CalibreNotFoundError(
          `calibredb not found at "${this.cfg.calibredbPath}". Install Calibre ` +
            "(https://calibre-ebook.com/download) or set CALIBRE_MCP_CALIBREDB_PATH.",
        );
      }
      if (err instanceof SpawnAbortedError) {
        log.info("calibredb cancelled", { argv: summarizeArgv(args) });
        throw new OperationCancelledError();
      }
      // A hung child (worker grandchild) is now force-killed as a group and surfaced
      // as a settled error instead of an infinite hang (spawn.ts).
      if (err instanceof SpawnTimeoutError) {
        log.error("calibredb timed out", { argv: summarizeArgv(args), timeoutMs: opts.timeoutMs ?? 30_000 });
        this.busy?.markBusy(opts.library, "calibredb");
        // Timeout subclass: for routed writes the server may have committed already,
        // so write tools must verify rather than assume failure (issue #33).
        throw new CalibreCliTimeoutError("calibredb command timed out");
      }
      log.error("calibredb spawn failed", { argv: summarizeArgv(args), msg: (err as Error).message });
      throw new CalibreCliError(null, "calibredb command failed");
    }
    if (result.code !== 0) {
      // Forbidden/write-refused text can land on either stream; keep both for the classifier.
      const diag = [result.stdout, result.stderr].filter(Boolean).join("\n");
      // The server answered (an exit code is a reply), so the library isn't stalled.
      this.busy?.markOk(opts.library);
      log.error("calibredb failed", {
        argv: summarizeArgv(args),
        code: result.code,
        diag: redactArgvEchoes(diag, args).slice(0, 500),
      });
      throw new CalibreCliError(result.code, "calibredb command failed", diag);
    }
    this.busy?.markOk(opts.library);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  /** Library list as JSON, proving connectivity to the live server. */
  async listLibraries(library: LibId): Promise<string> {
    const { stdout } = await this.calibredb(["list_categories", "--csv"], { library });
    return stdout;
  }
}

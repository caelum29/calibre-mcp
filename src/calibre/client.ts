// Thin Calibre client — the only place that shells out. Kept free of any MCP
// SDK types (Clean Architecture). All invocations use execFile with an argv
// array (never a shell string) to defeat command injection (DESIGN §5).
//
// Reads/writes are routed THROUGH the running Content Server URL to respect the
// GUI-concurrency lock — never race the GUI on the on-disk DB (CLAUDE.md gotchas).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";

const execFileAsync = promisify(execFile);

export interface CalibreClientOptions {
  /** Per-call timeout in ms. macOS calibredb can hang against a busy GUI. */
  timeoutMs?: number;
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
   * interpolate user input into a shell string.
   */
  async calibredb(
    args: readonly string[],
    opts: CalibreClientOptions = {},
  ): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = ["--with-library", this.libraryUrl(), ...args];
    const { stdout, stderr } = await execFileAsync(
      this.cfg.calibredbPath,
      fullArgs,
      { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return { stdout, stderr };
  }

  /** Library list as JSON, proving connectivity to the live server. */
  async listLibraries(): Promise<string> {
    const { stdout } = await this.calibredb(["list_categories", "--csv"]);
    return stdout;
  }
}
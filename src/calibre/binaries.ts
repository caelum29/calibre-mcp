// External-binary discovery and one-shot tool runs (poppler, unzip, sips, python3...). The
// single home for candidate paths and spawn-error mapping; process mechanics stay in spawn.ts.

import { existsSync } from "node:fs";
import path from "node:path";
import { OperationCancelledError } from "../domain/errors.js";
import { log } from "../logging.js";
import { SpawnAbortedError, spawnCollect, SpawnMaxBufferError, SpawnTimeoutError } from "./spawn.js";

// Common install locations (Homebrew, /usr/local, system) probed first: the MCP server may be spawned with a minimal PATH
// (e.g. from Claude Desktop) that omits Homebrew.
const standardDirs = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];

const CANDIDATES = {
  pdftotext: standardDirs("pdftotext"),
  pdftohtml: standardDirs("pdftohtml"),
  pdfimages: standardDirs("pdfimages"),
  pdftoppm: standardDirs("pdftoppm"),
  python3: standardDirs("python3"),
  unzip: ["/usr/bin/unzip", "/opt/homebrew/bin/unzip", "/usr/local/bin/unzip"],
  sips: ["/usr/bin/sips"],
  qlmanage: ["/usr/bin/qlmanage"],
} as const;

/** Names of the external binaries we know how to locate. */
export type BinName = keyof typeof CANDIDATES;

// Only hits are cached: a miss re-probes (3 existsSync) so a mid-session install is picked up.
const found = new Map<BinName, string>();

/** First existing candidate path for `name` (memoized once found), or null when not installed. */
export function findBin(name: BinName): string | null {
  const hit = found.get(name);
  if (hit) return hit;
  const path = CANDIDATES[name].find((c) => existsSync(c)) ?? null;
  if (path) found.set(name, path);
  return path;
}

export interface RunToolOptions {
  timeoutMs: number;
  maxBuffer: number;
  signal?: AbortSignal;
  /** Exit codes treated as success (default `[0]`). */
  okCodes?: readonly number[];
  /** Coded `Error.message` thrown on spawn failure / bad exit. */
  failedCode: string;
  /** Coded `Error.message` thrown on timeout. */
  timeoutCode: string;
  /** Log line for a failure (the raw error leaks temp paths, so only the coded error is thrown). */
  logMessage: string;
}

/**
 * Run a converter/scanner to completion and return stdout. Goes through {@link spawnCollect}
 * (process-group hard-kill on timeout). Abort → {@link OperationCancelledError}; timeout →
 * `timeoutCode`; anything else (spawn error, bad exit, maxBuffer) → `failedCode`.
 */
export async function runTool(bin: string, args: readonly string[], opts: RunToolOptions): Promise<string> {
  try {
    const { stdout, code } = await spawnCollect(bin, args, {
      timeoutMs: opts.timeoutMs,
      maxBuffer: opts.maxBuffer,
      signal: opts.signal,
    });
    if (code === null || !(opts.okCodes ?? [0]).includes(code)) throw new Error(`exit ${code}`);
    return stdout;
  } catch (err) {
    if (err instanceof SpawnAbortedError) throw new OperationCancelledError();
    const timedOut = err instanceof SpawnTimeoutError;
    log.error(opts.logMessage, {
      bin: path.basename(bin),
      killed: timedOut,
      code: (err as NodeJS.ErrnoException).code,
      msg:
        err instanceof SpawnMaxBufferError
          ? "maxBuffer"
          : err instanceof Error
            ? err.message.slice(0, 300)
            : String(err),
    });
    throw new Error(timedOut ? opts.timeoutCode : opts.failedCode);
  }
}

/**
 * Probe a binary: `ok` = exit 0, `missing` = not runnable (ENOENT), `failed` = ran but exited
 * non-zero, timed out or errored otherwise. Never throws.
 */
export async function probeTool(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<"ok" | "failed" | "missing"> {
  try {
    const { code } = await spawnCollect(bin, args, { timeoutMs, maxBuffer: 1024 * 1024 });
    return code === 0 ? "ok" : "failed";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed";
  }
}

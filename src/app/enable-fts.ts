// Use case for calibre_build_index's enableFts (#447): turn on Calibre's own full-text indexing
// for a library through the routed write path. Enable-only; Calibre indexes in the background.
// Business context: `fts_index enable` prints the same text whether or not FTS was already on,
// so "already enabled" is detected with `fts_index status` first (exit 2 there = disabled).

import type { CalibreClientOptions, LibraryWriter } from "../calibre/client.js";
import type { LibId } from "../calibre/lib-id.js";
import { defaultHint } from "../domain/error-codes.js";
import { stripCalibredbBanner } from "../domain/calibredb-banner.js";
import { CalibreCliError } from "../domain/errors.js";

/** The outcome of the FTS part of a build. */
export interface FtsOutcome {
  status: "write_disabled" | "enabled" | "already_enabled" | "failed";
  /** What Calibre said about indexing progress (e.g. `0 of 144 books files indexed`), if it said. */
  progress?: string;
  /** Why it failed, or the remedy when the write gate is off. */
  detail?: string;
}

/** Calibre's CLI prefixes every stdout with a banner; drop it and blank lines. */
function lines(stdout: string): string[] {
  return stripCalibredbBanner(stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** The "N of M books files indexed" line, if present. */
function progressLine(stdout: string): string | undefined {
  return lines(stdout).find((l) => /\d+ of \d+/.test(l));
}

/**
 * Enable FTS for `library`. With the write gate off nothing is spawned. Never throws: a failed
 * enable must not fail the semantic build, so it comes back as `status: "failed"`.
 */
export async function enableFts(
  deps: { calibre: LibraryWriter; writeEnabled: boolean },
  library: LibId,
  signal?: AbortSignal,
): Promise<FtsOutcome> {
  if (!deps.writeEnabled) {
    return {
      status: "write_disabled",
      detail: `${defaultHint("write_disabled") ?? ""}; or enable FTS in the Calibre GUI (the FT button left of the search bar)`,
    };
  }
  const opts = { library, ...(signal ? { signal } : {}) };
  try {
    try {
      const status = await deps.calibre.calibredb(["fts_index", "status"], opts);
      if (lines(status.stdout).some((l) => /is enabled/i.test(l))) {
        const progress = progressLine(status.stdout);
        return { status: "already_enabled", ...(progress ? { progress } : {}) };
      }
    } catch (err) {
      // `status` exits 2 on a disabled library: a state, not an error. Anything else is one.
      if (!(err instanceof CalibreCliError && err.code === 2)) throw err;
    }
    const { stdout } = await deps.calibre.calibredb(["fts_index", "enable"], opts);
    const progress = progressLine(stdout);
    return { status: "enabled", ...(progress ? { progress } : {}) };
  } catch (err) {
    if (signal?.aborted) throw err;
    // A routed write can commit before calibredb replies (timeout, dropped connection): look
    // once more before calling it a failure (never report a committed write as failed).
    if (await isEnabled(deps.calibre, opts)) return { status: "enabled" };
    return {
      status: "failed",
      detail: `${err instanceof Error ? err.message : String(err)}; check with calibre_ping or Calibre's FT button (left of the search bar)`,
    };
  }
}

/** True when `fts_index status` says FTS is on; any error (incl. exit 2 = off) counts as not enabled. */
async function isEnabled(calibre: LibraryWriter, opts: CalibreClientOptions): Promise<boolean> {
  try {
    const { stdout } = await calibre.calibredb(["fts_index", "status"], opts);
    return lines(stdout).some((l) => /is enabled/i.test(l));
  } catch {
    return false;
  }
}

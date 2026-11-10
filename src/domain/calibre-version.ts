// The Calibre version, read from `calibredb --version` (#499, D-029). Calibre 9.18 added the
// commands behind annotations and notes, so those calls check it first. SDK-free.

import { stripCalibredbBanner } from "./calibredb-banner.js";

/** A parsed Calibre version; `text` is what Calibre printed (`9.18`, `9.18.1`). */
export interface CalibreVersion {
  text: string;
  major: number;
  minor: number;
  patch: number;
}

/** A version, or "unknown" when calibredb could not be run or its output not parsed. */
export type CalibreVersionInfo = CalibreVersion | "unknown";

// `calibredb (calibre 9.18)`; calibredb may print unrelated lines first ("Integration status: False").
const VERSION_LINE = /\(calibre (\d+)\.(\d+)(?:\.(\d+))?\)/;

/** Parse `calibredb --version` stdout; "unknown" when no version line is found. */
export function parseCalibreVersion(stdout: string): CalibreVersionInfo {
  const m = VERSION_LINE.exec(stripCalibredbBanner(stdout));
  if (!m) return "unknown";
  const [, major, minor, patch] = m;
  return {
    text: patch === undefined ? `${major}.${minor}` : `${major}.${minor}.${patch}`,
    major: Number(major),
    minor: Number(minor),
    patch: patch === undefined ? 0 : Number(patch),
  };
}

/** True when `v` is `min` (`"9.18"`) or newer, compared numerically (9.9 < 9.18). */
export function isAtLeast(v: CalibreVersion, min: string): boolean {
  const [maj = 0, mnr = 0, pat = 0] = min.split(".").map(Number);
  if (v.major !== maj) return v.major > maj;
  if (v.minor !== mnr) return v.minor > mnr;
  return v.patch >= pat;
}

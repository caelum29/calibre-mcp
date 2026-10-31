// Sub-book progress for calibre_build_index (#245): maps one book's phases onto the fraction
// of its whole-book step, and keeps a heartbeat going through long silent phases (a big
// PDF's extraction or chunking can run tens of seconds) so progress-resetting clients don't
// time out before the first embed slice reports.

import type { BookPhase } from "../app/index-book.js";

/** Heartbeat period during extract/chunk — well under the ~60 s client request timeout. */
export const HEARTBEAT_MS = 10_000;

/** Each heartbeat phase owns [start, ceiling) of the book's step; embed takes the rest. */
const RANGES = { extract: [0.02, 0.05], chunk: [0.05, 0.1] } as const;

export interface BookProgress {
  onPhase: (p: BookPhase) => void;
  /** Clear the heartbeat — call in `finally`, whatever the book's outcome. */
  stop: () => void;
}

/**
 * Progress callbacks for one book whose whole-book step runs from `base` to `base + 1`.
 * Every value stays below `base + 1`, so the caller's "Indexed k/N" step lands on the integer.
 */
export function bookProgress(
  report: (progress: number, message: string) => void,
  base: number,
  label: string,
): BookProgress {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  return {
    stop,
    onPhase(p) {
      stop();
      if (p.phase === "embed") {
        report(base + 0.1 + 0.85 * (p.done / p.total), `${label}: embedding ${p.done}/${p.total} chunks`);
        return;
      }
      const [lo, hi] = RANGES[p.phase];
      const what = p.phase === "extract" ? "extracting text" : "chunking";
      const started = Date.now();
      report(base + lo, `${label}: ${what}`);
      let beats = 0;
      // Approaches the ceiling without reaching it: the reporter drops non-increasing values,
      // and the next phase must still read as progress.
      timer = setInterval(() => {
        beats++;
        const secs = Math.round((Date.now() - started) / 1000);
        report(base + lo + (hi - lo) * (beats / (beats + 1)), `${label}: ${what} (${secs} s)`);
      }, HEARTBEAT_MS);
      timer.unref?.();
    },
  };
}

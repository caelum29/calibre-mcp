// Per-library registry of running index builds (#284). Some clients never reset their request
// timeout on progress, so a long build returns a "still running" result at a soft deadline and
// keeps committing in the background; the registry keeps one build per library at a time.

/**
 * Soft deadline for one calibre_build_index call: under the MCP SDK client's 60 s
 * DEFAULT_REQUEST_TIMEOUT_MSEC, leaving margin for the result to travel. Guess; tune in #284
 * once the real-client timeout check is in.
 */
export const BUILD_SOFT_DEADLINE_MS = 45_000;

/** Options for {@link IndexBuildRegistry}; the deadline is injectable so tests run in ms. */
export interface IndexBuildRegistryOptions {
  softDeadlineMs?: number;
}

/** The port calibre_build_index uses: single-flight builds per library under a soft deadline. */
export interface IndexBuilds {
  readonly softDeadlineMs: number;
}

/** One registry per server process: at most one build per library, results kept for the re-run. */
export class IndexBuildRegistry implements IndexBuilds {
  readonly softDeadlineMs: number;

  constructor(opts: IndexBuildRegistryOptions = {}) {
    this.softDeadlineMs = opts.softDeadlineMs ?? BUILD_SOFT_DEADLINE_MS;
  }
}

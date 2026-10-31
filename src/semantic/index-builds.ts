// Per-library registry of running index builds (#284). Some clients never reset their request
// timeout on progress, so a long build returns a "still running" result at a soft deadline and
// keeps committing in the background; the registry keeps one build per library at a time.

import type { LogSink } from "../logging.js";

/**
 * Soft deadline for one calibre_build_index call: under the MCP SDK client's 60 s
 * DEFAULT_REQUEST_TIMEOUT_MSEC, leaving margin for the result to travel. Guess; tune in #284
 * once the real-client timeout check is in.
 */
export const BUILD_SOFT_DEADLINE_MS = 45_000;

/** Finished background results kept for a re-run; bounded so unclaimed ones can't pile up. */
const KEPT_RESULTS = 16;

/** Live snapshot of one build, shared with every call that finds it running. */
export interface BuildProgress {
  /** Books settled so far (indexed, skipped or failed). */
  done: number;
  /** Books selected; 0 while the selection is still being resolved. */
  total: number;
  /** Books committed so far, in commit order. */
  indexedIds: number[];
}

/** Handle the build function gets: progress to update, and whether its caller already returned. */
export interface BuildRun {
  readonly progress: BuildProgress;
  /** True once the starting call returned early: the request is closed, so send no progress. */
  detached(): boolean;
}

/** What one call gets back from {@link IndexBuilds.run}. */
export type BuildOutcome<T> =
  | {
      kind: "done";
      result: T;
      /** Set when the result belongs to a build an earlier call started (ms since it finished). */
      earlierCallFinishedAgoMs?: number;
    }
  | {
      kind: "running";
      progress: BuildProgress;
      /** False when the running build was started for a different selector. */
      sameSelector: boolean;
    };

/** The port calibre_build_index uses: single-flight builds per library under a soft deadline. */
export interface IndexBuilds<T> {
  readonly softDeadlineMs: number;
  /**
   * Run `build` for `libraryId` unless a build is already running there; wait for the running
   * build (or the new one) until the soft deadline, then report "running" instead of blocking.
   * `key` identifies the selector, so a re-run of the same call claims the result of its build.
   * `signal` ends only this call's wait — the build itself watches its own signal.
   */
  run(
    libraryId: string,
    key: string,
    build: (run: BuildRun) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<BuildOutcome<T>>;
}

/** Options for {@link IndexBuildRegistry}; the deadline and clock are injectable for tests. */
export interface IndexBuildRegistryOptions {
  softDeadlineMs?: number;
  log?: LogSink;
  now?: () => number;
}

interface Entry<T> {
  key: string;
  progress: BuildProgress;
  detached: boolean;
  settled: boolean;
  result?: { value: T };
  done: Promise<void>;
}

/** One registry per server process: at most one build per library, results kept for the re-run. */
export class IndexBuildRegistry<T> implements IndexBuilds<T> {
  readonly softDeadlineMs: number;
  private readonly log: LogSink | undefined;
  private readonly now: () => number;
  private readonly running = new Map<string, Entry<T>>();
  private readonly kept = new Map<string, { value: T; at: number }>();

  constructor(opts: IndexBuildRegistryOptions = {}) {
    this.softDeadlineMs = opts.softDeadlineMs ?? BUILD_SOFT_DEADLINE_MS;
    this.log = opts.log;
    this.now = opts.now ?? Date.now;
  }

  async run(
    libraryId: string,
    key: string,
    build: (run: BuildRun) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<BuildOutcome<T>> {
    const deadline = this.now() + this.softDeadlineMs;
    const keptKey = `${libraryId}\u0000${key}`;
    for (;;) {
      const kept = this.kept.get(keptKey);
      if (kept) {
        this.kept.delete(keptKey);
        return { kind: "done", result: kept.value, earlierCallFinishedAgoMs: this.now() - kept.at };
      }
      const cur = this.running.get(libraryId);
      if (!cur) return this.start(libraryId, key, keptKey, build, deadline);
      const settled = (await this.waitUntil(cur.done, deadline, signal)) || cur.settled;
      if (!settled) return { kind: "running", progress: snapshot(cur.progress), sameSelector: cur.key === key };
      if (cur.key === key && cur.result) {
        // Same selector: the build this call waited for is its answer, so nobody re-reports it.
        this.kept.delete(keptKey);
        return { kind: "done", result: cur.result.value, earlierCallFinishedAgoMs: 0 };
      }
      // A different build finished in time: loop to start ours, or to wait on whoever started first.
    }
  }

  private async start(
    libraryId: string,
    key: string,
    keptKey: string,
    build: (run: BuildRun) => Promise<T>,
    deadline: number,
  ): Promise<BuildOutcome<T>> {
    const entry: Entry<T> = {
      key,
      progress: { done: 0, total: 0, indexedIds: [] },
      detached: false,
      settled: false,
      done: Promise.resolve(),
    };
    let failure: unknown;
    let failed = false;
    const startedAt = this.now();
    // Registered before the first await, so a concurrent call always sees this build.
    this.running.set(libraryId, entry);
    entry.done = build({ progress: entry.progress, detached: () => entry.detached })
      .then(
        (value) => {
          entry.result = { value };
        },
        (err: unknown) => {
          failed = true;
          failure = err;
        },
      )
      .finally(() => {
        entry.settled = true;
        if (this.running.get(libraryId) === entry) this.running.delete(libraryId);
        if (!entry.detached) return;
        const elapsedMs = this.now() - startedAt;
        if (entry.result) {
          this.keep(keptKey, entry.result.value);
          this.log?.info("background index build finished", { done: entry.progress.done, elapsedMs });
        } else {
          this.log?.warn("background index build failed", { elapsedMs, reason: String(failure) });
        }
      });

    const settled = (await this.waitUntil(entry.done, deadline)) || entry.settled;
    if (!settled) {
      entry.detached = true;
      return { kind: "running", progress: snapshot(entry.progress), sameSelector: true };
    }
    if (failed) throw failure;
    // settled && !failed means the build resolved, so result is set.
    return { kind: "done", result: (entry.result as { value: T }).value };
  }

  private keep(keptKey: string, value: T): void {
    this.kept.delete(keptKey);
    this.kept.set(keptKey, { value, at: this.now() });
    // Map iteration is insertion order, so the first key is the oldest unclaimed result.
    while (this.kept.size > KEPT_RESULTS) this.kept.delete(this.kept.keys().next().value as string);
  }

  /** True if `p` settles before `deadline`; false at the deadline or when `signal` aborts. */
  private waitUntil(p: Promise<void>, deadline: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      // unref: a pending deadline must never keep the process alive on shutdown.
      const timer = setTimeout(() => finish(false), Math.max(0, deadline - this.now()));
      timer.unref?.();
      const onAbort = () => finish(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      function finish(v: boolean) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      }
      // p never rejects (start() catches the build's rejection), so this handler is the whole story.
      void p.then(() => finish(true));
    });
  }
}

function snapshot(p: BuildProgress): BuildProgress {
  return { done: p.done, total: p.total, indexedIds: [...p.indexedIds] };
}

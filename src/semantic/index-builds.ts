// Per-library registry of running index builds (#284). Some clients never reset their request
// timeout on progress, so a long build returns a "still running" result at a soft deadline and
// keeps committing in the background; the registry keeps one build per library at a time.

import type { LogSink } from "../logging.js";
import { TOOL_SOFT_DEADLINE_MS } from "../shared/deadline.js";

/** Soft deadline for one calibre_build_index call — the shared per-tool-call budget. */
export const BUILD_SOFT_DEADLINE_MS = TOOL_SOFT_DEADLINE_MS;

/** Finished background results kept for a re-run; bounded so unclaimed ones can't pile up. */
const KEPT_RESULTS = 16;

/**
 * How long a background result stays claimable. A re-run minutes later wants that report;
 * one days later wants a fresh build that picks up new books. Guess, tune in #284.
 */
export const KEPT_RESULT_TTL_MS = 5 * 60_000;

/** Live snapshot of one build, shared with every call that finds it running. */
export interface BuildProgress {
  /** Books settled so far (indexed, skipped or failed). */
  done: number;
  /** Books selected; 0 while the selection is still being resolved. */
  total: number;
  /** Books committed so far, in commit order. */
  indexedIds: number[];
  /** Books selected, once resolved — lets a refused call tell whether its books are covered. */
  selectedIds: number[];
  /** Books that failed so far, as `book <id>: <reason>` lines, in the order they failed. */
  failures: string[];
  /** The build's flags that change what it does to a book (force, keywordOnly…); opaque here. */
  mode: string;
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
      /** A background build an earlier call started threw; `error` is why (never kept past the TTL). */
      kind: "failed";
      error: unknown;
      earlierCallFinishedAgoMs: number;
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
   * `opts.signal` ends only this call's wait — the build itself watches its own signal.
   * `opts.keep` says whether a result may be handed to a later call (a cancelled build's may not).
   */
  run(
    libraryId: string,
    key: string,
    build: (run: BuildRun) => Promise<T>,
    opts?: RunOptions<T>,
  ): Promise<BuildOutcome<T>>;
}

/** Per-call options for {@link IndexBuilds.run}. */
export interface RunOptions<T> {
  signal?: AbortSignal | undefined;
  /** False for results a later call must not inherit; default keeps every result. */
  keep?: (value: T) => boolean;
}

/** Options for {@link IndexBuildRegistry}; the deadline and clock are injectable for tests. */
export interface IndexBuildRegistryOptions {
  softDeadlineMs?: number;
  keptTtlMs?: number;
  log?: LogSink;
  now?: () => number;
}

interface Entry<T> {
  key: string;
  progress: BuildProgress;
  detached: boolean;
  settled: boolean;
  result?: { value: T };
  failure?: { error: unknown };
  keep: (value: T) => boolean;
  done: Promise<void>;
}

type Kept<T> = { at: number } & ({ value: T } | { error: unknown });

/** One registry per server process: at most one build per library, results kept for the re-run. */
export class IndexBuildRegistry<T> implements IndexBuilds<T> {
  readonly softDeadlineMs: number;
  private readonly keptTtlMs: number;
  private readonly log: LogSink | undefined;
  private readonly now: () => number;
  private readonly running = new Map<string, Entry<T>>();
  private readonly kept = new Map<string, Kept<T>>();

  constructor(opts: IndexBuildRegistryOptions = {}) {
    this.softDeadlineMs = opts.softDeadlineMs ?? BUILD_SOFT_DEADLINE_MS;
    this.keptTtlMs = opts.keptTtlMs ?? KEPT_RESULT_TTL_MS;
    this.log = opts.log;
    this.now = opts.now ?? Date.now;
  }

  async run(
    libraryId: string,
    key: string,
    build: (run: BuildRun) => Promise<T>,
    opts: RunOptions<T> = {},
  ): Promise<BuildOutcome<T>> {
    const deadline = this.now() + this.softDeadlineMs;
    const keptKey = `${libraryId}\u0000${key}`;
    const keep = opts.keep ?? (() => true);
    for (;;) {
      const claimed = this.claim(keptKey);
      if (claimed) return claimed;
      const cur = this.running.get(libraryId);
      if (!cur) return this.start(libraryId, key, keptKey, build, keep, deadline);
      const settled = (await this.waitUntil(cur.done, deadline, opts.signal)) || cur.settled;
      if (!settled) return { kind: "running", progress: snapshot(cur.progress), sameSelector: cur.key === key };
      if (cur.key === key && cur.result && cur.keep(cur.result.value)) {
        // Same selector: the build this call waited for is its answer, so nobody re-reports it.
        this.kept.delete(keptKey);
        return { kind: "done", result: cur.result.value, earlierCallFinishedAgoMs: 0 };
      }
      // A different (or failed/cancelled) build settled in time: loop to claim its kept failure,
      // start ours, or wait on whoever started first.
    }
  }

  /** The kept outcome for this selector, consumed once; past the TTL it is dropped instead. */
  private claim(keptKey: string): BuildOutcome<T> | undefined {
    const kept = this.kept.get(keptKey);
    if (!kept) return undefined;
    this.kept.delete(keptKey);
    const agoMs = this.now() - kept.at;
    if (agoMs > this.keptTtlMs) return undefined;
    return "value" in kept
      ? { kind: "done", result: kept.value, earlierCallFinishedAgoMs: agoMs }
      : { kind: "failed", error: kept.error, earlierCallFinishedAgoMs: agoMs };
  }

  private async start(
    libraryId: string,
    key: string,
    keptKey: string,
    build: (run: BuildRun) => Promise<T>,
    keep: (value: T) => boolean,
    deadline: number,
  ): Promise<BuildOutcome<T>> {
    const entry: Entry<T> = {
      key,
      progress: { done: 0, total: 0, indexedIds: [], selectedIds: [], failures: [], mode: "" },
      detached: false,
      settled: false,
      keep,
      done: Promise.resolve(),
    };
    const startedAt = this.now();
    // A synchronous throw becomes a rejection, so the finally below always frees the library.
    let started: Promise<T>;
    try {
      started = build({ progress: entry.progress, detached: () => entry.detached });
    } catch (err) {
      started = Promise.reject(err);
    }
    // Registered before the first await, so a concurrent call always sees this build.
    this.running.set(libraryId, entry);
    entry.done = started
      .then(
        (value) => {
          entry.result = { value };
        },
        (error: unknown) => {
          entry.failure = { error };
        },
      )
      .finally(() => {
        entry.settled = true;
        if (this.running.get(libraryId) === entry) this.running.delete(libraryId);
        if (!entry.detached) return;
        const elapsedMs = this.now() - startedAt;
        if (entry.result) {
          // A cancelled build is not an answer: the next call should build, not inherit it.
          if (keep(entry.result.value)) this.store(keptKey, { value: entry.result.value });
          this.log?.info("background index build finished", { done: entry.progress.done, elapsedMs });
        } else if (entry.failure) {
          // Kept so the re-run can tell the model why — a log line alone never reaches it.
          this.store(keptKey, { error: entry.failure.error });
          this.log?.warn("background index build failed", { elapsedMs, reason: String(entry.failure.error) });
        }
      });

    const settled = (await this.waitUntil(entry.done, deadline)) || entry.settled;
    if (!settled) {
      entry.detached = true;
      return { kind: "running", progress: snapshot(entry.progress), sameSelector: true };
    }
    if (entry.failure) throw entry.failure.error;
    // Settled without a failure means the build resolved, so result is set.
    return { kind: "done", result: (entry.result as { value: T }).value };
  }

  private store(keptKey: string, outcome: { value: T } | { error: unknown }): void {
    this.kept.delete(keptKey);
    this.kept.set(keptKey, { ...outcome, at: this.now() });
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
  return {
    done: p.done,
    total: p.total,
    indexedIds: [...p.indexedIds],
    selectedIds: [...p.selectedIds],
    failures: [...p.failures],
    mode: p.mode,
  };
}

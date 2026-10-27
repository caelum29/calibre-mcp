// Progress reporting for long tool calls (MCP notifications/progress). SDK-free: server.ts
// adapts the SDK's sendNotification into `send`. The reporter enforces what the spec asks of
// a sender and what clients tolerate: progress strictly increases, notifications are
// throttled, and a failed send never fails the tool call.

export interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export interface ProgressReporterOptions {
  progressToken: string | number;
  send: (params: ProgressNotification) => Promise<void>;
  /** Minimum gap between notifications; the final one (progress === total) always goes out. */
  minIntervalMs?: number;
  now?: () => number;
  onError?: (err: unknown) => void;
}

/**
 * Build a `progress(progress, message, total?)` callback for one request. Calls that would
 * not increase progress are dropped (the spec requires monotonic progress); calls inside the
 * throttle window are dropped unless they complete the task.
 */
export function createProgressReporter(
  opts: ProgressReporterOptions,
): (progress: number, message: string, total?: number) => void {
  const minIntervalMs = opts.minIntervalMs ?? 100;
  const now = opts.now ?? Date.now;
  let last = Number.NEGATIVE_INFINITY;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  return (progress, message, total) => {
    if (!Number.isFinite(progress) || progress <= last) return;
    const done = total !== undefined && progress >= total;
    const t = now();
    if (!done && t - lastSentAt < minIntervalMs) return;
    last = progress;
    lastSentAt = t;
    const params: ProgressNotification = { progressToken: opts.progressToken, progress, message };
    if (total !== undefined) params.total = total;
    opts.send(params).catch((err: unknown) => opts.onError?.(err));
  };
}

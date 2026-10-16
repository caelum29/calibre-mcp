// Process-group-aware subprocess runner. The one place we own child-process
// mechanics so client.ts / extract.ts stay focused on error mapping.
//
// Why not execFile's `timeout`: Node kills only the DIRECT child on timeout and
// then waits for stdio EOF. `calibredb add` (and `ebook-convert`) routed through
// the Content Server spawn an import/conversion WORKER as a grandchild that
// inherits the stdout/stderr pipes — so the promise never settles and the orphan
// keeps the library write lock. We spawn `detached` (child becomes a group leader)
// and hard-kill the whole GROUP on timeout, taking the worker down too.
//
// Because the groups are detached, they would also OUTLIVE this server if it exits
// mid-call (client closes stdin, SIGTERM) and keep holding the library lock. Every live
// group is tracked here so the transport's shutdown can kill them (killAllChildren).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null if it was terminated by a signal. */
  code: number | null;
}

export interface SpawnCollectOptions {
  timeoutMs: number;
  /** Byte cap per stream; over it we kill the group and reject (execFile parity). */
  maxBuffer: number;
  /**
   * Cancellation (e.g. the MCP client cancelled the request). On abort the whole process
   * group is SIGKILLed and the promise rejects with {@link SpawnAbortedError}; an
   * already-aborted signal rejects without spawning.
   */
  signal?: AbortSignal;
}

/** Timed out and the process group was force-killed. Distinct so callers don't
 *  misclassify a hang as a normal non-zero exit. */
export class SpawnTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnTimeoutError";
  }
}

/** The caller's AbortSignal fired; the process group was killed. */
export class SpawnAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnAbortedError";
  }
}

/** Output exceeded maxBuffer; the group was killed. */
export class SpawnMaxBufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnMaxBufferError";
  }
}

/** Children whose process group may still be running (added on spawn, removed on close). */
const liveChildren = new Set<ChildProcess>();

/**
 * SIGKILL `child`'s whole process group (worker grandchild included); fall back to the
 * lone child. On Windows (no POSIX groups) `taskkill /T` kills the tree by pid — run
 * synchronously when the caller is about to exit, so the kill is not lost with us.
 */
function killTree(child: ChildProcess, sync: boolean): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      const taskkillArgs = ["/pid", String(pid), "/T", "/F"];
      if (sync) spawnSync("taskkill", taskkillArgs, { stdio: "ignore", timeout: 5_000 });
      else spawn("taskkill", taskkillArgs, { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Group gone already, or race with natural exit — try the direct child.
    try {
      child.kill("SIGKILL");
    } catch {
      /* nothing left to kill */
    }
  }
}

/**
 * Kill every process group spawned by {@link spawnCollect} that has not exited yet.
 * Synchronous and idempotent — meant for the shutdown path right before process exit.
 * Returns how many groups were signalled.
 */
export function killAllChildren(): number {
  const n = liveChildren.size;
  for (const child of liveChildren) killTree(child, true);
  liveChildren.clear();
  return n;
}

/**
 * Spawn `bin` with a literal argv array (never a shell string) and collect its
 * output. Resolves `{ stdout, stderr, code }` for ANY exit code — the caller
 * decides what a non-zero code means. Rejects on spawn failure (preserving
 * `.code === "ENOENT"`), on timeout ({@link SpawnTimeoutError}), or on maxBuffer
 * overflow ({@link SpawnMaxBufferError}). On timeout/overflow the whole process
 * group is SIGKILLed so no worker grandchild is left holding the DB lock.
 */
export function spawnCollect(bin: string, args: readonly string[], opts: SpawnCollectOptions): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new SpawnAbortedError("process cancelled before start"));
      return;
    }
    // detached:true → child is its own process-group leader (pgid === pid on POSIX)
    // so `process.kill(-pid, …)` reaches the worker grandchild too. Do NOT unref():
    // we await this child. stdio defaults to "pipe", so stdout/stderr exist.
    const child = spawn(bin, args as string[], { detached: true });
    if (child.pid !== undefined) liveChildren.add(child);

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const killGroup = () => killTree(child, false);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      killGroup();
      reject(new SpawnTimeoutError(`process timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup();
      reject(new SpawnAbortedError("process cancelled"));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    child.stdout.on("data", (d: Buffer) => {
      stdoutBytes += d.length;
      if (stdoutBytes > opts.maxBuffer) {
        killGroup();
        finish(() => reject(new SpawnMaxBufferError("process stdout exceeded maxBuffer")));
        return;
      }
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrBytes += d.length;
      if (stderrBytes > opts.maxBuffer) {
        killGroup();
        finish(() => reject(new SpawnMaxBufferError("process stderr exceeded maxBuffer")));
        return;
      }
      stderr += d.toString();
    });

    // Spawn failure (ENOENT etc.) — preserve the original error for .code checks.
    child.on("error", (err) => {
      liveChildren.delete(child);
      finish(() => reject(err));
    });
    child.on("close", (code) => {
      liveChildren.delete(child);
      finish(() => resolve({ stdout, stderr, code }));
    });
  });
}

// Process-group-aware subprocess runner. The one place we own child-process
// mechanics so client.ts / extract.ts stay focused on error mapping.
//
// Why not execFile's `timeout`: Node kills only the DIRECT child on timeout and
// then waits for stdio EOF. `calibredb add` (and `ebook-convert`) routed through
// the Content Server spawn an import/conversion WORKER as a grandchild that
// inherits the stdout/stderr pipes — so the promise never settles and the orphan
// keeps the library write lock. We spawn `detached` (child becomes a group leader)
// and hard-kill the whole GROUP on timeout, taking the worker down too.

import { spawn } from "node:child_process";

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
}

/** Timed out and the process group was force-killed. Distinct so callers don't
 *  misclassify a hang as a normal non-zero exit. */
export class SpawnTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnTimeoutError";
  }
}

/** Output exceeded maxBuffer; the group was killed. */
export class SpawnMaxBufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnMaxBufferError";
  }
}

/**
 * Spawn `bin` with a literal argv array (never a shell string) and collect its
 * output. Resolves `{ stdout, stderr, code }` for ANY exit code — the caller
 * decides what a non-zero code means. Rejects on spawn failure (preserving
 * `.code === "ENOENT"`), on timeout ({@link SpawnTimeoutError}), or on maxBuffer
 * overflow ({@link SpawnMaxBufferError}). On timeout/overflow the whole process
 * group is SIGKILLed so no worker grandchild is left holding the DB lock.
 */
export function spawnCollect(
  bin: string,
  args: readonly string[],
  opts: SpawnCollectOptions,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    // detached:true → child is its own process-group leader (pgid === pid on POSIX)
    // so `process.kill(-pid, …)` reaches the worker grandchild too. Do NOT unref():
    // we await this child. stdio defaults to "pipe", so stdout/stderr exist.
    const child = spawn(bin, args as string[], { detached: true });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    /** SIGKILL the whole group (worker included); fall back to the lone child. */
    const killGroup = () => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (process.platform === "win32") {
          // Windows has no POSIX process groups — kill the tree by pid.
          spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
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
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup();
      reject(new SpawnTimeoutError(`process timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));
  });
}

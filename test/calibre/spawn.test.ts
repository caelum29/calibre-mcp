import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  killAllChildren,
  SpawnAbortedError,
  spawnCollect,
  SpawnTimeoutError,
  SpawnMaxBufferError,
} from "../../src/calibre/spawn.js";

const node = process.execPath;

describe("spawnCollect", () => {
  it("collects stdout and a zero exit code", async () => {
    const r = await spawnCollect(node, ["-e", "process.stdout.write('ok')"], {
      timeoutMs: 5_000,
      maxBuffer: 1 << 20,
    });
    expect(r).toEqual({ stdout: "ok", stderr: "", code: 0 });
  });

  it("captures stderr and a non-zero exit code (does not throw)", async () => {
    const r = await spawnCollect(node, ["-e", "process.stderr.write('boom');process.exit(3)"], {
      timeoutMs: 5_000,
      maxBuffer: 1 << 20,
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("boom");
  });

  it("rejects with the ENOENT error when the binary is missing", async () => {
    await expect(
      spawnCollect("definitely-not-a-real-binary-xyz", [], { timeoutMs: 5_000, maxBuffer: 1 << 20 }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  // The regression: a hung child that spawned a worker grandchild holding stdout open.
  // execFile's timeout would wait forever for pipe EOF; the group-kill settles promptly.
  it("force-kills the whole process group on timeout (grandchild holding stdout)", async () => {
    // Parent spawns a detached-from-us child that inherits stdout and sleeps 30s, then the
    // parent itself sleeps — mirrors calibredb spawning an import worker.
    const script =
      "const {spawn}=require('node:child_process');" +
      "spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore','inherit','inherit']});" +
      "setTimeout(()=>{},30000);";
    const start = Date.now();
    await expect(spawnCollect(node, ["-e", script], { timeoutMs: 400, maxBuffer: 1 << 20 })).rejects.toBeInstanceOf(
      SpawnTimeoutError,
    );
    // Must settle near the timeout, NOT wait for the 30s grandchild.
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it("kills the group and rejects when output exceeds maxBuffer", async () => {
    await expect(
      spawnCollect(node, ["-e", "process.stdout.write('x'.repeat(100))"], {
        timeoutMs: 5_000,
        maxBuffer: 10,
      }),
    ).rejects.toBeInstanceOf(SpawnMaxBufferError);
  });

  // Shutdown path: a still-running group (child + worker grandchild) must not outlive us.
  it("killAllChildren kills every live process group, grandchildren included", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spawn-kill-"));
    const pidFile = path.join(dir, "grandchild.pid");
    try {
      // Child spawns a grandchild that records its pid, then both sleep for 30s.
      const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},30000)`;
      const script =
        "const {spawn}=require('node:child_process');" +
        `spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});` +
        "setTimeout(()=>{},30000);";
      const run = spawnCollect(node, ["-e", script], { timeoutMs: 30_000, maxBuffer: 1 << 20 });
      const deadline = Date.now() + 5_000;
      while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") {
        if (Date.now() > deadline) throw new Error("grandchild never started");
        await new Promise((r) => setTimeout(r, 25));
      }
      const grandchildPid = Number(readFileSync(pidFile, "utf8"));

      expect(killAllChildren()).toBe(1);
      // The direct child dies by signal, so spawnCollect settles promptly with code null.
      const r = await run;
      expect(r.code).toBeNull();
      // The grandchild was in the same group — dead too. "Dead" = ESRCH, or a zombie on
      // Linux: an orphan is reparented to PID 1, and container init processes that don't
      // reap leave it as `Z` — killed, just not yet waited for.
      const isDead = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
        } catch (err) {
          return (err as NodeJS.ErrnoException).code === "ESRCH";
        }
        try {
          return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z") ?? false;
        } catch {
          return false;
        }
      };
      const gone = async (): Promise<boolean> => {
        for (let i = 0; i < 40; i++) {
          if (isDead(grandchildPid)) return true;
          await new Promise((res) => setTimeout(res, 25));
        }
        return false;
      };
      if (process.platform !== "win32") expect(await gone()).toBe(true);
      // Idempotent: nothing left to kill.
      expect(killAllChildren()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("forgets children that exited on their own", async () => {
    await spawnCollect(node, ["-e", "0"], { timeoutMs: 5_000, maxBuffer: 1 << 20 });
    expect(killAllChildren()).toBe(0);
  });

  it("kills the process group and rejects with SpawnAbortedError when the signal aborts", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const run = spawnCollect(node, ["-e", "setTimeout(()=>{},30000)"], {
      timeoutMs: 30_000,
      maxBuffer: 1 << 20,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(run).rejects.toBeInstanceOf(SpawnAbortedError);
    expect(Date.now() - start).toBeLessThan(5_000);
    // The killed child leaves the live registry once it has actually exited ('close').
    let live = 1;
    for (let i = 0; i < 40 && live > 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      live = killAllChildren();
    }
    expect(live).toBe(0);
  });

  it("does not spawn at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      spawnCollect(node, ["-e", "0"], { timeoutMs: 5_000, maxBuffer: 1 << 20, signal: controller.signal }),
    ).rejects.toBeInstanceOf(SpawnAbortedError);
    expect(killAllChildren()).toBe(0);
  });
});

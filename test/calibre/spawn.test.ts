import { describe, it, expect } from "vitest";
import { spawnCollect, SpawnTimeoutError, SpawnMaxBufferError } from "../../src/calibre/spawn.js";

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
    await expect(
      spawnCollect(node, ["-e", script], { timeoutMs: 400, maxBuffer: 1 << 20 }),
    ).rejects.toBeInstanceOf(SpawnTimeoutError);
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
});

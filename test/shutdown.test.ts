import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createShutdown } from "../src/shutdown.js";

describe("createShutdown", () => {
  it("kills children, closes, exits 0 — once, however many triggers fire", async () => {
    const order: string[] = [];
    const killChildren = vi.fn(() => {
      order.push("kill");
      return 2;
    });
    const close = vi.fn(async () => {
      order.push("close");
    });
    const exit = vi.fn((code: number) => {
      order.push(`exit:${code}`);
    });
    const shutdown = createShutdown({ close, exit, killChildren });

    await Promise.all([shutdown("SIGTERM"), shutdown("stdin-end"), shutdown("stdin-close")]);
    await shutdown("SIGINT");

    expect(order).toEqual(["kill", "close", "exit:0"]);
    expect(killChildren).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("still exits 0 when close() rejects", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      close: async () => {
        throw new Error("transport already gone");
      },
      exit,
      killChildren: () => 0,
    });
    await shutdown("stdin-end");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not wait forever for a hung close()", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      close: () => new Promise<void>(() => {}),
      exit,
      killChildren: () => 0,
      closeTimeoutMs: 50,
    });
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("stdio server lifetime", () => {
  // End-to-end: the real entry point must exit (code 0) when its client closes stdin,
  // rather than lingering as an orphan. Points at an unreachable Content Server so the
  // boot-time probe fails fast and nothing touches a real library.
  it("exits 0 when stdin closes", async () => {
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const entry = fileURLToPath(new URL("../src/run-stdio.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", tsx, entry], {
      env: { ...process.env, CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    // Wait for the listening banner, then hang up like a client would.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no banner; stderr:\n${stderr}`)), 15_000);
      child.stderr.on("data", () => {
        if (stderr.includes("listening on stdio")) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    child.stdin.end();
    const code = await Promise.race([
      exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10_000)),
    ]);
    if (code === "timeout") child.kill("SIGKILL");
    expect(code).toBe(0);
    expect(stderr).toContain("shutting down");
  }, 30_000);
});

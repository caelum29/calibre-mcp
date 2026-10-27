// FIFO single-flight inference queue (#156): concurrent callers run one at a time in arrival
// order, a failure doesn't poison the chain, and the waiting cap refuses with QUEUE_BUSY.

import { describe, expect, it } from "vitest";
import { InferenceQueue, QUEUE_BUSY } from "../../src/semantic/queue.js";

/** Promise the test resolves by hand — lets tasks finish in a controlled order. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("InferenceQueue", () => {
  it("runs queued tasks one at a time in FIFO order", async () => {
    const q = new InferenceQueue();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const task = (name: string, ms: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`end ${name}`);
      active--;
      return name;
    };
    // The first task is the slowest: unqueued, the others would finish before it.
    const results = await Promise.all([q.run(task("a", 30)), q.run(task("b", 5)), q.run(task("c", 1))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("a failing task rejects its own caller only; the next task still runs", async () => {
    const q = new InferenceQueue();
    const failed = q.run(async () => {
      throw new Error("boom");
    });
    const next = q.run(async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("refuses with QUEUE_BUSY past the waiting cap, and accepts again once drained", async () => {
    const q = new InferenceQueue(1);
    const gate = deferred();
    const running = q.run(() => gate.promise); // runs
    const waiting = q.run(async () => "w"); // waits (cap 1)
    await expect(q.run(async () => "x")).rejects.toThrow(QUEUE_BUSY);
    expect(q.depth).toBe(2);
    gate.resolve();
    await running;
    await expect(waiting).resolves.toBe("w");
    await expect(q.run(async () => "again")).resolves.toBe("again");
  });
});

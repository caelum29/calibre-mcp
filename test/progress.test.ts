import { describe, it, expect } from "vitest";
import { createProgressReporter, type ProgressNotification } from "../src/progress.js";

function harness(minIntervalMs = 100) {
  let t = 0;
  const sent: ProgressNotification[] = [];
  const report = createProgressReporter({
    progressToken: "tok",
    minIntervalMs,
    now: () => t,
    send: async (p) => {
      sent.push(p);
    },
  });
  return { sent, report, advance: (ms: number) => (t += ms) };
}

describe("createProgressReporter", () => {
  it("drops non-increasing progress", () => {
    const h = harness(0);
    h.report(1, "a");
    h.report(1, "dup");
    h.report(0.5, "back");
    h.report(2, "b");
    expect(h.sent.map((p) => p.progress)).toEqual([1, 2]);
  });

  it("throttles to one notification per interval but always sends completion", () => {
    const h = harness(100);
    h.report(0, "start", 10);
    h.advance(10);
    h.report(1, "too soon", 10);
    h.advance(100);
    h.report(2, "ok", 10);
    h.advance(1);
    h.report(10, "done", 10);
    expect(h.sent).toEqual([
      { progressToken: "tok", progress: 0, total: 10, message: "start" },
      { progressToken: "tok", progress: 2, total: 10, message: "ok" },
      { progressToken: "tok", progress: 10, total: 10, message: "done" },
    ]);
  });

  it("swallows send failures", async () => {
    const errors: unknown[] = [];
    const report = createProgressReporter({
      progressToken: 1,
      minIntervalMs: 0,
      send: async () => {
        throw new Error("transport closed");
      },
      onError: (e) => errors.push(e),
    });
    expect(() => report(1, "x")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
  });
});

// IndexBuildRegistry lifecycle (#284 review): kept results expire, cancelled results are never
// inherited, a background failure reaches the re-run, and a throwing build never wedges a library.

import { describe, expect, it } from "vitest";
import { IndexBuildRegistry, KEPT_RESULT_TTL_MS, type BuildOutcome } from "../../src/semantic/index-builds.js";

const LIB = "Lib";
const DEADLINE_MS = 20;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Registry on a manual clock (the deadline still waits on real timers, in ms). */
function registry(opts: { keptTtlMs?: number } = {}) {
  let t = 0;
  const reg = new IndexBuildRegistry<string>({ softDeadlineMs: DEADLINE_MS, now: () => t, ...opts });
  return { reg, advance: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

/** Start a build that outlasts the deadline, then settle it in the background. */
async function detachedBuild(reg: IndexBuildRegistry<string>, key = "k") {
  const d = deferred<string>();
  const first = await reg.run(LIB, key, () => d.promise);
  expect(first.kind).toBe("running");
  return d;
}

describe("IndexBuildRegistry", () => {
  it("should_hand_a_kept_result_to_a_same_selector_call_within_the_ttl", async () => {
    const { reg, advance } = registry();
    const d = await detachedBuild(reg);
    d.resolve("r1");
    await flush();
    advance(60_000);

    const out = await reg.run(LIB, "k", async () => "r2");

    expect(out).toEqual({ kind: "done", result: "r1", earlierCallFinishedAgoMs: 60_000 });
  });

  it("should_start_a_fresh_build_when_the_kept_result_is_older_than_the_ttl", async () => {
    const { reg, advance } = registry();
    const d = await detachedBuild(reg);
    d.resolve("r1");
    await flush();
    advance(KEPT_RESULT_TTL_MS + 1);

    const out = await reg.run(LIB, "k", async () => "r2");

    expect(out).toEqual({ kind: "done", result: "r2" });
  });

  it("should_honour_an_injected_ttl", async () => {
    const { reg, advance } = registry({ keptTtlMs: 1_000 });
    const d = await detachedBuild(reg);
    d.resolve("r1");
    await flush();
    advance(1_001);

    const out = await reg.run(LIB, "k", async () => "r2");

    expect(out).toEqual({ kind: "done", result: "r2" });
  });

  it("should_not_keep_a_result_the_keep_predicate_rejects", async () => {
    const { reg } = registry();
    const d = deferred<string>();
    const keep = (v: string) => v !== "cancelled";
    expect((await reg.run(LIB, "k", () => d.promise, { keep })).kind).toBe("running");
    d.resolve("cancelled");
    await flush();

    const out = await reg.run(LIB, "k", async () => "fresh", { keep });

    expect(out).toEqual({ kind: "done", result: "fresh" });
  });

  it("should_report_a_background_failure_once_then_build_fresh", async () => {
    const { reg, advance } = registry();
    const d = await detachedBuild(reg);
    d.reject(new Error("content server 503"));
    await flush();
    advance(2_000);

    const failed = await reg.run(LIB, "k", async () => "unused");
    const next = await reg.run(LIB, "k", async () => "fresh");

    expect(failed.kind).toBe("failed");
    const f = failed as Extract<BuildOutcome<string>, { kind: "failed" }>;
    expect((f.error as Error).message).toBe("content server 503");
    expect(f.earlierCallFinishedAgoMs).toBe(2_000);
    expect(next).toEqual({ kind: "done", result: "fresh" });
  });

  it("should_free_the_library_when_the_build_throws_synchronously", async () => {
    const { reg } = registry();

    await expect(
      reg.run(LIB, "k", () => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    const out = await reg.run(LIB, "k", async () => "after");

    expect(out).toEqual({ kind: "done", result: "after" });
  });

  it("should_report_another_selector_s_build_as_not_the_same_selector", async () => {
    const { reg } = registry();
    const d = await detachedBuild(reg, "a");

    const out = await reg.run(LIB, "b", async () => "unused");

    expect(out).toMatchObject({ kind: "running", sameSelector: false });
    d.resolve("done");
  });
});

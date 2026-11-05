// CalibreClient + busy breaker with calls in flight at the same time: a late markOk/markBusy from
// a call that started before the breaker moved lands on the shared entry (pins current behaviour,
// #389 Busy/probe). spawnCollect is the system boundary; deferred promises stand in for calibredb.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreClient } from "../../src/calibre/client.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { CalibreBusyError, CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";

vi.mock("../../src/calibre/spawn.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/calibre/spawn.js")>()),
  spawnCollect: vi.fn(),
}));
import { SpawnTimeoutError, spawnCollect } from "../../src/calibre/spawn.js";

const spawnMock = vi.mocked(spawnCollect);
const LIB = asLibId("Programming_Books");
type SpawnResult = Awaited<ReturnType<typeof spawnCollect>>;

interface Pending {
  ok(): void;
  exit(code: number): void;
  timeout(): void;
}

/** Each spawn parks until the test settles it; `spawned(n)` resolves once the n-th has been issued. */
function parkedSpawns() {
  const handles: Pending[] = [];
  let waiters: { n: number; resolve: () => void }[] = [];
  spawnMock.mockImplementation(
    () =>
      new Promise<SpawnResult>((resolve, reject) => {
        handles.push({
          ok: () => resolve({ code: 0, stdout: "", stderr: "" } as SpawnResult),
          exit: (code) => resolve({ code, stdout: "", stderr: "nope" } as SpawnResult),
          timeout: () => reject(new SpawnTimeoutError("timed out")),
        });
        for (const w of waiters) if (handles.length >= w.n) w.resolve();
        waiters = waiters.filter((w) => handles.length < w.n);
      }),
  );
  // a signal rather than a sync assumption: calibredb may gain an await before it spawns
  const spawned = (n: number) =>
    handles.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve }));
  return { handles, spawned };
}

function setup() {
  const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, maxWindowMs: 300_000 });
  const client = new CalibreClient(loadConfig({}), busy);
  return { busy, run: () => client.calibredb(["list"], { library: LIB }), ...parkedSpawns() };
}

/** Two calls start closed; the second times out (strike 1, 60 s); the first stays in flight as the stale call. */
async function staleAndTrigger(ctx: ReturnType<typeof setup>) {
  const stale = ctx.run();
  const trigger = ctx.run();
  await ctx.spawned(2);
  ctx.handles[1]!.timeout();
  await expect(trigger).rejects.toBeInstanceOf(CalibreCliTimeoutError);
  return { stale };
}

beforeEach(() => {
  spawnMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] }); // the clock is the only timer the breaker reads
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CalibreClient busy breaker with overlapping calls", () => {
  it("should_close_the_breaker_when_a_call_started_before_the_timeout_succeeds_after_it", async () => {
    const { busy, run, handles, spawned } = setup();
    const early = run(); // A and B both start while the breaker is closed
    const late = run();
    await spawned(2);
    handles[0]!.timeout();
    await expect(early).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ libraryId: LIB, retryInMs: 60_000 })]);
    handles[1]!.ok(); // B was already past the gate and the server did answer it
    await late;
    expect(busy.busyLibraries()).toEqual([]);
    const next = run(); // not refused: markOk wiped A's strike
    await spawned(3);
    handles[2]!.ok();
    await next;
  });

  it("should_close_the_breaker_when_a_pre_timeout_call_exits_non_zero_after_it", async () => {
    // a non-zero exit is still an answer from the server, so markOk runs on that path too
    const { busy, run, handles, spawned } = setup();
    const early = run();
    const late = run();
    await spawned(2);
    handles[0]!.timeout();
    await expect(early).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    handles[1]!.exit(1);
    await expect(late).rejects.toBeInstanceOf(CalibreCliError);
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("should_escalate_to_strike_two_when_a_second_overlapping_call_times_out_inside_the_open_window", async () => {
    const { busy, run, handles, spawned } = setup();
    const first = run();
    const second = run();
    await spawned(2);
    handles[0]!.timeout();
    await expect(first).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    vi.advanceTimersByTime(10_000);
    handles[1]!.timeout();
    await expect(second).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ retryInMs: 120_000 })]);
  });

  it("should_reopen_with_a_doubled_window_when_a_pre_timeout_call_times_out_during_the_probe", async () => {
    const ctx = setup();
    const { busy, run, handles, spawned } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const probe = run(); // claims the half-open probe
    await spawned(3);
    handles[0]!.timeout(); // the stale call times out while the probe is still in flight
    await expect(stale).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    // strike 2 replaced the entry: doubled window
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ libraryId: LIB, retryInMs: 120_000 })]);
    await expect(run()).rejects.toBeInstanceOf(CalibreBusyError);
    expect(handles).toHaveLength(3); // refused without spawning
    handles[2]!.ok(); // the displaced probe finally answers: markOk closes everything
    await probe;
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("should_admit_a_second_probe_after_the_next_window_while_the_displaced_probe_is_still_running", async () => {
    const ctx = setup();
    const { run, handles, spawned } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const displaced = run(); // probe 1
    await spawned(3);
    handles[0]!.timeout(); // stale call's timeout wipes probe 1's slot: 120 s
    await expect(stale).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    vi.advanceTimersByTime(120_000);
    const probe2 = run(); // window over: a fresh probe goes out although probe 1 never settled
    await spawned(4);
    await expect(run()).rejects.toThrow("Another call is checking"); // one probe at a time again
    handles[2]!.timeout(); // displaced probe times out late: a third strike, 240 s
    await expect(displaced).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    await expect(run()).rejects.toThrow("Retry in ~240 s");
    handles[3]!.ok();
    await probe2;
  });

  it("should_not_refuse_the_next_call_when_a_stale_success_lands_while_the_probe_is_in_flight", async () => {
    const ctx = setup();
    const { busy, run, handles, spawned } = ctx;
    const { stale } = await staleAndTrigger(ctx);
    vi.advanceTimersByTime(60_000);
    const probe = run();
    await spawned(3);
    handles[0]!.ok(); // stale call answers: markOk drops the entry, probe claim and all
    await stale;
    expect(busy.busyLibraries()).toEqual([]);
    const next = run(); // closed again: no probe slot to be refused on
    await spawned(4);
    handles[2]!.timeout(); // the displaced probe then times out: a fresh strike 1, not strike 2
    await expect(probe).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ retryInMs: 60_000 })]);
    handles[3]!.ok();
    await next;
  });
});

// CalibreClient + busy breaker with calls in flight at the same time: a late markOk/markBusy from
// a call that started before the breaker moved lands on the shared entry (pins current behaviour,
// #389 Busy/probe). spawnCollect is the system boundary; deferred promises stand in for calibredb.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreClient } from "../../src/calibre/client.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { CalibreBusyError, CalibreCliTimeoutError } from "../../src/domain/errors.js";

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
  timeout(): void;
}

/** Each spawn parks until the test settles it; returns handles in spawn order. */
function parkedSpawns(): Pending[] {
  const handles: Pending[] = [];
  spawnMock.mockImplementation(
    () =>
      new Promise<SpawnResult>((resolve, reject) => {
        handles.push({
          ok: () => resolve({ code: 0, stdout: "", stderr: "" } as SpawnResult),
          timeout: () => reject(new SpawnTimeoutError("timed out")),
        });
      }),
  );
  return handles;
}

function setup() {
  const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, maxWindowMs: 300_000 });
  const client = new CalibreClient(loadConfig({}), busy);
  return { busy, client, run: () => client.calibredb(["list"], { library: LIB }) };
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
    const { busy, run } = setup();
    const handles = parkedSpawns();
    const early = run(); // A and B both start while the breaker is closed
    const late = run();
    handles[0]!.timeout();
    await expect(early).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ libraryId: LIB, retryInMs: 60_000 })]);
    handles[1]!.ok(); // B was already past the gate and the server did answer it
    await late;
    expect(busy.busyLibraries()).toEqual([]);
    const next = run(); // not refused: markOk wiped A's strike
    expect(spawnMock).toHaveBeenCalledTimes(3);
    handles[2]!.ok();
    await next;
  });

  it("should_reopen_with_a_doubled_window_when_a_pre_timeout_call_times_out_during_the_probe", async () => {
    const { busy, run } = setup();
    const handles = parkedSpawns();
    const first = run(); // stale: started while closed
    const trigger = run();
    handles[1]!.timeout();
    await expect(trigger).rejects.toBeInstanceOf(CalibreCliTimeoutError); // strike 1, 60 s
    vi.advanceTimersByTime(60_000);
    const probe = run(); // claims the half-open probe
    expect(spawnMock).toHaveBeenCalledTimes(3);
    handles[0]!.timeout(); // the stale call times out while the probe is still in flight
    await expect(first).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    // strike 2 replaced the entry: doubled window, probe slot wiped
    expect(busy.busyLibraries()).toEqual([expect.objectContaining({ libraryId: LIB, retryInMs: 120_000 })]);
    await expect(run()).rejects.toBeInstanceOf(CalibreBusyError);
    expect(spawnMock).toHaveBeenCalledTimes(3); // refused without spawning
    handles[2]!.ok(); // the displaced probe finally answers: markOk closes everything
    await probe;
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("should_admit_a_second_probe_after_the_next_window_while_the_displaced_probe_is_still_running", async () => {
    const { run } = setup();
    const handles = parkedSpawns();
    const stale = run();
    const trigger = run();
    handles[1]!.timeout();
    await expect(trigger).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    vi.advanceTimersByTime(60_000);
    const displaced = run(); // probe 1
    handles[0]!.timeout(); // stale call's timeout reopens for 120 s
    await expect(stale).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    vi.advanceTimersByTime(120_000);
    const probe2 = run(); // window over: a fresh probe goes out although probe 1 never settled
    expect(spawnMock).toHaveBeenCalledTimes(4);
    await expect(run()).rejects.toBeInstanceOf(CalibreBusyError); // one probe at a time again
    handles[2]!.timeout(); // displaced probe times out late: a third strike, 240 s
    await expect(displaced).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    await expect(run()).rejects.toThrow("Retry in ~240 s");
    handles[3]!.ok();
    await probe2;
  });
});

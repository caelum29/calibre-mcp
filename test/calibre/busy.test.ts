// Busy circuit breaker: after a timeout a library fails fast for a window, re-opens with a
// doubled window when the half-open probe also times out, and closes on any success.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreBusyError } from "../../src/domain/errors.js";

// Real Date.now under vitest fake timers: the tracker's default clock is what ships.
function tracker() {
  const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, maxWindowMs: 150_000 });
  return { busy, advance: (ms: number) => vi.advanceTimersByTime(ms) };
}

describe("LibraryBusyTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is closed until a timeout is recorded", () => {
    const { busy } = tracker();
    expect(() => busy.assertAvailable("Programming_Books")).not.toThrow();
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("opens per library and fails fast with the time left", () => {
    const { busy, advance } = tracker();
    busy.markBusy("Programming_Books", "content-server");
    advance(18_000);
    expect(() => busy.assertAvailable("Programming_Books")).toThrow(CalibreBusyError);
    expect(() => busy.assertAvailable("Programming_Books")).toThrow("Retry in ~42 s");
    // other libraries have their own DB lock in Calibre — unaffected
    expect(() => busy.assertAvailable("Humanities")).not.toThrow();
    expect(busy.busyLibraries()).toEqual([
      expect.objectContaining({ libraryId: "Programming_Books", source: "content-server", retryInMs: 42_000 }),
    ]);
  });

  it("goes half-open after the window, doubles it on another timeout, caps it", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    expect(() => busy.assertAvailable("L")).not.toThrow(); // half-open: let one through
    busy.markBusy("L", "calibredb"); // ...and it timed out again
    advance(119_000);
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
    advance(1_000);
    expect(() => busy.assertAvailable("L")).not.toThrow();
    busy.markBusy("L", "calibredb"); // third strike: 240 s, capped at 150 s
    expect(busy.busyLibraries()[0]?.retryInMs).toBe(150_000);
  });

  it("admits one probe once the window expires; concurrent calls are refused (#343)", async () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    let reachedCalibre = 0;
    let releaseCalibre!: () => void;
    const calibreAnswers = new Promise<void>((resolve) => (releaseCalibre = resolve));
    const call = async () => {
      busy.assertAvailable("L");
      reachedCalibre++;
      await calibreAnswers; // the probe stays in flight while the others arrive
    };
    // start all three before awaiting any: the other two arrive while the probe is mid-flight
    const calls = [call(), call(), call()];
    expect(reachedCalibre).toBe(1);
    releaseCalibre();
    const results = await Promise.allSettled(calls);
    expect(results[0]?.status).toBe("fulfilled"); // the probe itself completed
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(CalibreBusyError);
  });

  it("lets the next call probe after the probe is released without a verdict (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    const claim = busy.assertAvailable("L"); // claims the probe
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
    busy.releaseProbe("L", claim); // probe died with a non-timeout error
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("a stale call cannot release a newer probe's slot (#343)", () => {
    const { busy, advance } = tracker();
    const staleClaim = busy.assertAvailable("L"); // Y starts while the library is still closed
    busy.markBusy("L", "calibredb"); // X times out
    advance(60_000);
    const probe = busy.assertAvailable("L"); // Z claims the probe
    expect(probe).toBeDefined();
    busy.releaseProbe("L", staleClaim); // Y fails with a non-timeout error
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError); // still one probe only
    busy.releaseProbe("L", probe); // the real probe's own release works
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("a claim from an earlier window does not match the next probe (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    const first = busy.assertAvailable("L");
    busy.markBusy("L", "calibredb"); // first probe timed out: doubled window
    advance(120_000);
    const second = busy.assertAvailable("L");
    busy.releaseProbe("L", first);
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
    busy.releaseProbe("L", second);
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("refuses with a probe-in-flight message that does not promise ~1 s (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    busy.assertAvailable("L");
    let err: unknown;
    try {
      busy.assertAvailable("L");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CalibreBusyError);
    expect((err as CalibreBusyError).message).toContain("Another call is checking whether it answers again");
    expect((err as CalibreBusyError).message).not.toContain("Retry in ~1 s");
  });

  it("keeps listing the library as busy while its probe is in flight (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    expect(busy.busyLibraries()).toEqual([]); // window over, nobody probing yet
    const claim = busy.assertAvailable("L");
    expect(busy.busyLibraries()).toEqual([
      expect.objectContaining({ libraryId: "L", source: "calibredb", retryInMs: 0 }),
    ]);
    busy.releaseProbe("L", claim);
    expect(busy.busyLibraries()).toEqual([]);
  });

  it("a probe timeout reopens the window and frees the slot for the next probe (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    busy.assertAvailable("L");
    busy.markBusy("L", "calibredb");
    advance(120_000);
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("a probe success closes the entry for everyone (#343)", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    busy.assertAvailable("L");
    busy.markOk("L");
    expect(() => busy.assertAvailable("L")).not.toThrow();
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("a stale markOk (no claim) closes the breaker; the old probe's release is then harmless", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    const probe = busy.assertAvailable("L");
    busy.markOk("L"); // a stale call from before the timeout completes: the library did answer
    expect(busy.busyLibraries()).toEqual([]);
    const next = busy.assertAvailable("L"); // closed again, no entry to claim
    expect(next).toBeUndefined();
    busy.releaseProbe("L", probe); // the displaced probe fails later: must be a no-op
    expect(busy.busyLibraries()).toEqual([]);
    expect(() => busy.assertAvailable("L")).not.toThrow();
  });

  it("a stale markBusy (no claim) replaces the entry: strikes+1 and a doubled window, then one fresh probe", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    const probe = busy.assertAvailable("L");
    busy.markBusy("L", "content-server"); // a stale call from before the timeout times out late
    expect(busy.busyLibraries()).toEqual([
      expect.objectContaining({ libraryId: "L", source: "content-server", retryInMs: 120_000 }),
    ]);
    expect(() => busy.assertAvailable("L")).toThrow("Retry in ~120 s");
    advance(119_000);
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
    advance(1_000);
    const reprobe = busy.assertAvailable("L"); // window over: exactly one new probe
    expect(reprobe).toBeDefined();
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
    busy.releaseProbe("L", probe); // the displaced probe's late release must not free the new probe's slot
    expect(() => busy.assertAvailable("L")).toThrow(CalibreBusyError);
  });

  it("closes and forgets strikes on success", () => {
    const { busy, advance } = tracker();
    busy.markBusy("L", "calibredb");
    busy.markBusy("L", "calibredb");
    busy.markOk("L");
    expect(() => busy.assertAvailable("L")).not.toThrow();
    busy.markBusy("L", "calibredb");
    advance(60_000);
    expect(() => busy.assertAvailable("L")).not.toThrow(); // back to the base window
  });
});

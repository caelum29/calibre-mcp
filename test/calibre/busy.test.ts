// Busy circuit breaker: after a timeout a library fails fast for a window, re-opens with a
// doubled window when the half-open probe also times out, and closes on any success.
import { describe, expect, it } from "vitest";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreBusyError } from "../../src/domain/errors.js";

function tracker() {
  let t = 1_000_000;
  const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, maxWindowMs: 150_000, now: () => t });
  return { busy, advance: (ms: number) => (t += ms) };
}

describe("LibraryBusyTracker", () => {
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

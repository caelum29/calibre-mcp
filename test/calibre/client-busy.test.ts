// CalibreClient + busy breaker: a calibredb timeout flags the library, and the next call is
// refused without spawning anything (no new work piled onto a stalled Calibre).
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LibraryBusyTracker } from "../../src/calibre/busy.js";
import { CalibreClient } from "../../src/calibre/client.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { CalibreBusyError, CalibreCliTimeoutError, CalibreNotFoundError } from "../../src/domain/errors.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A calibredb stand-in that records each spawn, then hangs (like a call queued behind FTS). */
function hangingCalibredb(): { script: string; spawned: string } {
  dir = mkdtempSync(path.join(tmpdir(), "cdb-busy-"));
  const script = path.join(dir, "calibredb");
  const spawned = path.join(dir, "spawned");
  writeFileSync(script, `#!/bin/sh\necho x >> '${spawned}'\nsleep 5\n`);
  chmodSync(script, 0o755);
  return { script, spawned };
}

const LIB = asLibId("Programming_Books");

describe("CalibreClient busy breaker", () => {
  it("should_refuse_without_spawning_after_a_timeout", async () => {
    const { script, spawned } = hangingCalibredb();
    const busy = new LibraryBusyTracker();
    const c = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: script }), busy);
    await expect(c.calibredb(["saved_searches", "list"], { library: LIB, timeoutMs: 200 })).rejects.toBeInstanceOf(
      CalibreCliTimeoutError,
    );
    rmSync(spawned, { force: true }); // the first spawn may be killed before its echo runs
    await expect(c.calibredb(["list_categories", "--csv"], { library: LIB })).rejects.toBeInstanceOf(CalibreBusyError);
    expect(existsSync(spawned)).toBe(false);
  });

  it("should_free_the_probe_slot_when_the_probe_fails_without_a_timeout (#343)", async () => {
    let t = 1_000_000;
    const busy = new LibraryBusyTracker({ baseWindowMs: 60_000, now: () => t });
    busy.markBusy(LIB, "calibredb");
    t += 60_000;
    const c = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb" }), busy);
    // probe 1 and 2 both reach the spawn (ENOENT), neither is refused as busy
    await expect(c.calibredb(["x"], { library: LIB })).rejects.toBeInstanceOf(CalibreNotFoundError);
    await expect(c.calibredb(["x"], { library: LIB })).rejects.toBeInstanceOf(CalibreNotFoundError);
  });

  it("should_leave_other_libraries_alone", async () => {
    const { script } = hangingCalibredb();
    const busy = new LibraryBusyTracker();
    const c = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: script }), busy);
    await expect(c.calibredb(["x"], { library: LIB, timeoutMs: 200 })).rejects.toBeInstanceOf(CalibreCliTimeoutError);
    await expect(c.calibredb(["x"], { library: asLibId("Humanities"), timeoutMs: 200 })).rejects.toBeInstanceOf(
      CalibreCliTimeoutError, // spawned and timed out on its own — not refused as busy
    );
  });
});

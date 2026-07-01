import { describe, it, expect } from "vitest";
import path from "node:path";
import { discoverCalibredb } from "../../src/calibre/discover.js";

describe("discoverCalibredb", () => {
  it("returns the darwin app-bundle path when present", () => {
    const hit = "/Applications/calibre.app/Contents/MacOS/calibredb";
    expect(discoverCalibredb({}, "darwin", (p) => p === hit)).toBe(hit);
  });

  it("expands Windows env-var install roots", () => {
    const env = { ProgramFiles: "C:\\Program Files" };
    const hit = path.join("C:\\Program Files", "Calibre2", "calibredb.exe");
    expect(discoverCalibredb(env, "win32", (p) => p === hit)).toBe(hit);
  });

  it("skips win32 candidates whose env roots are unset", () => {
    // No ProgramFiles/LOCALAPPDATA → zero candidates → PATH fallback, even if exists()
    // would claim everything exists.
    expect(discoverCalibredb({}, "win32", () => true)).toBe("calibredb");
  });

  it("finds a linux system install", () => {
    expect(discoverCalibredb({}, "linux", (p) => p === "/usr/bin/calibredb")).toBe(
      "/usr/bin/calibredb",
    );
  });

  it("falls back to bare calibredb (PATH) when nothing exists", () => {
    expect(discoverCalibredb({}, "linux", () => false)).toBe("calibredb");
  });
});

// #251 — an FTS query parse failure is a user-input problem: logged at warn, not error, so it
// doesn't fill calibre_ping.recentErrors. Other calibredb failures stay at error.
import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CalibreClient } from "../../src/calibre/client.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import { log } from "../../src/logging.js";

let dir: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function clientFailingWith(stderr: string): CalibreClient {
  dir = mkdtempSync(path.join(tmpdir(), "fts-log-"));
  const script = path.join(dir, "calibredb");
  writeFileSync(script, `#!/bin/sh\necho '${stderr}' >&2\nexit 1\n`);
  chmodSync(script, 0o755);
  return new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: script }));
}

describe("calibredb failure log level (#251)", () => {
  it("logs a query parse failure at warn, not error", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const c = clientFailingWith("Failed to parse search query: a-b with error: no such column: b");
    await expect(c.ftsSearch("a-b", { library: asLibId("Programming_Books") })).rejects.toBeInstanceOf(CalibreCliError);
    expect(warn).toHaveBeenCalledWith("calibredb failed", expect.objectContaining({ code: 1 }));
    expect(error).not.toHaveBeenCalled();
  });

  it("still logs any other failure at error", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const c = clientFailingWith("something else broke");
    await expect(c.ftsSearch("abc", { library: asLibId("Programming_Books") })).rejects.toBeInstanceOf(CalibreCliError);
    expect(error).toHaveBeenCalledWith("calibredb failed", expect.objectContaining({ code: 1 }));
    expect(warn).not.toHaveBeenCalled();
  });
});

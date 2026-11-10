// `calibredb --version` is read lazily, once per process, and never throws (#499).

import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CalibreClient } from "../../src/calibre/client.js";
import { loadConfig } from "../../src/config.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** calibredb stub printing `stdout` and recording one line of argv per spawn. */
function stubClient(stdout: string, exitCode = 0): { client: CalibreClient; spawns: () => string[] } {
  dir = mkdtempSync(path.join(tmpdir(), "calver-"));
  const script = path.join(dir, "calibredb");
  const out = path.join(dir, "spawns.txt");
  const body = path.join(dir, "stdout.txt");
  writeFileSync(body, stdout);
  writeFileSync(script, `#!/bin/sh\necho "$*" >> '${out}'\ncat '${body}'\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  const client = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: script }));
  const spawns = () => (existsSync(out) ? readFileSync(out, "utf8").trim().split("\n") : []);
  return { client, spawns };
}

describe("CalibreClient.calibreVersion (#499)", () => {
  it("should_parse_the_real_dev_machine_output", async () => {
    const { client } = stubClient("Integration status: False\ncalibredb (calibre 9.18)\n");
    expect(await client.calibreVersion()).toEqual({ text: "9.18", major: 9, minor: 18, patch: 0 });
  });

  it("should_run_calibredb_version_without_with_library", async () => {
    const { client, spawns } = stubClient("calibredb (calibre 9.18)\n");
    await client.calibreVersion();
    expect(spawns()).toEqual(["--version"]);
  });

  it("should_spawn_once_and_cache_for_the_process", async () => {
    const { client, spawns } = stubClient("calibredb (calibre 9.18)\n");
    await Promise.all([client.calibreVersion(), client.calibreVersion()]);
    await client.calibreVersion();
    expect(spawns()).toHaveLength(1);
  });

  it("should_not_spawn_before_the_first_call", () => {
    const { spawns } = stubClient("calibredb (calibre 9.18)\n");
    expect(spawns()).toEqual([]);
  });

  it("should_degrade_to_unknown_when_the_binary_is_missing", async () => {
    const client = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb-499" }));
    expect(await client.calibreVersion()).toBe("unknown");
  });

  it("should_degrade_to_unknown_when_calibredb_exits_non_zero", async () => {
    const { client } = stubClient("calibredb (calibre 9.18)\n", 1);
    expect(await client.calibreVersion()).toBe("unknown");
  });

  it("should_degrade_to_unknown_on_unparseable_output", async () => {
    const { client } = stubClient("Integration status: False\n");
    expect(await client.calibreVersion()).toBe("unknown");
  });
});

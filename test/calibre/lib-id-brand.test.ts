// #218 / D-008: `--with-library` takes a libId, never a display name. LibId is a branded string
// minted only by content.resolveLibraryId, so passing a plain string is a compile error.
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CalibreClient } from "../../src/calibre/client.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { loadConfig } from "../../src/config.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Client whose calibredb is a script that records its argv, one arg per line. */
function recordingClient(env: Record<string, string>): { client: CalibreClient; argv: () => string[] } {
  dir = mkdtempSync(path.join(tmpdir(), "libid-"));
  const script = path.join(dir, "calibredb");
  const out = path.join(dir, "argv.txt");
  writeFileSync(script, `#!/bin/sh\nfor a in "$@"; do echo "$a" >> '${out}'; done\n`);
  chmodSync(script, 0o755);
  const client = new CalibreClient(loadConfig({ CALIBRE_MCP_CALIBREDB_PATH: script, ...env }));
  return { client, argv: () => readFileSync(out, "utf8").trim().split("\n") };
}

describe("LibId brand (type level, checked by `pnpm typecheck`)", () => {
  it("should_reject_a_display_name_where_a_LibId_is_required", () => {
    // Never invoked: the assertions are the compiler's.
    const compileOnly = (client: CalibreClient) => {
      // @ts-expect-error a display name is not a LibId
      void client.calibredb(["list"], { library: "Programming Books" });
      // @ts-expect-error a display name is not a LibId
      void client.ftsSearch("q", { library: "Programming Books" });
      // @ts-expect-error library is required: no raw-config fallback
      void client.calibredb(["list"]);
    };
    expect(typeof compileOnly).toBe("function");
  });
});

describe("calibredb --with-library", () => {
  it("should_use_the_given_libId_not_the_configured_display_name", async () => {
    const { client, argv } = recordingClient({ CALIBRE_MCP_LIBRARY: "Programming Books" });
    await client.calibredb(["list"], { library: asLibId("Programming_Books") });
    expect(argv()[1]).toBe("http://localhost:8080/#Programming_Books");
  });
});

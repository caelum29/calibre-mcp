// Log files are owner-only (#680): they hold search queries verbatim, so new files are 0600.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "../src/logging.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("log files are owner-only (#680)", () => {
  it("should_create_the_daily_file_and_readme_with_mode_0600", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cmcp-log-"));
    dirs.push(dir);
    const logger = createLogger({ stderr: () => undefined, now: () => new Date("2026-10-30T14:04:24.000Z") });
    logger.configure({ dir });
    logger.info("hello");
    const modes = Object.fromEntries(
      readdirSync(dir).map((f) => [f, (statSync(path.join(dir, f)).mode & 0o777).toString(8)]),
    );
    expect(modes).toEqual({ "README.md": "600", "calibre-mcp-2026-10-30.jsonl": "600" });
  });
});

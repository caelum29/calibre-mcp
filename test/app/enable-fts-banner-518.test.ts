// #518 review: enableFts reads line-oriented status text, so a banner line at ANY position is noise.
import { describe, expect, it } from "vitest";
import { enableFts } from "../../src/app/enable-fts.js";

const run = (statusOut: string) =>
  enableFts(
    {
      writeEnabled: true,
      calibre: {
        calibredb: async (a: readonly string[]) => ({ stdout: a[1] === "status" ? statusOut : "", stderr: "" }),
      } as never,
    },
    "Programming_Books" as never,
  );

describe("enableFts drops banner lines at any position (#518)", () => {
  it("should_not_take_a_trailing_banner_line_for_progress", async () => {
    expect(await run("FTS Indexing is enabled\nIntegration status: 1 of 2\n")).toEqual({ status: "already_enabled" });
  });
  it("should_keep_the_real_progress_line_when_a_banner_sits_between_the_lines", async () => {
    expect(
      await run("FTS Indexing is enabled\nIntegration status: 9 of 9\n1153 of 1153 books files indexed\n"),
    ).toEqual({ status: "already_enabled", progress: "1153 of 1153 books files indexed" });
  });
});

// calibre_merge_books live smoke test (spec #50 §8 layer 2) — GATED behind
// RUN_CALIBRE_TESTS=1 so CI (no calibre) never runs it. Exercises all three modes
// end-to-end against the RUNNING Content Server (GUI open is the production condition).
//
//   pnpm test:calibre        (or RUN_CALIBRE_TESTS=1 pnpm vitest run test/integration/merge.live.test.ts)
//
// Fixture hygiene: scraps are titled "ZZZ MCP Merge Test …" + tagged mcp-test-scrap,
// created in the default library (CALIBRE_TEST_LIBRARY overrides), and afterAll
// trash-removes every created id — never --permanent. Skips (not fails) when the
// Content Server is down.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { CalibreClient } from "../../src/calibre/client.js";
import { ContentServerClient } from "../../src/calibre/content-server.js";
import { log } from "../../src/logging.js";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import type { ToolDeps } from "../../src/tools/types.js";

const RUN = process.env.RUN_CALIBRE_TESTS === "1";
const TEST_LIBRARY = process.env.CALIBRE_TEST_LIBRARY; // display name or libId; default lib otherwise

const config = loadConfig(process.env as Record<string, string | undefined>);

// Probe the server once at collection time: down → the whole suite SKIPS, not fails.
let serverUp = false;
if (RUN) {
  try {
    const res = await fetch(`${config.serverUrl}/ajax/library-info`, {
      signal: AbortSignal.timeout(3_000),
    });
    serverUp = res.ok;
  } catch {
    serverUp = false;
  }
}
if (RUN && !serverUp) {
  // eslint-disable-next-line no-console
  console.error(`[merge.live] Content Server not reachable at ${config.serverUrl} — skipping`);
}

describe.skipIf(!RUN || !serverUp)("calibre_merge_books (live Content Server)", () => {
  const content = new ContentServerClient(config);
  const calibre = new CalibreClient(config);
  const deps = {
    config,
    content,
    calibre,
    extractor: {} as ToolDeps["extractor"],
    log,
  } as ToolDeps;

  const createdIds: number[] = [];
  let scratch: string;
  let libId: string;

  /** calibredb add prints "Added book ids: N" (plus possible noise lines — probe §6). */
  const parseAddedId = (stdout: string): number => {
    const m = /Added book ids?:\s*([\d, ]+)/.exec(stdout);
    if (!m) throw new Error(`could not parse added id from: ${stdout}`);
    const id = Number(m[1]!.split(",")[0]!.trim());
    createdIds.push(id);
    return id;
  };

  /** An empty-record target (no formats) so the source's TXT genuinely MOVES. */
  const addEmptyTarget = async (suffix: string): Promise<number> => {
    const { stdout } = await calibre.calibredb(
      ["add", "--empty", "--title", `ZZZ MCP Merge Test target ${suffix}`, "--authors",
        "MCP Test", "--tags", "mcp-test-scrap"],
      { library: libId },
    );
    return parseAddedId(stdout);
  };

  const addTxtSource = async (suffix: string): Promise<number> => {
    const file = join(scratch, `source-${suffix}.txt`);
    await writeFile(file, `ZZZ MCP merge test scrap ${suffix}\n`);
    const { stdout } = await calibre.calibredb(
      ["add", file, "--title", `ZZZ MCP Merge Test source ${suffix}`, "--authors",
        "MCP Test", "--tags", `mcp-test-scrap,zzz-${suffix}`],
      { library: libId },
    );
    return parseAddedId(stdout);
  };

  const merge = (args: Record<string, unknown>) =>
    mergeBooksTool.handler(
      { mode: "merge", confirm: false, library: TEST_LIBRARY, ...args },
      deps,
    );

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "calibre-mcp-merge-live-"));
    libId = await content.resolveLibraryId(TEST_LIBRARY);
  });

  afterAll(async () => {
    // Trash-remove only (recoverable) — NEVER --permanent (probe §5 / house rule).
    if (createdIds.length > 0) {
      await calibre
        .calibredb(["remove", createdIds.join(",")], { library: libId })
        .catch((e) => log.warn("live-test cleanup remove failed", { msg: String(e) }));
    }
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it("dry-runs without writing, then mode=merge moves the format, merges tags, trashes the source", async () => {
    const targetId = await addEmptyTarget("merge");
    const sourceId = await addTxtSource("merge");

    const plan = await merge({ targetId, sourceIds: [sourceId] });
    expect(plan.isError).toBeFalsy();
    expect(plan.structuredContent?.status).toBe("planned");
    expect((await content.getBook(sourceId, TEST_LIBRARY)).id).toBe(sourceId); // dry run wrote nothing

    const r = await merge({ targetId, sourceIds: [sourceId], confirm: true });
    expect(r.structuredContent?.status).toBe("merged");

    const after = await content.getBook(targetId, TEST_LIBRARY);
    expect(after.formats).toContain("txt");
    expect(after.tags).toContain(`zzz-merge`);
    await expect(content.getBook(sourceId, TEST_LIBRARY)).rejects.toThrow(); // 404 — trashed
  }, 120_000);

  it("mode=safe merges formats + metadata but keeps the source", async () => {
    const targetId = await addEmptyTarget("safe");
    const sourceId = await addTxtSource("safe");

    const r = await merge({ targetId, sourceIds: [sourceId], mode: "safe", confirm: true });
    expect(r.structuredContent?.status).toBe("merged");

    expect((await content.getBook(targetId, TEST_LIBRARY)).formats).toContain("txt");
    expect((await content.getBook(sourceId, TEST_LIBRARY)).id).toBe(sourceId); // kept
  }, 120_000);

  it("mode=formatsOnly moves the format, leaves metadata untouched, trashes the source", async () => {
    const targetId = await addEmptyTarget("fmtonly");
    const sourceId = await addTxtSource("fmtonly");

    const r = await merge({ targetId, sourceIds: [sourceId], mode: "formatsOnly", confirm: true });
    expect(r.structuredContent?.status).toBe("merged");

    const after = await content.getBook(targetId, TEST_LIBRARY);
    expect(after.formats).toContain("txt");
    expect(after.tags).not.toContain("zzz-fmtonly"); // metadata untouched
    await expect(content.getBook(sourceId, TEST_LIBRARY)).rejects.toThrow();
  }, 120_000);
});

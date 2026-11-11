// #417 / #471 review: a merge step that fails transiently (the server never answered, or answered
// 5xx) renders the shared presenter's text with its next step, not calibredb's raw stderr.

import { describe, it, expect, vi } from "vitest";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log, type LogSink } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import { noPruneIndex, type WithPrune } from "./fake-prune-index.js";
import type { ToolResult } from "../../src/tools/types.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const sink: LogSink = log;
const REFUSED_CONN = "ConnectionRefusedError: [Errno 61] Connection refused";
const GATEWAY = "HTTP Error 503: Service Unavailable";

const book = (over: Partial<Book>): Book => ({
  id: 1,
  uuid: "u",
  title: "Dup Book",
  authors: ["A"],
  identifiers: {},
  formats: [],
  tags: [],
  languages: [],
  ...over,
});

async function run(stderr: string): Promise<ToolResult> {
  const byId = new Map([
    [10, book({ id: 10, formats: ["epub"] })],
    [12, book({ id: 12, formats: ["pdf"] })],
  ]);
  const deps = {
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
      getBook: async (id: number): Promise<Book> => byId.get(id)!,
      bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
    } as unknown as ToolDeps["content"],
    calibre: {
      calibredb: async () => {
        throw new CalibreCliError(1, stderr, stderr);
      },
    } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    log: sink,
    ...noPruneIndex,
  } as WithPrune;
  return mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);
}

const text = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe("calibre_merge_books — transient step failure (#417)", () => {
  it("should_give_a_next_step_when_the_server_is_unreachable", async () => {
    const t = text(await run(REFUSED_CONN));
    expect(t).toContain("Check that Calibre / its Content Server is running");
  });

  it("should_not_show_the_raw_stderr_when_the_server_is_unreachable", async () => {
    expect(text(await run(REFUSED_CONN))).not.toContain("Errno 61");
  });

  it("should_steer_a_gateway_error_to_retry_shortly", async () => {
    expect(text(await run(GATEWAY))).toContain("it may be restarting — retry shortly");
  });
});

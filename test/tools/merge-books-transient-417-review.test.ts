// #477 review: merge_books never retries, so its transient text must not claim retries; and the
// result carries one steer and one full stop (no doubled punctuation, no second `Next:` line).

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

describe("calibre_merge_books — transient text is honest and single-steer (#477 review)", () => {
  for (const [name, stderr] of [
    ["unreachable", REFUSED_CONN],
    ["gateway", GATEWAY],
  ] as const) {
    it(`should_not_claim_retries_that_never_ran_when_${name}`, async () => {
      expect(text(await run(stderr))).not.toMatch(/after \d+ retr/);
    });

    it(`should_not_double_the_full_stop_before_the_headline_sentence_when_${name}`, async () => {
      expect(text(await run(stderr))).not.toContain("..");
    });
  }

  it("should_state_the_step_once_and_add_no_generic_next_line_when_unreachable", async () => {
    const t = text(await run(REFUSED_CONN));
    // the ledger below "Steps:" repeats each step's note by design; the headline and the tail are what count
    expect(t.split("\nSteps:\n")[0]!.match(/Check that Calibre/g)).toHaveLength(1);
    expect(t).not.toMatch(/^Next:/m);
  });
});

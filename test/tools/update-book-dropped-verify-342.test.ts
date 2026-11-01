// #342: a connection dropped mid-request may arrive after the server committed, so
// calibre_update_book verifies it by re-read like a timeout: landed → success, otherwise the
// existing "may have been committed — verify" steer. Never a retry beyond the transient policy.
import { describe, expect, it, vi } from "vitest";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const CLOSED = "http.client.RemoteDisconnected: Remote end closed connection without response";
const MAY = "may have been committed — verify with calibre_get_book id=1 before retrying";

const book = (tags: string[]): Book => ({
  id: 1,
  uuid: "u1",
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags,
  languages: ["en"],
});

// every calibredb call drops; getBook serves the given snapshots in order (last one repeats)
const setup = (reads: (Book | Error)[], stderr = RESET) => {
  const calibredb = vi.fn(async () => {
    throw new CalibreCliError(1, "calibredb command failed", stderr);
  });
  let n = 0;
  const getBook = vi.fn(async () => {
    const r = reads[Math.min(n++, reads.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  });
  const deps = {
    config: loadConfig({}),
    content: { resolveLibraryId: async () => "Programming_Books", getBook },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  } as unknown as BaseDeps;
  return { deps, calibredb };
};

const run = (deps: BaseDeps) => updateBookTool.handler({ id: 1, changes: { tags: ["new"] } }, deps);
const text = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

describe("calibre_update_book — dropped connection is verified by re-read (#342)", () => {
  it("should_report_success_when_the_dropped_write_landed", async () => {
    const { deps } = setup([book(["old"]), book(["new"])]);
    const r = await run(deps);
    expect([r.isError, r.structuredContent]).toEqual([
      undefined,
      { id: 1, changed: [{ field: "tags", before: ["old"], after: ["new"] }], noop: false },
    ]);
  });

  it("should_say_updated_in_the_text_when_a_remote_close_landed", async () => {
    const { deps } = setup([book(["old"]), book(["new"])], CLOSED);
    expect(text(await run(deps))).toMatch(/^Updated book 1: tags\./);
  });

  it("should_keep_the_steer_when_the_re_read_shows_nothing_landed", async () => {
    const { deps } = setup([book(["old"])]);
    const r = await run(deps);
    expect([r.isError, text(r).includes(MAY)]).toEqual([true, true]);
  });

  it("should_keep_the_steer_when_the_re_read_fails", async () => {
    const { deps } = setup([book(["old"]), new Error("server gone")]);
    const r = await run(deps);
    expect([r.isError, text(r).includes(MAY)]).toEqual([true, true]);
  });

  it("should_not_retry_beyond_the_transient_policy", async () => {
    const { deps, calibredb } = setup([book(["old"]), book(["new"])]);
    await run(deps);
    expect(calibredb).toHaveBeenCalledTimes(3);
  });
});

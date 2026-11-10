// #417 (whole-wave review): every failed-write outcome, driven through each write tool's handler.
// The result's Code: is the outcome's code, and the text states each next step once — no second
// `Next:` line restating the inline step, no Next: for a code whose step is already in the text.

import { describe, it, expect, vi } from "vitest";
import { bulkUpdateTool } from "../../src/tools/calibre_bulk_update.js";
import { updateBookTool } from "../../src/tools/calibre_update_book.js";
import { mergeBooksTool } from "../../src/tools/calibre_merge_books.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { Book } from "../../src/domain/book.js";
import { CalibreCliError, CalibreCliTimeoutError } from "../../src/domain/errors.js";
import type { BaseDeps, ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { textOf } from "./text-of.js";

vi.mock("../../src/calibre/http.js", () => ({
  downloadToFile: vi.fn(async () => ({ bytes: 1 })),
}));

const RESET = "ConnectionResetError: [Errno 54] Connection reset by peer";
const CONN_REFUSED = "ConnectionRefusedError: [Errno 61] Connection refused";
const GATEWAY = "HTTP Error 503: Service Unavailable";
const FORBIDDEN = "HTTP Error 403: Forbidden";
const TIMEOUT = "timeout";

/** A failing calibredb: call N throws outcomes[N-1]; past the end it repeats the last one. */
const failing = (...outcomes: string[]) => {
  const spy = vi.fn(async () => {
    const o = outcomes[Math.min(spy.mock.calls.length, outcomes.length) - 1]!;
    if (o === TIMEOUT) throw new CalibreCliTimeoutError("calibredb command timed out");
    throw new CalibreCliError(1, "calibredb command failed", o);
  });
  return spy;
};

// Two step families: verify the write, or fix the server. Each may appear once per result.
const verifySteers = (t: string) => t.match(/(?:verify|check|re-read)[^.\n]*calibre_get_book/gi)?.length ?? 0;
const serverSteers = (t: string) =>
  t.match(/Check that Calibre|start it in Calibre|retry shortly|--enable-local-write/g)?.length ?? 0;
const nextLines = (t: string) => t.match(/^Next:/gm)?.length ?? 0;
/** The message above the merge ledger: the ledger repeats each step's note by design. */
const head = (t: string) => t.split("\nSteps:\n")[0]!;

const expectOneStep = (t: string, family: "verify" | "server" | "both") => {
  expect({ verify: verifySteers(t) <= 1, server: serverSteers(t) <= 1, next: nextLines(t) }).toEqual({
    verify: true,
    server: true,
    next: 0,
  });
  expect(verifySteers(t) + serverSteers(t)).toBeGreaterThanOrEqual(family === "both" ? 2 : 1);
};

const book = (id: number, tags = ["old"]): Book => ({
  id,
  uuid: `u${id}`,
  title: "T",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags,
  languages: ["en"],
});

/** The re-read after the failed write: no change, or the re-read itself fails. */
const metaDeps = (calibredb: ReturnType<typeof failing>, reRead: "unchanged" | "throws"): BaseDeps =>
  ({
    config: loadConfig({}),
    content: {
      resolveLibraryId: async () => "Programming_Books",
      getBook: async (id: number) => {
        if (calibredb.mock.calls.length > 0 && reRead === "throws") throw new Error("Content Server gone");
        return book(id);
      },
      booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, book(id)] as const)),
    },
    calibre: { calibredb },
    sleep: async () => {},
    log,
  }) as unknown as BaseDeps;

interface Case {
  name: string;
  outcomes: string[];
  reRead: "unchanged" | "throws";
  code: string;
  family: "verify" | "server" | "both";
}

const CASES: Case[] = [
  { name: "refused", outcomes: [FORBIDDEN], reRead: "unchanged", code: "write_refused", family: "server" },
  {
    name: "transient, unreachable",
    outcomes: [CONN_REFUSED],
    reRead: "unchanged",
    code: "calibre_unreachable",
    family: "server",
  },
  {
    name: "transient, gateway 5xx",
    outcomes: [GATEWAY],
    reRead: "unchanged",
    code: "calibre_unreachable",
    family: "server",
  },
  {
    name: "dropped, not confirmed",
    outcomes: [RESET],
    reRead: "unchanged",
    code: "write_unverified",
    family: "verify",
  },
  {
    name: "timeout, re-read unchanged",
    outcomes: [TIMEOUT],
    reRead: "unchanged",
    code: "write_unverified",
    family: "verify",
  },
  { name: "timeout, re-read fails", outcomes: [TIMEOUT], reRead: "throws", code: "write_unverified", family: "verify" },
  {
    name: "dropped then refused, re-read fails",
    outcomes: [RESET, FORBIDDEN],
    reRead: "throws",
    code: "write_unverified",
    family: "verify",
  },
];

describe("calibre_update_book — every failed-write outcome (#417)", () => {
  for (const c of CASES) {
    it(`should_code_${c.code}_and_state_one_step_per_family_when_${c.name}`, async () => {
      const r = await updateBookTool.handler(
        { id: 1, changes: { tags: ["new"] } },
        metaDeps(failing(...c.outcomes), c.reRead),
      );
      expect(r.structuredContent?.errorCode).toBe(c.code);
      expectOneStep(textOf(r), c.family);
    });
  }
});

describe("calibre_bulk_update — every failed-write outcome that ends in an error (#417)", () => {
  // A per-book failure with later books still going is a partial success (no Code); the stops
  // below are the outcomes that end the run as an error.
  const STOPS = CASES.filter((c) =>
    ["refused", "transient, unreachable", "dropped, not confirmed", "dropped then refused, re-read fails"].includes(
      c.name,
    ),
  );
  for (const c of STOPS) {
    it(`should_code_${c.code}_and_state_one_step_per_family_when_${c.name}`, async () => {
      const r = await bulkUpdateTool.handler(
        { changes: { tags: ["new"] }, ids: [1, 2], preview: false },
        metaDeps(failing(...c.outcomes), c.reRead),
      );
      expect(r.structuredContent?.errorCode).toBe(c.code);
      const t = textOf(r);
      expect({ verify: verifySteers(t) <= 1, server: serverSteers(t) <= 1, next: nextLines(t) }).toEqual({
        verify: true,
        server: true,
        next: 0,
      });
    });
  }

  it("should_state_a_timed_out_unverified_book_once_in_its_failed_line", async () => {
    const r = await bulkUpdateTool.handler(
      { changes: { tags: ["new"] }, ids: [1], preview: false },
      metaDeps(failing(TIMEOUT), "throws"),
    );
    expect(verifySteers(textOf(r))).toBe(1);
  });
});

describe("calibre_merge_books — every failed-write outcome on the first step (#417)", () => {
  const run = async (outcomes: string[]): Promise<ToolResult> => {
    const byId = new Map([
      [10, book(10)],
      [12, { ...book(12), formats: ["pdf"] }],
    ]);
    byId.set(10, { ...book(10), formats: ["epub"] });
    const calibredb = failing(...outcomes);
    const deps = {
      config: loadConfig({}),
      content: {
        resolveLibraryId: async () => "Programming_Books",
        booksByIds: async (ids: number[]) => new Map(ids.map((id) => [id, byId.get(id) ?? null] as const)),
        getBook: async (id: number): Promise<Book> => byId.get(id)!,
        bookMergeFacts: async () => ({ customFields: [], hasCover: true }),
      } as unknown as ToolDeps["content"],
      calibre: { calibredb } as unknown as ToolDeps["calibre"],
      extractor: {} as ToolDeps["extractor"],
      log,
    } as BaseDeps;
    return mergeBooksTool.handler({ targetId: 10, sourceIds: [12], mode: "merge", confirm: true }, deps);
  };

  const MERGE_CASES: [string, string[], string, "verify" | "server"][] = [
    ["refused", [FORBIDDEN], "write_refused", "server"],
    ["transient, unreachable", [CONN_REFUSED], "calibre_unreachable", "server"],
    ["transient, gateway 5xx", [GATEWAY], "calibre_unreachable", "server"],
    ["dropped, not confirmed", [RESET], "write_unverified", "verify"],
    ["timeout, not confirmed", [TIMEOUT], "write_unverified", "verify"],
  ];
  for (const [name, outcomes, code, family] of MERGE_CASES) {
    it(`should_code_${code}_and_state_one_step_when_${name}`, async () => {
      const r = await run(outcomes);
      expect(r.structuredContent?.errorCode).toBe(code);
      const t = head(textOf(r));
      expect({ verify: verifySteers(t) <= 1, server: serverSteers(t) <= 1, next: nextLines(textOf(r)) }).toEqual({
        verify: true,
        server: true,
        next: 0,
      });
      expect(family === "verify" ? verifySteers(t) : serverSteers(t)).toBe(1);
    });
  }
});

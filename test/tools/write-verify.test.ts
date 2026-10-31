import { describe, it, expect } from "vitest";
import type { Book } from "../../src/domain/book.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import type { BaseDeps } from "../../src/tools/deps.js";
import { verifyTimedOutWrite } from "../../src/app/write-policy.js";

const book = (over: Partial<Book> = {}): Book => ({
  id: 7,
  uuid: "u-7",
  title: "Old",
  authors: ["A"],
  identifiers: {},
  formats: ["pdf"],
  tags: ["old"],
  languages: [],
  ...over,
});

/** Fake content whose re-read answers only for book 7 in library "Lib"; anything else 404s. */
function deps(reread: () => Promise<Book>): BaseDeps {
  const content = {
    getBook: async (id: number, library?: string): Promise<Book> => {
      if (id !== 7 || library !== "Lib") throw new CalibreHttpError(404, "u", "Not Found");
      return reread();
    },
  };
  return { content } as unknown as BaseDeps;
}

describe("verifyTimedOutWrite (#221)", () => {
  it("reports landed with the re-read book when every requested field is on the server", async () => {
    const after = book({ tags: ["new"], title: "New" });
    const r = await verifyTimedOutWrite(
      deps(async () => after),
      {
        id: 7,
        before: book(),
        changes: { tags: ["new"], title: "New" },
        library: "Lib",
      },
    );
    expect(r).toEqual({ status: "landed", after });
  });

  it("reports not-landed when the re-read still shows the old values", async () => {
    const r = await verifyTimedOutWrite(
      deps(async () => book()),
      {
        id: 7,
        before: book(),
        changes: { tags: ["new"] },
        library: "Lib",
      },
    );
    expect(r).toEqual({ status: "not-landed" });
  });

  it("reports not-landed when only some of the requested fields landed", async () => {
    const r = await verifyTimedOutWrite(
      deps(async () => book({ tags: ["new"] })),
      {
        id: 7,
        before: book(),
        changes: { tags: ["new"], title: "New" },
        library: "Lib",
      },
    );
    expect(r).toEqual({ status: "not-landed" });
  });

  it("reports unverifiable when the re-read itself fails", async () => {
    const r = await verifyTimedOutWrite(
      deps(async () => {
        throw new CalibreHttpError(0, "u", "Cannot reach Calibre Content Server");
      }),
      { id: 7, before: book(), changes: { tags: ["new"] }, library: "Lib" },
    );
    expect(r).toEqual({ status: "unverifiable" });
  });

  it("re-reads the same book in the same library the write targeted", async () => {
    // a different library makes the fake 404 — the helper must not drop `library`
    const r = await verifyTimedOutWrite(
      deps(async () => book({ tags: ["new"] })),
      {
        id: 7,
        before: book(),
        changes: { tags: ["new"] },
        library: "Other",
      },
    );
    expect(r).toEqual({ status: "unverifiable" });
  });

  it("reports unverifiable for an empty change set instead of a vacuous landed", async () => {
    const r = await verifyTimedOutWrite(
      deps(async () => book()),
      {
        id: 7,
        before: book(),
        changes: {},
        library: "Lib",
      },
    );
    expect(r).toEqual({ status: "unverifiable" });
  });
});

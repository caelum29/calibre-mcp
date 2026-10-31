// #308: Calibre sometimes returns snippets whose >>markers<< sit on words that aren't in the
// query (shifted past the real match). FullTextSearch.snippets must re-highlight those
// client-side, leave correctly highlighted and unmarked snippets byte-for-byte alone, and
// treat FTS5 operators as syntax, not terms.
import { describe, expect, it } from "vitest";
import { FullTextSearch } from "../../src/calibre/fts.js";
import { asLibId } from "../../src/calibre/lib-id.js";
import { Deadline } from "../../src/shared/deadline.js";

const LIB = asLibId("Programming_Books");

/** Snippets for book 1 after a round trip through a fake Content Server returning `raw`. */
async function snippetsFor(query: string, raw: string[]): Promise<string[]> {
  const fts = new FullTextSearch({
    ftsSearch: async () => Promise.reject(new Error("unused")),
    ftsSnippets: async () => new Map([[1, raw]]),
  });
  const batch = await fts.snippets(query, LIB, [1], { deadline: new Deadline(45_000) });
  return batch.byBook.get(1) ?? [];
}

// Verbatim from the issue (book #560, EPUB only, query "event sourcing" quoted).
const BOOK_560_SHIFTED =
  "…By leveraging mmap to build an event store, coupled with the event sourcing design paradigm which we will >>discuss next<<, modern exchanges can build low-latency microservices inside a server.\n\nEvent sourcing\n\nWe discussed event sourcing in >>the “Digital<< Wallet” chapter. >>Refer to<< that chapter for an in-depth review of event sourcing.\n\nThe concept of event sourcing >>is not<< hard to understand. >>In<<…";
const BOOK_560_FIXED =
  "…By leveraging mmap to build an event store, coupled with the >>event sourcing<< design paradigm which we will discuss next, modern exchanges can build low-latency microservices inside a server.\n\n>>Event sourcing<<\n\nWe discussed >>event sourcing<< in the “Digital Wallet” chapter. Refer to that chapter for an in-depth review of >>event sourcing<<.\n\nThe concept of >>event sourcing<< is not hard to understand. In…";

// Book #644, second (shifted) variant, query event sourcing unquoted.
const BOOK_644_SHIFTED =
  "…Undo >>Bad<< Deltas with >>New<< Deltas-Build >>Forward<<: Undo Bad Deltas with New Deltas, Event >>Design<<\n\nfor event sourcing, Delta Events for Event Sourcing-Delta Events for Event Sourcing\n\nproblems with, There >>is<< an infinite >>amount<< >>of<< delta >>event<< types->>Inability<< >>to<< maintain >>historical<< data";
const BOOK_644_FIXED =
  "…Undo Bad Deltas with New Deltas-Build Forward: Undo Bad Deltas with New Deltas, >>Event<< Design\n\nfor >>event<< >>sourcing<<, Delta >>Events<< for >>Event<< >>Sourcing<<-Delta >>Events<< for >>Event<< >>Sourcing<<\n\nproblems with, There is an infinite amount of delta >>event<< types-Inability to maintain historical data";

describe("FTS snippet highlight repair (#308)", () => {
  it("should_rehighlight_the_book_560_phrase_snippet_on_event_sourcing", async () => {
    expect(await snippetsFor('"event sourcing"', [BOOK_560_SHIFTED])).toEqual([BOOK_560_FIXED]);
  });

  it("should_highlight_event_sourcing_five_times_and_never_discuss_next", async () => {
    const [out] = await snippetsFor('"event sourcing"', [BOOK_560_SHIFTED]);
    expect(out!.match(/>>event sourcing<</gi)).toHaveLength(5);
    expect(out).not.toContain(">>discuss next<<");
  });

  it("should_rehighlight_the_shifted_book_644_variant_for_bare_words", async () => {
    expect(await snippetsFor("event sourcing", [BOOK_644_SHIFTED])).toEqual([BOOK_644_FIXED]);
  });

  it("should_leave_the_correct_book_755_snippet_unchanged", async () => {
    const ok = "…we will use >>event sourcing<< to persist the >>Event-Sourced<< Domain Model’s state…";
    expect(await snippetsFor('"event sourcing"', [ok])).toEqual([ok]);
  });

  it("should_repair_only_the_bad_variant_of_a_book", async () => {
    const ok = "Stemmed matches: >>events<< and >>sourced<< data.";
    const bad = "Some >>words<< about event sourcing.";
    expect(await snippetsFor("event sourcing", [ok, bad])).toEqual([ok, "Some words about >>event<< >>sourcing<<."]);
  });

  it("should_never_inject_markers_into_an_unmarked_snippet", async () => {
    const plain = "plain event sourcing text with no markers";
    expect(await snippetsFor("event sourcing", [plain])).toEqual([plain]);
  });

  it("should_not_count_boolean_operators_as_query_terms", async () => {
    // "and" is not a term of `cqrs AND sourcing`, so a highlight on it is a shifted one.
    expect(await snippetsFor("cqrs AND sourcing", ["use >>and<< cqrs with sourcing"])).toEqual([
      "use and >>cqrs<< with >>sourcing<<",
    ]);
  });

  it("should_not_count_NOT_or_NEAR_as_terms", async () => {
    expect(
      await snippetsFor('sourcing NOT kafka OR NEAR("event" "log", 5)', ["it is >>not<< near the event log"]),
    ).toEqual(["it is not near the >>event<< >>log<<"]);
  });

  it("should_match_cyrillic_terms_case_insensitively", async () => {
    expect(await snippetsFor("Архітектура", ["Це >>книга<< про архітектура систем"])).toEqual([
      "Це книга про >>архітектура<< систем",
    ]);
  });

  it("should_strip_curly_quotes_from_query_terms", async () => {
    expect(await snippetsFor("“event”", [">>the<< event"])).toEqual(["the >>event<<"]);
  });

  it("should_accept_a_prefix_query_highlight_as_valid", async () => {
    const ok = "built from >>microservices<< and queues";
    expect(await snippetsFor("micro*", [ok])).toEqual([ok]);
  });
});

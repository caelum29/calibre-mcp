// #389 guards around column-name skipping outside NOT: Cyrillic operands, loose `<<`/`>>` code,
// and column names that are also real words in the book keep their highlight only when queried.
import { describe, expect, it } from "vitest";
import { repairSnippets } from "../../src/calibre/fts-highlight.js";

const M = { start: ">>", end: "<<" };
const repair = (query: string, snippet: string): string => repairSnippets(query, [snippet], M)[0]!;

describe("FTS highlight repair — column filter guards (#389)", () => {
  it("should_highlight_an_inflected_cyrillic_operand_but_not_the_column_name", () => {
    expect(repair("title:контейнер", ">>bogus<< title контейнеры")).toBe("bogus title >>контейнеры<<");
  });

  it("should_leave_loose_stream_operators_untouched_next_to_a_filtered_term", () => {
    expect(repair("title:docker", "std::cout << >>bogus<< >> y << docker")).toBe(
      "std::cout << bogus >> y << >>docker<<",
    );
  });

  it("should_keep_a_correct_highlight_of_the_operand", () => {
    expect(repair("{title authors}:docker OR swarm", ">>docker<< title >>swarm<<")).toBe(">>docker<< title >>swarm<<");
  });
});

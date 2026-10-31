// Library spelling for tags a bulk write adds (#321). Calibre keeps one case-insensitive item
// per tag and RENAMES it on every book when a different case is set (#332), so `tags_add python`
// must write the library's existing `Python`, never a new spelling of it.

import { sameItemName } from "../domain/book-fields.js";
import type { ToolDeps } from "../tools/deps.js";

/**
 * Map each tag to the spelling the library already uses: from `known` (tags already in hand,
 * e.g. the selected books') first, else from one book found by an exact tag search. A tag the
 * library doesn't have yet keeps the caller's spelling.
 */
export async function resolveTagSpellings(
  deps: Pick<ToolDeps, "content">,
  tags: readonly string[],
  known: readonly string[],
  library?: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const tag of tags) {
    const local = known.find((k) => sameItemName(k, tag));
    out.push(local ?? (await librarySpelling(deps, tag, library)) ?? tag);
  }
  return out;
}

// `tags:"=x"` is Calibre's exact, case-insensitive tag match; one hit is enough to read the spelling.
async function librarySpelling(
  deps: Pick<ToolDeps, "content">,
  tag: string,
  library?: string,
): Promise<string | undefined> {
  const quoted = tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const page = await deps.content.search({ query: `tags:"=${quoted}"`, library, num: 1 });
  const id = page.bookIds[0];
  if (id === undefined) return undefined;
  const book = await deps.content.getBook(id, library);
  return book.tags.find((t) => sameItemName(t, tag));
}

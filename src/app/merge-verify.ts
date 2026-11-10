// Re-reads that tell whether a calibre_merge_books step landed after a timeout or a dropped
// connection (#413). They only answer "landed?"; settleFailedStep (write-policy.ts) decides the outcome.

import { CalibreHttpError } from "../domain/errors.js";
import type { Book } from "../domain/book.js";
import type { ReReadCheck } from "./write-policy.js";

/** The one read these re-checks need: a book by id (a narrow port, not the whole tool deps). */
export interface BookReader {
  content: { getBook(id: number, library?: string): Promise<Book> };
}

/** Phase 1 (`add_format`): landed when the target now holds `format`. A failed re-read is unverifiable. */
export async function formatOnTarget(
  deps: BookReader,
  targetId: number,
  format: string,
  library?: string,
): Promise<ReReadCheck<string>> {
  try {
    const book = await deps.content.getBook(targetId, library);
    return book.formats.includes(format) ? { status: "landed", after: format } : { status: "not-landed" };
  } catch {
    return { status: "unverifiable" };
  }
}

/**
 * Phase 3 (`remove`): landed when every source 404s (a removed book 404s at once on /ajax);
 * a source that still reads back is not-landed; any other re-read failure is unverifiable.
 * `remaining` = the sources not confirmed gone, i.e. what a re-run must still remove.
 */
export async function sourcesRemoved(
  deps: BookReader,
  sourceIds: readonly number[],
  library?: string,
): Promise<{ check: ReReadCheck<readonly number[]>; remaining: number[] }> {
  const states = await Promise.all(
    sourceIds.map((id) =>
      deps.content.getBook(id, library).then(
        () => "present" as const,
        (e: unknown) => (e instanceof CalibreHttpError && e.status === 404 ? ("gone" as const) : ("unknown" as const)),
      ),
    ),
  );
  const remaining = sourceIds.filter((_, i) => states[i] !== "gone");
  if (remaining.length === 0) return { check: { status: "landed", after: sourceIds }, remaining };
  const check: ReReadCheck<readonly number[]> = states.includes("present")
    ? { status: "not-landed" }
    : { status: "unverifiable" };
  return { check, remaining };
}

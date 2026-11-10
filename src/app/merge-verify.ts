// Re-reads that tell whether a calibre_merge_books step landed after a timeout or a dropped
// connection (#413). They only answer "landed?"; settleFailedStep (write-policy.ts) decides the outcome.

import { CalibreHttpError } from "../domain/errors.js";
import type { BaseDeps } from "../tools/deps.js";
import type { ReReadCheck } from "./write-policy.js";

/** Phase 1 (`add_format`): landed when the target now holds `format`. A failed re-read is unverifiable. */
export async function formatOnTarget(
  deps: BaseDeps,
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
 */
export async function sourcesRemoved(
  deps: BaseDeps,
  sourceIds: readonly number[],
  library?: string,
): Promise<ReReadCheck<readonly number[]>> {
  const states = await Promise.all(
    sourceIds.map((id) =>
      deps.content.getBook(id, library).then(
        () => "present" as const,
        (e: unknown) => (e instanceof CalibreHttpError && e.status === 404 ? ("gone" as const) : ("unknown" as const)),
      ),
    ),
  );
  if (states.every((s) => s === "gone")) return { status: "landed", after: sourceIds };
  return states.includes("present") ? { status: "not-landed" } : { status: "unverifiable" };
}

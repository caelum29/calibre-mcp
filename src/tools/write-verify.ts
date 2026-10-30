// Shared #33 check for routed writes whose calibredb call TIMED OUT. The Content Server may
// have committed before the CLI gave up, so every write tool re-reads the book and decides
// landed / not-landed / unverifiable from that, instead of reporting the timeout as failure.

import { changesSatisfied } from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import type { Book } from "../domain/book.js";
import type { ToolDeps } from "./types.js";

/** What a timed-out write is, judged from a re-read of the book. */
export type TimedOutWriteCheck =
  | { status: "landed"; after: Book }
  | { status: "not-landed" }
  | { status: "unverifiable" };

/** The write being verified: target book, its pre-write snapshot, and the requested changes. */
export interface TimedOutWrite {
  id: number;
  before: Book;
  changes: Record<string, ChangeValue>;
  library?: string;
}

/**
 * Re-read the book after a timed-out routed write and classify it. A failed re-read is
 * `unverifiable` (the write MAY have landed), never `not-landed`.
 */
export async function verifyTimedOutWrite(deps: ToolDeps, write: TimedOutWrite): Promise<TimedOutWriteCheck> {
  // nothing requested means nothing to confirm — don't let an empty set read as "landed"
  if (Object.keys(write.changes).length === 0) return { status: "unverifiable" };
  let after: Book;
  try {
    after = await deps.content.getBook(write.id, write.library);
  } catch {
    return { status: "unverifiable" };
  }
  return changesSatisfied(write.before, after, write.changes) ? { status: "landed", after } : { status: "not-landed" };
}

// Shared classification of a Content-Server write refusal. calibredb routed through the
// server returns Forbidden/401/403 when anonymous local writes are blocked; every write
// tool turns that into the same actionable guidance (CAPABILITIES §2) instead of a raw error.

import { CalibreCliError } from "../domain/errors.js";

const WRITE_REFUSED = /forbidden|unauthorized|\b401\b|\b403\b/i;

/** True when a calibredb failure looks like the server refusing an anonymous write. */
export function isWriteRefused(err: unknown): boolean {
  return err instanceof CalibreCliError && WRITE_REFUSED.test(err.stderr ?? "");
}

/** The actionable message shown when the server refuses a write. */
export const WRITE_REFUSED_MESSAGE =
  "Calibre refused the write. Anonymous writes are blocked — restart the Content Server " +
  "with --enable-local-write (localhost), or configure an authenticated non-restricted user. " +
  "See the README's \"Enabling writes\" section.";

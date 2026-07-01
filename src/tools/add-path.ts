// Path whitelist for calibre_add_book (DESIGN §5). A caller-supplied path is only importable
// if it resolves — symlinks included — to a regular file inside one of the configured roots.
// Mirrors extract.ts's cache-boundary guard: realpath, then a `startsWith(root + sep)` check.

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export type AddPathResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

/**
 * Validate that `candidate` is a real file inside one of `roots`. Resolving with realpath
 * defeats `..` traversal and symlink escapes (a link pointing outside the roots is rejected
 * because its real target is compared, not the link path).
 */
export function validateAddPath(candidate: string, roots: string[]): AddPathResult {
  let resolved: string;
  try {
    resolved = realpathSync(path.resolve(candidate));
  } catch {
    return { ok: false, reason: `File not found: ${candidate}` };
  }

  try {
    if (!statSync(resolved).isFile()) {
      return { ok: false, reason: `Not a regular file: ${candidate}` };
    }
  } catch {
    return { ok: false, reason: `File not found: ${candidate}` };
  }

  const inside = roots.some((root) => {
    let realRoot: string;
    try {
      realRoot = realpathSync(path.resolve(root));
    } catch {
      return false; // a non-existent root can't contain anything
    }
    return resolved === realRoot || resolved.startsWith(realRoot + path.sep);
  });

  if (!inside) {
    return {
      ok: false,
      reason:
        `Path is outside the allowed import roots. Allowed: ${roots.join(", ")}. ` +
        `Set CALIBRE_MCP_ADD_ROOTS to add more.`,
    };
  }
  return { ok: true, resolved };
}

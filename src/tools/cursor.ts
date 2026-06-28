// Opaque pagination cursor. SDK 1.29.0's CallToolResult has NO top-level nextCursor
// (verified against installed types), so per-tool pagination is an app-level convention:
// we mint an opaque string, carry it inside structuredContent, and accept it back via the
// `cursor` input param. The cursor is bound to {query, sort} so reuse against a different
// query silently resets to offset 0 rather than returning wrong pages.

export interface SearchCursor {
  offset: number;
  query: string;
  sort?: string;
}

/** Encode a cursor to a base64url JSON string. */
export function encodeCursor(c: SearchCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/**
 * Decode a cursor. Fully TOLERANT — returns undefined on missing/garbage/invalid input
 * (never throws, so a bad cursor can't trip a -32602). Negative offsets are rejected.
 */
export function decodeCursor(s: string | undefined): SearchCursor | undefined {
  if (!s) return undefined;
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const c = parsed as Record<string, unknown>;
    if (typeof c.offset !== "number" || !Number.isFinite(c.offset) || c.offset < 0) return undefined;
    if (typeof c.query !== "string") return undefined;
    const sort = typeof c.sort === "string" ? c.sort : undefined;
    return { offset: Math.trunc(c.offset), query: c.query, sort };
  } catch {
    return undefined;
  }
}

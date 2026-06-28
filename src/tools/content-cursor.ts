// Opaque cursor for walking one book's extracted text (calibre_get_content). Mirrors the
// search cursor (cursor.ts) but binds {offset, id, format} so a cursor minted for one
// book/format can't be replayed against another — a mismatch silently restarts at offset 0.

export interface ContentCursor {
  offset: number;
  id: number;
  format: string;
}

/** Encode a content cursor to a base64url JSON string. */
export function encodeContentCursor(c: ContentCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/**
 * Decode a content cursor. Fully TOLERANT — returns undefined on missing/garbage/invalid
 * input (never throws, so a bad cursor can't trip a -32602). Negative offsets are rejected.
 */
export function decodeContentCursor(s: string | undefined): ContentCursor | undefined {
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const c = parsed as Record<string, unknown>;
    if (typeof c.offset !== "number" || !Number.isFinite(c.offset) || c.offset < 0) return undefined;
    if (typeof c.id !== "number" || !Number.isFinite(c.id)) return undefined;
    if (typeof c.format !== "string") return undefined;
    return { offset: Math.trunc(c.offset), id: Math.trunc(c.id), format: c.format };
  } catch {
    return undefined;
  }
}

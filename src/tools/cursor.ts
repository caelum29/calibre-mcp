// Opaque page cursor for the list tools (calibre_search, list_categories, quality_report,
// find_duplicates). MCP CallToolResult has no per-tool nextCursor, so paging is an app-level
// convention: we mint an opaque token, return it in both channels, and accept it back via the
// `cursor` param. A token is bound to {v, libId, mode, query, sort}; reusing it against another
// library, mode or query — or passing a pre-upgrade token — is an actionable error (#305),
// never a silent restart at 0 or an offset applied to a different result set.

import { toolError } from "./result.js";
import type { ToolResult } from "./types.js";

/** Bump when the token shape changes; older tokens then fail with "Invalid cursor". */
const CURSOR_VERSION = 2;

/** What a cursor continues: one tool call's library, mode and effective query (+ sort). */
export interface CursorBinding {
  /** Resolved library ID (D-008) — `library` omitted resolves to the default library. */
  libId: string;
  /** Tool + mode, e.g. `search:meta`, `categories`, `dup:identical`. */
  mode: string;
  /** Effective query key (scoped query, field+filter, check set…). */
  query: string;
  sort?: string;
}

/** A decoded token: the binding plus where the next page starts. */
export interface SearchCursor extends CursorBinding {
  offset: number;
}

/** Encode a cursor to a base64url JSON string. */
export function encodeCursor(c: SearchCursor): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...c }), "utf8").toString("base64url");
}

/**
 * Decode a cursor. Fully TOLERANT — returns undefined on missing/garbage/old-shape input
 * (never throws, so a bad cursor can't trip a -32602). Negative offsets are rejected.
 */
export function decodeCursor(s: string | undefined): SearchCursor | undefined {
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const c = parsed as Record<string, unknown>;
    if (c.v !== CURSOR_VERSION) return undefined;
    if (typeof c.offset !== "number" || !Number.isFinite(c.offset) || c.offset < 0) return undefined;
    if (typeof c.libId !== "string" || typeof c.mode !== "string" || typeof c.query !== "string") return undefined;
    const sort = typeof c.sort === "string" ? c.sort : undefined;
    return { offset: Math.trunc(c.offset), libId: c.libId, mode: c.mode, query: c.query, sort };
  } catch {
    return undefined;
  }
}

/** Where to start a page: the cursor's offset, or an actionable error for the tool to return. */
export type CursorStart = { ok: true; offset: number } | { ok: false; error: string };

/**
 * Resolve the `cursor` param against the current call. No cursor → offset 0. A token that
 * doesn't decode, or that belongs to another library/mode/query/sort, → an error that says how
 * to recover (return-not-throw).
 */
export function resolveCursor(token: string | undefined, bind: CursorBinding, tool: string): CursorStart {
  if (!token) return { ok: true, offset: 0 };
  const restart = `or rerun ${tool} without cursor to start from the first page.`;
  const c = decodeCursor(token);
  if (!c) {
    return {
      ok: false,
      error:
        `Invalid cursor for ${tool} — pass the exact nextCursor token from the previous response (it is opaque). ` +
        `Cursors minted before a server upgrade are no longer valid: rerun ${tool} without cursor to start from the first page.`,
    };
  }
  if (c.libId !== bind.libId) {
    return {
      ok: false,
      error:
        `This cursor is for library "${c.libId}", but this call targets "${bind.libId}" (library omitted = the default library). ` +
        `Pass library "${c.libId}" to keep paging, ${restart}`,
    };
  }
  const field = c.mode !== bind.mode ? "mode" : c.query !== bind.query ? "query" : c.sort !== bind.sort ? "sort" : "";
  if (field) {
    return {
      ok: false,
      error:
        `This cursor belongs to a different ${field} of ${tool} — a cursor only continues the exact call that returned it. ` +
        `Repeat that call's arguments with the cursor, ${restart}`,
    };
  }
  return { ok: true, offset: c.offset };
}

/**
 * The page start for a call's `cursor` param, or the `invalid_input` result to return as-is
 * (the #211 shape). No cursor (undefined / "" — CursorParam maps null there too) → offset 0.
 */
export function pageOffset(
  token: string | undefined,
  bind: CursorBinding,
  tool: string,
): { offset: number } | ToolResult {
  const start = resolveCursor(token, bind, tool);
  return start.ok ? { offset: start.offset } : toolError("invalid_input", start.error);
}

/** Cursor query key for an ids/query/filter book selection (find_duplicates, quality_report). */
export function selectionKey(a: {
  ids?: readonly (number | string)[] | undefined;
  query?: string | undefined;
  filter?: string | undefined;
}): string {
  return [idsKey(a.ids), a.query ?? "", a.filter ?? ""].join(":");
}

/** Key part for an `ids` selection: order and repeats don't change the set, so normalise them. */
function idsKey(ids: readonly (number | string)[] | undefined): string {
  if (!ids?.length) return "";
  const uniq = [...new Set(ids.map(String))];
  return uniq.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(",");
}

/** A page's continuation in both channels: the token and the text line that carries it. */
export interface PageCursor {
  nextCursor?: string;
  /** "" on the last page — nothing to append. */
  textLine: string;
}

/**
 * The one pagination helper (#211/#227). Clients see a single channel each — Desktop text
 * only, Code structuredContent only — so the cursor must ride in both or paging dies in one.
 * `fetched` is the size of the page just served; `total` the full result count.
 */
export function pageCursor(p: CursorBinding & { offset: number; fetched: number; total: number }): PageCursor {
  const next = p.offset + p.fetched;
  if (p.fetched === 0 || next >= p.total) return { nextCursor: undefined, textLine: "" };
  const nextCursor = encodeCursor({ offset: next, libId: p.libId, mode: p.mode, query: p.query, sort: p.sort });
  return { nextCursor, textLine: `More results — continue with cursor: ${nextCursor}` };
}

// Cover-board `_meta` builder shared by the library-scope search tools (#22, #259). Claude
// Desktop strips the tool-result notification, so the payload is also cached for the widget's
// re-pull via calibre_board_data; spec hosts that forward `_meta` get it inline.

import type { BoardPayload } from "../ui/board-cache.js";
import type { ToolDeps } from "./types.js";

/**
 * Cache one search's board payload for the widget's re-pull and return the `_meta` to attach.
 * Library-scope results only — book-scope tools render in chat and the widget collapses itself.
 */
export function boardMeta(
  deps: Pick<ToolDeps, "config" | "boardCache">,
  tool: string,
  payload: Omit<BoardPayload, "tool" | "serverUrl">,
): Record<string, unknown> {
  const full: BoardPayload = { tool, serverUrl: deps.config.serverUrl, ...payload };
  deps.boardCache?.set(full);
  return { calibreBoard: full };
}

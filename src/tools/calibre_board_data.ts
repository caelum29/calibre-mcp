// calibre_board_data — widget-internal data endpoint for the cover board (issue #22).
// Registered with _meta.ui.visibility ["app"]: hosts hide it from the model and only the
// board iframe calls it. Exists because Claude Desktop strips structuredContent/_meta from
// ui/notifications/tool-result — the widget re-pulls the finished search from the
// BoardCache instead of re-running it. Read-only, no Calibre access at all.

import { z } from "zod";
import { defineTool } from "./define.js";
import { toolError, toolOk } from "./result.js";

export const boardDataTool = defineTool({
  name: "calibre_board_data",
  title: "Cover board data (widget-internal)",
  description:
    "Internal endpoint for the in-chat cover-board widget. Returns the cached payload of a " +
    "recent search. Do not call as the model — search results already contain everything this returns.",
  inputSchema: {
    tool: z.string().optional(),
    query: z.string().optional(),
  },
  outputSchema: {
    tool: z.string().optional(),
    query: z.string().optional(),
    kind: z.string().optional(),
    libraryId: z.string().optional(),
    serverUrl: z.string().optional(),
    lowConfidence: z.boolean().optional(),
    total: z.number().optional(),
    books: z
      .array(
        z.object({
          bookId: z.number(),
          title: z.string(),
          authors: z.array(z.string()),
          score: z.number().optional(),
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    const payload = deps.boardCache?.get(args.tool, args.query);
    if (!payload) {
      return toolError(
        "No cached board data for this search — run calibre_search or calibre_semantic_search first.",
      );
    }
    return toolOk(
      [{ type: "text", text: `Board payload: ${payload.books.length} book(s) for "${payload.query}".` }],
      { ...payload },
    );
  },
});

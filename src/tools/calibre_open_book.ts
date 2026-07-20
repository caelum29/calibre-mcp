// calibre_open_book — widget-internal launcher for the widgets' "Open" button (issue #53).
// Sanctioned exec extension of the tools/call channel (map #54): launches the local Calibre
// viewer via the calibre:// URL scheme, which the Calibre installer registers on macOS and
// Windows. Mutates nothing — not a library write, so it sits outside the write gate. A
// custom-viewer override is deferred: the server never knows on-disk library paths.

import { z } from "zod";
import { defineTool } from "./define.js";
import { toolError, toolText } from "./result.js";

type Launcher = (url: string) => Promise<unknown>;

// npm `open` handles per-platform launching (macOS open / Windows Start-Process / xdg-open)
// without the `cmd /c start` shell-injection gotcha of a hand-rolled spawn.
const defaultLauncher: Launcher = async (url) => {
  const { default: open } = await import("open");
  return open(url);
};

let launcher: Launcher = defaultLauncher;

/** Test seam — replace the process-spawning launcher; call with no args to restore. */
export function setLauncher(l?: Launcher): void {
  launcher = l ?? defaultLauncher;
}

export const openBookTool = defineTool({
  name: "calibre_open_book",
  title: "Open book in local viewer (widget-internal)",
  description:
    "Internal endpoint for the in-chat widgets' Open button. Launches a book in the local " +
    "Calibre viewer via the calibre:// scheme. Do not call as the model — use calibre_get_book " +
    "to show a book instead.",
  inputSchema: {
    id: z.coerce.number().int().positive(),
    format: z.string().optional(),
    library: z.string().optional(),
  },
  outputSchema: {
    opened: z.boolean(),
    url: z.string(),
    format: z.string(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    let libraryId: string;
    let formats: string[];
    try {
      libraryId = await deps.content.resolveLibraryId(args.library);
      const book = await deps.content.getBook(args.id, args.library);
      formats = book.formats ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Could not look up book ${args.id}: ${msg}`);
    }
    if (formats.length === 0) {
      return toolError(`Book ${args.id} has no formats to open.`);
    }
    const want = args.format?.toLowerCase();
    const fmt = want ? formats.find((f) => f.toLowerCase() === want) : formats[0];
    if (!fmt) {
      return toolError(
        `Book ${args.id} has no ${args.format ?? ""} format — available: ${formats.join(", ")}.`,
      );
    }
    const url = `calibre://view-book/${libraryId}/${args.id}/${fmt.toUpperCase()}`;
    try {
      await launcher(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(
        `Could not launch the Calibre viewer (${url}): ${msg}. ` +
          `Is Calibre installed? Its installer registers the calibre:// scheme.`,
      );
    }
    return toolText(`Opened book ${args.id} (${fmt.toUpperCase()}) in the local Calibre viewer.`, {
      opened: true,
      url,
      format: fmt.toUpperCase(),
    });
  },
});

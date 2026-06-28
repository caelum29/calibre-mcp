// calibre_list_libraries — list the libraries the Content Server exposes and which is
// default. Also the canonical reachability probe (supersedes calibre_ping).

import { z } from "zod";
import { defineTool } from "./define.js";
import { toolOk } from "./result.js";

export const listLibrariesTool = defineTool({
  name: "calibre_list_libraries",
  title: "List Calibre libraries",
  description:
    "List the Calibre libraries available on the Content Server and which one is the default. Call this first to discover valid library names.",
  inputSchema: {},
  outputSchema: {
    libraries: z
      .array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() }))
      .optional(),
    default: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, deps) => {
    try {
      const info = await deps.content.libraryInfo();
      const libraries = Object.entries(info.libraryMap).map(([id, name]) => ({
        id,
        name,
        isDefault: id === info.defaultLibrary,
      }));
      const names = libraries.map((l) => l.name).join(", ") || "(none)";
      return toolOk([{ type: "text", text: `Libraries: ${names}` }], {
        libraries,
        default: info.defaultLibrary,
      });
    } catch {
      // libraryInfo already logged the cause to stderr; give the model a next step.
      return {
        content: [
          {
            type: "text",
            text: `Error: Cannot reach Calibre Content Server at ${deps.config.serverUrl} — is the Calibre GUI / Content Server running?`,
          },
        ],
        isError: true,
      };
    }
  },
});

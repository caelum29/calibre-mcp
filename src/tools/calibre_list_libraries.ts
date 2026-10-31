// calibre_list_libraries — list the libraries the Content Server exposes and which is
// default. Also the canonical reachability probe (supersedes calibre_ping).

import { z } from "zod";
import { defineTool } from "./define.js";
import { toolError, toolOk } from "./result.js";
import { errorCodeFor } from "../domain/error-codes.js";

export const listLibrariesTool = defineTool({
  name: "calibre_list_libraries",
  title: "List Calibre libraries",
  description:
    "List the Calibre libraries available on the Content Server and which one is the default. Call this first to discover valid library names.",
  inputSchema: {},
  outputSchema: {
    libraries: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })).optional(),
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
      // Desktop shows the model only the text: the id (what tools and calibredb take) and the
      // default marker must live here, not just in structuredContent (#227, #303).
      const lines = libraries.map((l) => `${l.name} (id: ${l.id})${l.isDefault ? " [default]" : ""}`);
      const text = lines.length > 0 ? `Libraries:\n${lines.join("\n")}` : "Libraries: (none)";
      return toolOk([{ type: "text", text }], {
        libraries,
        default: info.defaultLibrary,
      });
    } catch (err) {
      // libraryInfo already logged the cause to stderr; give the model a next step.
      return toolError(
        errorCodeFor(err),
        `Cannot reach Calibre Content Server at ${deps.config.serverUrl} — is the Calibre GUI / Content Server running?`,
      );
    }
  },
});

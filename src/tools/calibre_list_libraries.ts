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
    // Set only when the server's default isn't an exposed library (then `default` is omitted).
    defaultUnavailable: z.string().optional(),
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
      // A default that isn't an exposed library would 404 if the model passed it on, and no line
      // can carry [default] for it: omit it from structuredContent and explain in the text instead.
      const defaultIsListed = libraries.some((l) => l.isDefault);
      const staleDefault = !defaultIsListed && info.defaultLibrary ? info.defaultLibrary : undefined;
      if (staleDefault !== undefined) {
        // Unset `library` resolves to that stale default and 404s, so steer to an explicit id.
        if (libraries.length > 0) {
          lines.push(
            "Pass an explicit library id from this list; leaving library unset would use the unavailable default.",
          );
        }
        lines.push(`Note: the server default "${info.defaultLibrary}" is not an exposed library.`);
      }
      const text = [libraries.length > 0 ? "Libraries:" : "Libraries: (none)", ...lines].join("\n");
      return toolOk([{ type: "text", text }], {
        libraries,
        ...(defaultIsListed ? { default: info.defaultLibrary } : {}),
        ...(staleDefault !== undefined ? { defaultUnavailable: staleDefault } : {}),
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

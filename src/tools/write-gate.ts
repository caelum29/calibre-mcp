// The write gate per call (#435, D-028): with CALIBRE_MCP_ENABLE_WRITE off the server changes
// nothing in the library, but a write tool's previews stay usable. One place for the rule;
// server.ts applies it around every handler, and handlers stay gate-unaware. SDK-free.

import { toolError } from "./result.js";
import type { AnyToolDescriptor, ToolAnnotations, ToolResult } from "./types.js";

/** False for a write tool that has no call writing nothing (`writeCall: "always"`) in a gate-off session. */
export function isListed(tool: AnyToolDescriptor, writeEnabled: boolean): boolean {
  return writeEnabled || !tool.write || typeof tool.writeCall === "function";
}

/**
 * The annotations a session announces: in a gate-off session a listed write tool cannot write,
 * so it is read-only there (and destructiveHint, meaningful only when not read-only, is dropped).
 */
export function sessionAnnotations(tool: AnyToolDescriptor, writeEnabled: boolean): ToolAnnotations {
  if (writeEnabled || !tool.write) return tool.annotations;
  const { destructiveHint: _dropped, ...rest } = tool.annotations;
  return { ...rest, readOnlyHint: true };
}

/** The `write_disabled` refusal when `args` is a Write call in a gate-off session; else undefined. */
export function refuseWriteCall(tool: AnyToolDescriptor, args: unknown, writeEnabled: boolean): ToolResult | undefined {
  if (writeEnabled || !tool.write) return undefined;
  const writes = tool.writeCall === "always" || tool.writeCall === undefined || tool.writeCall(args);
  if (!writes) return undefined;
  return toolError(
    "write_disabled",
    `${tool.name}: this call would change the library, and writes are disabled on this server. ` +
      "Previews (the same call without apply/confirm, or with preview on) still work. Nothing was changed.",
  );
}

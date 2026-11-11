// The write gate per call (#435, D-028): with CALIBRE_MCP_ENABLE_WRITE off the server changes
// nothing in the library, but a write tool's previews stay usable. One place for the rule;
// server.ts applies it around every handler, and handlers stay gate-unaware. SDK-free.

import { z } from "zod";
import { toolError } from "./result.js";
import type { AnyToolDescriptor, ToolAnnotations, ToolResult } from "./types.js";
import { NEEDS_WRITES } from "./writes-remedy.js";

/** True for a write tool with a call that writes nothing (a preview, a dry run, a list). */
function hasPreview(tool: AnyToolDescriptor): boolean {
  return tool.write === true && typeof tool.writeCall === "function";
}

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

/** The outputSchema a session announces: a previewable write tool also declares `writeEnabled` (#554). */
export function sessionOutputSchema(tool: AnyToolDescriptor): z.ZodRawShape | undefined {
  if (!hasPreview(tool) || tool.outputSchema === undefined) return tool.outputSchema;
  return {
    ...tool.outputSchema,
    writeEnabled: z
      .boolean()
      .optional()
      .describe("false on a preview in a session with writes disabled: applying it will be refused (write_disabled)"),
  };
}

/**
 * A gate-off preview of a write tool, marked so the model knows applying will be refused before it
 * proposes to (#554): `writeEnabled: false` in structuredContent, and the remedy in the text unless
 * the handler's own steer (#519) already names it. Anything else is returned unchanged. Runs only
 * after refuseWriteCall let the call through, so `_args` is never a Write call.
 */
export function previewHint(
  tool: AnyToolDescriptor,
  args: unknown,
  result: ToolResult,
  writeEnabled: boolean,
): ToolResult {
  if (writeEnabled || !hasPreview(tool) || result.isError === true) return result;
  const structuredContent = { ...result.structuredContent, writeEnabled: false };
  const texts = result.content.filter((b) => b.type === "text");
  if (texts.some((b) => b.text.includes(NEEDS_WRITES))) return { ...result, structuredContent };
  // one line on the last text block: Desktop shows the model only the text
  const line = `Applying a change ${NEEDS_WRITES}.`;
  let last = -1;
  result.content.forEach((b, i) => {
    if (b.type === "text") last = i;
  });
  const content =
    last === -1
      ? [...result.content, { type: "text" as const, text: line }]
      : result.content.map((b, i) => (i === last && b.type === "text" ? { ...b, text: `${b.text}\n${line}` } : b));
  return { ...result, content, structuredContent };
}

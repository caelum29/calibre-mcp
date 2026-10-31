// Tool result builders + injection fencing. Tools RETURN errors (never throw) so the
// LLM can adapt (DESIGN §3); free-text book data is fenced so it reads as data, not
// instructions (indirect prompt-injection mitigation, DESIGN §5).

import type { PageCursor } from "./cursor.js";
import type { ContentBlock, ToolResult } from "./types.js";

// fence moved to shared/ (#261); re-exported so tool handlers keep their import site
export { fence } from "../shared/fence.js";

/** Success with explicit content blocks (+ optional structured payload). */
export function toolOk(content: ContentBlock[], structured?: Record<string, unknown>): ToolResult {
  return { content, structuredContent: structured };
}

/** Success with a single text block. */
export function toolText(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** One tool result model: the text rendering, its structured mirror, and an optional page. */
export interface ResultModel {
  blocks: ContentBlock[];
  structured: Record<string, unknown>;
  page?: PageCursor;
}

/**
 * Render a result model into BOTH channels (#227): Desktop shows only text, Code only
 * structuredContent. The cursor line is its own block so it never lands inside a fence.
 */
export function renderResult(m: ResultModel): ToolResult {
  const page = m.page;
  if (!page?.nextCursor) return toolOk(m.blocks, m.structured);
  return toolOk([...m.blocks, { type: "text", text: page.textLine }], { ...m.structured, nextCursor: page.nextCursor });
}

/**
 * Error result — LLM-actionable message, not a stack trace. `message` should tell the
 * model what to do next (e.g. "Writes are disabled; set CALIBRE_MCP_ENABLE_WRITE=1").
 */
export function toolError(message: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    structuredContent: structured,
    isError: true,
  };
}

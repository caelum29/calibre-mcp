// #554: in a gate-off session a write tool's preview says that applying will be refused —
// `writeEnabled: false` in structuredContent and one text line — so the model can tell the user
// before proposing to apply. The gate adds it (src/tools/write-gate.ts); handlers stay gate-unaware.

import { describe, it, expect } from "vitest";
import { previewHint, sessionOutputSchema } from "../../src/tools/write-gate.js";
import { allTools } from "../../src/tools/registry.js";
import type { AnyToolDescriptor, ToolResult } from "../../src/tools/types.js";

const HINT_LINE = "Applying a change needs writes enabled (CALIBRE_MCP_ENABLE_WRITE).";

function tool(name: string): AnyToolDescriptor {
  const t = allTools.find((d) => d.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function text(r: ToolResult): string {
  return r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

// The preview calls of the four tools the issue names, with a preview result shaped like the
// handler's (its own #519 steer already names the remedy in the text).
const PREVIEWS: Array<[string, Record<string, unknown>, ToolResult]> = [
  [
    "calibre_bulk_update",
    { ids: [1019], changes: { tags_add: ["x"] } },
    {
      content: [
        { type: "text", text: "Preview: 1 book.\nApplying it needs writes enabled (CALIBRE_MCP_ENABLE_WRITE)." },
      ],
      structuredContent: { preview: true },
    },
  ],
  [
    "calibre_remove_book",
    { ids: [1] },
    {
      content: [
        {
          type: "text",
          text: "Dry-run — nothing removed yet.\nRemoving them needs writes enabled (CALIBRE_MCP_ENABLE_WRITE).",
        },
      ],
      structuredContent: { deleted: false, wouldRemove: [{ id: 1, title: "A" }] },
    },
  ],
  [
    "calibre_merge_books",
    { targetId: 1, sourceIds: [2] },
    {
      content: [
        {
          type: "text",
          text: "Dry run — nothing written. Executing it needs writes enabled (CALIBRE_MCP_ENABLE_WRITE).\n",
        },
      ],
      structuredContent: { status: "planned", targetId: 1, sourceIds: [2] },
    },
  ],
  [
    "calibre_manage_bundles",
    { action: "create", name: "Rust", expression: "tags:Rust" },
    {
      content: [
        {
          type: "text",
          text: "Would create Rust (3 books). Writing it needs writes enabled (CALIBRE_MCP_ENABLE_WRITE).",
        },
      ],
      structuredContent: { action: "create", applied: false, matches: 3 },
    },
  ],
];

describe("previewHint (#554)", () => {
  describe("gate off", () => {
    it.each(PREVIEWS)("should_mark_the_%s_preview_writeEnabled_false", (name, args, result) => {
      const r = previewHint(tool(name), args, result, false);
      expect(r.structuredContent).toEqual({ ...result.structuredContent, writeEnabled: false });
    });

    it.each(PREVIEWS)("should_name_the_remedy_once_in_the_%s_preview_text", (name, args, result) => {
      const r = previewHint(tool(name), args, result, false);
      expect(text(r).match(/needs writes enabled/g)).toHaveLength(1);
      expect(text(r)).toBe(text(result));
    });

    it("should_append_the_hint_line_when_the_text_lacks_the_remedy", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "Found ISBN 9780000000002 in book #1 text (no ISBN is set)." }],
        structuredContent: { bookId: 1, applied: false },
      };
      const r = previewHint(tool("calibre_extract_isbn"), { id: 1 }, result, false);
      expect(r.content).toEqual([
        { type: "text", text: `Found ISBN 9780000000002 in book #1 text (no ISBN is set).\n${HINT_LINE}` },
      ]);
      expect(r.structuredContent).toEqual({ bookId: 1, applied: false, writeEnabled: false });
    });

    it("should_add_writeEnabled_when_the_preview_has_no_structuredContent", () => {
      const result: ToolResult = { content: [{ type: "text", text: "x" }] };
      const r = previewHint(tool("calibre_remove_book"), { ids: [1] }, result, false);
      expect(r.structuredContent).toEqual({ writeEnabled: false });
    });

    it("should_leave_an_error_result_unchanged", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "None of the given ids is a book." }],
        structuredContent: { errorCode: "not_found" },
        isError: true,
      };
      expect(previewHint(tool("calibre_remove_book"), { ids: [1] }, result, false)).toEqual(result);
    });

    it("should_leave_a_read_only_tool_unchanged", () => {
      const result: ToolResult = { content: [{ type: "text", text: "3 hits" }], structuredContent: { total: 3 } };
      expect(previewHint(tool("calibre_search"), { query: "rust" }, result, false)).toEqual(result);
    });
  });

  describe("gate on", () => {
    it.each(PREVIEWS)("should_leave_the_%s_preview_unchanged", (name, args, result) => {
      expect(previewHint(tool(name), args, result, true)).toEqual(result);
    });
  });
});

describe("sessionOutputSchema (#554)", () => {
  it("should_declare_writeEnabled_on_every_previewable_write_tool", () => {
    const previewable = allTools.filter((t) => t.write && typeof t.writeCall === "function").map((t) => t.name);
    const declared = previewable.filter((n) => "writeEnabled" in (sessionOutputSchema(tool(n)) ?? {}));
    expect(declared).toEqual(previewable);
    expect(previewable).toHaveLength(5);
  });

  it("should_not_declare_writeEnabled_on_a_read_only_tool", () => {
    expect("writeEnabled" in (sessionOutputSchema(tool("calibre_search")) ?? {})).toBe(false);
  });
});

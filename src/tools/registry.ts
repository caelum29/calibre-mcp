// The build list of record. server.ts iterates allTools and registers each. Adding a
// tool = implement its module + append it here (nothing else changes at the seam).

import type { AnyToolDescriptor } from "./types.js";
import { listLibrariesTool } from "./calibre_list_libraries.js";
import { searchTool } from "./calibre_search.js";
import { getBookTool } from "./calibre_get_book.js";
import { getContentTool } from "./calibre_get_content.js";
import { listCategoriesTool } from "./calibre_list_categories.js";
import { updateBookTool } from "./calibre_update_book.js";
import { semanticSearchTool } from "./calibre_semantic_search.js";
import { buildIndexTool } from "./calibre_build_index.js";
import { findDuplicatesTool } from "./calibre_find_duplicates.js";
import { qualityReportTool } from "./calibre_quality_report.js";
import { recoverMetadataTool } from "./calibre_recover_metadata.js";
import { extractIsbnTool } from "./calibre_extract_isbn.js";
import { bulkUpdateTool } from "./calibre_bulk_update.js";
import { addBookTool } from "./calibre_add_book.js";
import { removeBookTool } from "./calibre_remove_book.js";
import { boardDataTool } from "./calibre_board_data.js";

export { defineTool } from "./define.js";

export const allTools: AnyToolDescriptor[] = [
  listLibrariesTool,
  searchTool,
  getBookTool,
  getContentTool,
  listCategoriesTool,
  updateBookTool,
  semanticSearchTool,
  buildIndexTool,
  findDuplicatesTool,
  qualityReportTool,
  recoverMetadataTool,
  extractIsbnTool,
  bulkUpdateTool,
  addBookTool,
  removeBookTool,
  // Widget-internal (_meta.ui.visibility ["app"], issue #22) — hosts that honor MCP Apps
  // hide it from the model, so the model-facing surface stays at 15 tools (+ ping).
  boardDataTool,
];

/**
 * Startup invariant: any tool that isn't read-only MUST declare how it writes — either
 * `write` (library write → gated by CALIBRE_MCP_ENABLE_WRITE) or `localWrite` (server
 * index-dir only → intentionally ungated). A `readOnlyHint:false` tool with neither is a
 * silent, unclassified mutation and a gate-audit hole; fail loud at boot rather than ship it.
 */
export function assertWriteClassification(tools: AnyToolDescriptor[] = allTools): void {
  const unclassified = tools.filter(
    (t) => t.annotations.readOnlyHint === false && !t.write && !t.localWrite,
  );
  if (unclassified.length > 0) {
    const names = unclassified.map((t) => t.name).join(", ");
    throw new Error(
      `Tool(s) [${names}] have readOnlyHint:false but neither write nor localWrite — ` +
        `classify each as a library write (write:true) or an index-dir write (localWrite:true).`,
    );
  }
}

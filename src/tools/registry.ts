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
];

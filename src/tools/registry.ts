// The build list of record. server.ts iterates allTools and registers each. Adding a
// tool = implement its module + append it here (nothing else changes at the seam).

import type { AnyToolDescriptor } from "./types.js";
import { listLibrariesTool } from "./calibre_list_libraries.js";
import { searchTool } from "./calibre_search.js";
import { getBookTool } from "./calibre_get_book.js";
import { getContentTool } from "./calibre_get_content.js";
import { listCategoriesTool } from "./calibre_list_categories.js";

export { defineTool } from "./define.js";

export const allTools: AnyToolDescriptor[] = [
  listLibrariesTool,
  searchTool,
  getBookTool,
  getContentTool,
  listCategoriesTool,
];

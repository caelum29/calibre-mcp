// Server-level `instructions` sent at initialize (#262): cross-tool guidance that fits no single
// tool description. SDK-free on purpose; only server.ts hands it to the SDK.

/** Hard cap on the instructions text; short enough that clients don't truncate or ignore it. */
export const MAX_INSTRUCTIONS_LENGTH = 1000;

/** Key rules first: clients and models weight the start of the text most. */
export const SERVER_INSTRUCTIONS = [
  "Calibre library server.",
  "1. Call calibre_list_libraries first; pass the library ID it returns, not the display name.",
  "2. Search: calibre_search for metadata (mode=meta) or book text (mode=fts); calibre_semantic_search for meaning; scope=book searches inside one book.",
  "3. Writes are preview-first: calibre_bulk_update previews by default (preview=false applies); calibre_remove_book is a dry-run until confirm=true. Show the preview to the user first.",
  "4. Write tools are off unless CALIBRE_MCP_ENABLE_WRITE is set; if refused, tell the user rather than retrying.",
].join("\n");

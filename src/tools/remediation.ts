// One place for the "embedding model missing" remediation copy so #49's release and future
// wording edits touch a single file. SDK-free (plain string constants) — safe to import from
// any tool handler. The message lists ALL three install layouts because we do NO runtime
// environment detection (locked #47): the reading LLM picks the branch that fits the user.
//
// Every branch MUST end at the restart step: Node 24 negatively caches a failed package lookup
// for the whole process life (docs/dev/node24-import-retry-probe.md), so installing while the
// server runs can never take effect in-process — a restart is mandatory, not optional.

/** Universal 3-branch install + restart guidance for the optional embedding model. */
export const INSTALL_TRANSFORMERS =
  "The embedding model (@huggingface/transformers, an optional dependency) is not installed. " +
  "Install it for your setup — " +
  "Claude Desktop .mcpb extension: run `npm install @huggingface/transformers` inside the extension " +
  "directory (Settings → Extensions → Advanced shows its path, typically " +
  "~/Library/Application Support/Claude/Claude Extensions/<id>), or reinstall the extension; " +
  "npx / global npm: reinstall WITHOUT `--omit=optional` (e.g. `npm install -g calibre-mcp`, or just " +
  "rerun the npx command); " +
  "dev checkout: `pnpm add @huggingface/transformers`. " +
  "Then RESTART the MCP server — installing while it runs never takes effect (Node caches the failed " +
  "lookup for the whole process life). In Claude Desktop: toggle the extension off/on in " +
  "Settings → Extensions, or restart the app.";

/** Steer to the search that needs no Calibre FTS index and never touches Calibre's DB lock. */
export const KEYWORD_SEARCH_FALLBACK =
  'For keyword search right now, use calibre_semantic_search with mode:"keyword" — it runs on this ' +
  "server's own index (build one with calibre_build_index if the library has none).";

/** How to turn on Calibre's full-text index — a GUI step; indexing a large library takes long. */
// Not under Preferences → Searching: that page only has General / Grouped searches / Similar
// books (Calibre 9.17, checked 2026-10-31) — the old steer pointed there.
export const ENABLE_FTS_STEPS =
  "Enable it in Calibre: click the FT button left of the search bar, turn on full text indexing, " +
  "and let it finish — on a large library that can take hours, and Calibre stays usable meanwhile.";

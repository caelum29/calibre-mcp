# Stability policy

calibre-mcp follows [semantic versioning](https://semver.org). This page says what that covers. The
contract is the **tool surface** an MCP client sees, plus the settings and the closed error-code set,
not the Node API or the internal module layout.

## Covered by semver

A breaking change to any of these is a **major** release.

- **Tool names and inputs:** the names, types and defaults of every input of every model-facing tool.
- **Declared output fields** (`outputSchema` / `structuredContent`): removing or renaming a field, or
  changing its type, is breaking. Adding a field is a minor change.
- **Labelled lines of text results:** the label and value format of each text line that carries a
  declared output field: the cursor, the book id, the error `Code:` and `Next:` lines (on the errors
  named under [Error codes](#error-codes)), and
  `calibre_ping`'s `Index:`, `Semantic search:` and `calibre writes:` lines. The full list, per
  tool, is the [Labelled lines](TOOLS.md#labelled-lines) table, generated from the server's registry.
- **Client channels:** every field a model must act on appears in both the text and the structured
  result, so a client that surfaces only one of the two still works.
- **Stable settings:** `CALIBRE_MCP_SERVER_URL`, `CALIBRE_MCP_LIBRARY`, `CALIBRE_MCP_ENABLE_WRITE`,
  `CALIBRE_MCP_ADD_ROOTS`, `CALIBRE_MCP_CALIBREDB_PATH`, `CALIBRE_MCP_INDEX_DIR`,
  `CALIBRE_MCP_LOG_LEVEL`, `CALIBRE_MCP_MAX_BOOK_BYTES`, `CALIBRE_MCP_BOARD_STYLE`.
- **The closed error-code set** ([below](#error-codes)).
- **The write gate and the preview-first behaviour of write tools.**
- **The resource URI template** `calibre://book/{libId}/{id}`.
- **The minimum Node version** (`engines.node` in `package.json`): raising it is a major release.

## Not covered (may change in a minor release)

- **Prose:** hints, steering sentences, notes, tool descriptions and the server instructions.
- **Tuning settings:** `CALIBRE_MCP_SEMANTIC_FLOOR`, `CALIBRE_MCP_RERANK`,
  `CALIBRE_MCP_INDEX_BUSY_TIMEOUT_MS`. Their meaning is tied to the current models; a change gets a
  CHANGELOG note.
- **Widgets:** the two widget-internal tools, the widget markup and `CALIBRE_MCP_WIDGET_DEBUG`. The
  only promise: hosts without MCP Apps keep working.
- **Search ranking:** result order and scores. Cursor contents are opaque.
- **The semantic index on disk.** It is a rebuildable cache. Instead:
  - the server never answers from an incompatible index silently; it reports it as stale and names the
    rebuild step;
  - additive migrations are automatic;
  - a forced full rebuild ships only in a minor release, never in a patch, and is flagged
    "re-index required" in the CHANGELOG.

## Environment

- **Verified:** macOS with Calibre 9.x. Linux and Windows are not claimed: the code has paths for
  them and the unit suite runs on Linux in CI, but neither has had a live check.
- **Calibre:** tested against 9.x, with no hard minimum.

## Error codes

Every error the server's tool handlers or its write gate return carries one `errorCode` from this
closed set (structured result and the `Code:` line of the text), and a `Next:` line unless the message
already states the step. Adding or removing a code is a contract change. The next step is the generic
one; a call site may give a sharper one.

Errors the MCP SDK answers before any handler runs are outside this contract and carry no
`errorCode`, `Code:` or `Next:`: input-validation failures (an argument that doesn't fit the tool's
schema), and a direct call to `calibre_update_book` or `calibre_add_book` while writes are off (both
tools are hidden then). Adding the lines to these errors later would be a minor change.

| Code | Meaning | Default next step |
|---|---|---|
| `invalid_input` | The call's parameters or query were wrong (or Calibre rejected the request as malformed). | — |
| `not_found` | The book, library or resource does not exist. | — |
| `path_not_allowed` | `calibre_add_book` was given a path outside the allowed folders. | add the folder to CALIBRE_MCP_ADD_ROOTS |
| `write_refused` | Calibre refused a write (the Content Server is read-only for local writes). | enable "Allow un-authenticated local connections to make changes" (Preferences → Sharing over the net), or for a command-line calibre-server restart it with --enable-local-write, or configure an authenticated non-restricted user |
| `write_disabled` | A Write call while this server's write gate is off (`CALIBRE_MCP_ENABLE_WRITE`); previews still work. | ask the user to enable writes on this server: set CALIBRE_MCP_ENABLE_WRITE=1, or tick Enable writes in the Claude Desktop extension settings |
| `write_failed` | A write reached Calibre and failed. | — |
| `write_unverified` | The connection dropped mid-write; the change may or may not have landed. | re-read the book with calibre_get_book before retrying |
| `calibre_unreachable` | The Content Server (or `calibredb`'s route to it) cannot be reached. | start it in Calibre (Connect/share → Start Content server) or set CALIBRE_MCP_SERVER_URL |
| `calibre_busy` | The library is busy with another operation. | retry in a few seconds — calibre_ping shows when the library is free |
| `calibre_too_old` | The call needs a newer Calibre (annotations and notes need 9.18+) than the one running. | update Calibre (https://calibre-ebook.com/download); other tools work on this version |
| `calibre_error` | Calibre or `calibredb` reported an error that fits no more specific code. | — |
| `timeout` | The operation exceeded its time limit. | retry, or narrow the request |
| `cancelled` | The client cancelled the call. | — |
| `fts_unavailable` | Calibre's full-text index is not enabled for the library. | enable full-text indexing in Calibre, or use calibre_search mode=meta |
| `index_missing` | No semantic index exists for the requested books. | run calibre_build_index first |
| `index_incompatible` | The semantic index was built by an incompatible version. | rebuild with calibre_build_index { force: true } |
| `index_build_failed` | Building the semantic index failed. | — |
| `library_id_collision` | Two library folders have ids that differ only in case. | rename the folder of the refused library the error names (its id differs only in case from the library indexed first) |
| `dependency_missing` | A required external tool or optional package is missing. | install the tool the error names, then retry |
| `extraction_failed` | A book's text or figures could not be extracted. | — |
| `internal` | An unexpected server error. | — |

## Supported versions

Security fixes go to the latest minor release line ([`SECURITY.md`](../SECURITY.md)).

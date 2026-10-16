# Security policy

## Supported versions

Only the latest minor release line receives security fixes (currently the newest `0.x`
release on [npm](https://www.npmjs.com/package/calibre-mcp)). Upgrade to the latest
release before reporting; older versions are not patched.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/caelum29/calibre-mcp/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**). Include:

- the calibre-mcp version and how it is installed (npx, Claude Desktop `.mcpb`, Claude Code plugin);
- which tool or code path is affected, and whether writes were enabled (`CALIBRE_MCP_ENABLE_WRITE`);
- steps to reproduce, and the impact you observed.

You should get an acknowledgement within a week. Once a fix is released, the advisory is
published with credit to the reporter unless you ask otherwise.

## Scope

In scope: anything that lets a tool call (including model-supplied arguments or untrusted
book content) escape the server's guarantees — the write gate (`CALIBRE_MCP_ENABLE_WRITE`)
and preview-first writes, the `calibre_add_book` path whitelist (`CALIBRE_MCP_ADD_ROOTS`),
command or argument injection into `calibredb` / `ebook-convert` / poppler, path traversal in
the extraction caches, or leaking local data the server is not meant to expose.

Out of scope: vulnerabilities in Calibre itself, its Content Server, or your MCP client —
please report those upstream.

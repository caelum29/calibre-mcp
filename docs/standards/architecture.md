# Standards: architecture and dependency direction

Applies to new files, new imports, `ToolDeps`, `server.ts` and `scripts/**`. The open refactor
issues (#217, #218, #219, #258–#261, #272) describe the target; new code moves toward it and adds
no new instance of the problems they fix.

Layer directions, the SDK seam, subprocess/HTTP/accent-folding homes are checked by
`test/architecture.test.ts` and oxlint. Its `LAYER_ALLOWLIST` is shrink-only: a diff that fixes an
edge removes it; a diff that adds an entry is a finding.

## Thin tools

- A tool file holds the MCP adapter: schema, arg resolution, one call into domain/app code,
  `renderResult`. New ranking, write policy, selection or indexing logic goes outside `tools/`
  (#259, #260).
- No tool logic in `server.ts` (#222).

## Narrow ports

- New `ToolDeps` fields are narrow, use-case-shaped interfaces, not concrete classes. A new
  `as unknown as ToolDeps` cast in tests signals the port is too wide (#258).
- New modules that only need result types do not import `ToolDeps` (#261).

## Typed, not stringly

- New error kinds are typed with a `code` union, not string prefixes matched by `startsWith` (#220).
- New code takes library identity from `resolveLibraryId`, never a raw-config fallback (#218).

## One home per mechanism

- Beyond the checked homes, binary lookup goes through one helper and `/ajax/book` through one
  content-server fetch (#219, #223). A new `findBin` or second fetch of the same endpoint is a twin.
- `store.ts`, widget `*-html.ts` and other files near the 500-line cap do not grow with new
  concerns; split instead of dodging `max-lines` (#271, #272).

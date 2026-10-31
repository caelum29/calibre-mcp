# Standards: results, errors and logs

Applies to any diff that builds a tool result, adds a `catch`, writes an error or remediation
message, or adds a log call.

## Both channels

Claude Desktop shows the model only the text; Claude Code shows only `structuredContent` when an
`outputSchema` exists. This was the single most repeated defect (#26, #104, #105, #199, #211,
#216, #227).

- Every new or changed result field the model can act on (ids, cursors, counts, diffs, per-id
  errors, formats, "what changed") appears in both, built through `renderResult`/`pageCursor`.
- A new tool gets a `channel-parity.test.ts` scenario; a new `ALLOWLIST` entry needs a stated
  reason in the diff.
- Text exists for the model, not the checker: lines added only to satisfy parity (#232's
  "Legend") are a finding.

## Discriminating catch

- A `catch` maps each cause it can see to its own steer: parse error, timeout, not found, refused,
  index missing. A broad `catch` that returns one specific diagnosis ("index not ready" for every
  `CalibreCliError`, #251) is a finding.
- Raw upstream text (HTTP bodies, Python tracebacks) never reaches the model unwrapped (#251).
- Errors return `isError` with an actionable next step; nothing throws out of a handler.

## Steers fit the deployment

- Remediation text lives in `remediation.ts` and is correct for every install path (.mcpb, npx,
  Claude Code plugin). `pnpm add …` shown to a .mcpb user is a finding (#41).
- A CLI usage in a steer is checked against the real `calibredb --help` (7bdf247).

## Logs

- Log meta carries ids, counts, durations and error codes — not raw queries, args or file paths
  (#252). User-input errors log at `warn`, not `error`.
- Tests never write into real config, index or log dirs (#252's `shutdown.test.ts`).

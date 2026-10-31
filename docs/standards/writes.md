# Standards: write paths

Applies to any diff touching a `write: true` tool, a `calibredb` mutation, `metadata-fields.ts`, `domain/book-fields.ts`,
or merge/remove/add flows. The governing invariant: **never report a committed write as failed**
(#33). Every rule below is a way that invariant broke after it was written down.

## Committed work survives every exit

In any loop that writes, walk each `return`, `throw`, `break` and `catch`: what happens to the
books already written?

- Require the result to list committed ids even when the loop stops early (refusal, 401/403,
  timeout). A bare refusal after book 1 committed is a finding (#213).
- Require a fake-deps test that fails call N and asserts calls 1..N-1 are reported as applied.

## Timeouts are unknown, not failed

- A timeout or dropped connection after `calibredb` was invoked goes through
  `verifyTimedOutWrite`: confirmed → success, unconfirmed → steer to `calibre_get_book`.
  Inline re-read logic is a twin (#221).
- Only idempotent `set_metadata` writes retry; a retry on `add`/`remove`/`add_format` is a finding.

## One equality

- Diffs, "did it land" checks and no-op detection all compare via `sameFieldValue`. A new
  `JSON.stringify(a) === JSON.stringify(b)` or field-specific comparison is a twin (#254, #202).
- Unchanged fields never appear in the diff or the summary.

## Library identity

- Every `calibredb` call passes the resolved libId (`resolveLibraryId`), never a display name or
  raw config value (D-008, #218).

## Previews

- Destructive and bulk tools are preview-first via in-band `preview`/`confirm`/`apply`.
  Single-book update and add write directly; that is intended, not a finding.
- A preview or dry-run is a success result, never `isError` — agents refuse to call tools whose
  dry-run errors (0c8a463).
- For merge, dedupe and remove previews, ask which fields could make "duplicate" or "safe" false
  (language, edition, format) and require each in the text (#51).

## Result shape after commit

- Output fields that can be `undefined` after a successful write (empty `before`, cleared field)
  must still satisfy `outputSchema` after `JSON.parse(JSON.stringify(result))`, or the SDK turns a
  committed write into a validation error (#157).
- A `catch` that rolls back must not mask the original error (#205's ROLLBACK-without-transaction).

## Error classification

- Refusal/transient classifiers (`isWriteRefused`, retry patterns) match **observed** calibredb
  stderr, quoted in a test fixture. A pattern guessed from the status code is a finding (#237: the
  real 401 text is "A username and password is required").

## Filesystem paths

- A tool that takes a path validates it through `src/tools/add-path.ts` (`CALIBRE_MCP_ADD_ROOTS`).

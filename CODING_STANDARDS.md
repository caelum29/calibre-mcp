# Coding standards (review)

Read during **review**, against a diff. Implementation agents follow `CLAUDE.md`; this file holds
the judgement calls no linter or test can make. Each rule names what to look for in the diff and
what to require. Cite the rule's heading in findings.

## How to use

1. Apply every rule in **Core** below to the whole diff.
2. For each path the diff touches, open the matching area file and apply all of its rules:

| Diff touches                                                                             | Open                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| a tool with `write: true`, `src/calibre/*write*`, `metadata-fields.ts`, merge/remove/add | [`docs/standards/writes.md`](docs/standards/writes.md)                       |
| any tool result, `catch` block, error message, log call, `remediation.ts`                | [`docs/standards/results-and-errors.md`](docs/standards/results-and-errors.md) |
| `src/domain/**`, `src/enrich/**`, extraction, captions, keys, normalizers, scores        | [`docs/standards/heuristics.md`](docs/standards/heuristics.md)               |
| `src/semantic/**`, caches, sqlite, subprocesses, timeouts, `Promise.race`                | [`docs/standards/state-and-concurrency.md`](docs/standards/state-and-concurrency.md) |
| new files, new imports, `ToolDeps`, `server.ts`, `scripts/**`                            | [`docs/standards/architecture.md`](docs/standards/architecture.md)           |
| `src/ui/**`, `_meta.ui`, widget-internal tools                                           | [`docs/standards/widgets.md`](docs/standards/widgets.md)                     |

## Already enforced — skip these

CI fails on them, so a finding here is noise:

- oxlint: `console.*` in `src/`, `new RegExp` in `src/tools/**` (→ `compileUserRegex`),
  `child_process` outside `calibre/spawn.ts`/`extract.ts`.
- `test/architecture.test.ts`: SDK imports outside `server.ts`/`run-stdio.ts`; layer directions
  (domain pure, config/ui/resources/scripts); `normalize("NFKD")` outside `normalize.ts`; raw
  `fetch(` outside the HTTP clients; JSDoc on exported functions and classes.
- `test/tools/registry.test.ts`: input booleans via `CoercedBool`; numbers/arrays/objects parse
  from their JSON string; write/localWrite classification.
- `test/tools/channel-parity.test.ts`: text↔structuredContent parity and `outputSchema` after a
  JSON round-trip, for every tool with a scenario.
- `catalog:check`, `versions:check`, `knip`, `tools/list` order, PR title format.
- Unit tests run with a temp `HOME` and index dir (`test/setup/isolate-home.ts`).

## Core

### Twin paths

The most frequent root cause in this repo: a rule lives in two places and the fix lands in one
(#221 three timeout-verify copies, #254 a second comparator, #211 five pagination blocks, #219
`findBin` ×4, #276 a third `stripAccents` next to `normalize.ts`).

- When the diff adds a helper, search for an existing one with the same job before accepting it.
  Shared homes: `verifyTimedOutWrite` (write-verify.ts), `sameFieldValue` (metadata-fields.ts),
  `pageCursor`/`renderResult` (tools/), `compileUserRegex`, `isWriteRefused` (write-refusal.ts),
  `isEmptyDate`, `looksLikeRawFilename`, `stripAccents`/`similarKey` (domain/curation/normalize.ts),
  `remediation.ts`, `calibre/spawn.ts`.
- When the diff fixes a rule, grep for its siblings and require the fix in every copy, or the
  copies collapsed into one first.

### Honest outcome

Results describe what happened, never what was requested or hoped for.

- Summaries derive from the effective change, not the input (#235, #202).
- A fallback, cap or skipped input is announced in the text lead line: keyword-only mode (#41),
  a truncated match list (#138), an invalid cursor (#26). Silent degradation is a finding.
- Mutually exclusive params (`ids`/`query`/`filter`) are rejected together, never one dropped (#214).

### Red first

- A bug-fix PR shows its test failing on the old code (red commit, or a quoted failing assertion
  in the body). Mentally revert the fix: if the test still passes, it is vacuous (#154).
- Fixtures come from verbatim real input (book text, calibredb stderr, host responses).

### Invariants in code, not comments

- A cross-module assumption ("valid because `BUILD_CONCURRENCY` is 1", "50 equals
  `PASSAGE_BATCH × 5`", #278) is asserted in code or a test, not stated in a comment.
- Thresholds and weights are named constants with a one-line basis (eval run, corpus sweep, or
  "guess, tune in #N").

### Scope matches the claim

- `Closes #N` only when the issue's stated symptom is gone; partial fixes say `Refs #N` and name
  what remains (#277).
- A deferred piece of a spec is recorded as deferred, not silently skipped (#225).
- When a tool's params or behaviour change, `docs/TOOLS.md` and the tool description change in the
  same PR (#226).

### Documentation

- Every new file has a 1–3 line header with its business context. Exported interfaces and types
  that other modules consume get JSDoc too (functions and classes are checked by CI, #224).
- Comments explain why a rule exists, not what the code does.

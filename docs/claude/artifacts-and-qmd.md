# Project artifacts & docs search

<!-- Imported by CLAUDE.md. Map of the docs corpus + the qmd search workflow over it. -->

## Project artifacts

`docs/` holds only the public user docs (`TOOLS.md`, `SEMANTIC-SEARCH.md`, `TROUBLESHOOTING.md`)
plus this `docs/claude/` set. Everything internal lives in **`docs/dev/`, which is gitignored** —
local-only, never in the public repo. The dev docs are the source of record for decisions; user docs
must not contradict them. Start with:

- `docs/dev/DECISIONS.md` — index of LOCKED decisions (`D-NNN`, one ADR each in `docs/dev/adr/`) + the
  consolidated Deferred/LATER registry. Domain vocabulary: `GLOSSARY.md` (root).
- `docs/dev/TOOLS-spec.md` — the tool build list of record.
- `docs/dev/JOURNAL.md` — chronological build history (append-only).
- `docs/dev/CAPABILITIES.md` — Content-Server API + write-path/auth resolution;
  `docs/dev/local-groundtruth.md` — firsthand probes of the dev machine's Calibre.

## Searching the docs corpus (qmd)

`docs/` is indexed under the **`calibre-docs`** qmd collection — prefer it over blind `grep` when
hunting a decision or rationale. Always scope with `-c calibre-docs` (the index is shared with
unrelated projects), e.g. `qmd query "why route writes through the Content Server" -c calibre-docs`.
After editing `docs/`, run `qmd update && qmd embed`.

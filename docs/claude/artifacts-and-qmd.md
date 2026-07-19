# Project artifacts & docs search

<!-- Imported by CLAUDE.md. Map of the docs corpus + the qmd search workflow over it. -->

## Project artifacts

**Layout (since 2026-07-19):** `docs/` holds only the public user docs — `docs/TOOLS.md`
(tool reference), `docs/SEMANTIC-SEARCH.md` (how semantic search works), and
`docs/TROUBLESHOOTING.md` (symptom-first fixes) — plus this
`docs/claude/` set. Everything internal (design, research, decisions, journal, probes)
lives in **`docs/dev/`, which is gitignored** — local-only, never in the public repo.
The dev docs are still the source of record for decisions; user docs must not contradict them.

- `docs/dev/JOURNAL.md` — chronological build history + status archive (the session archaeology; append-only).
- `docs/dev/DECISIONS.md` — registry of LOCKED decisions (`D-NNN`) + the consolidated Deferred/LATER registry.
- `docs/dev/RESEARCH.md` — the foundation report (6 sections: capability inventory, MCP best practices, server comparison, §5 tool catalog + §5.0 FaceDeer coverage, open questions). §5/§6 superseded downstream.
- `docs/dev/CAPABILITIES.md` — deep capability + Content-Server-API analysis; **resolves the write path/auth, PDF-extraction, and `/ajax` stability questions** and maps GPL plugins → port-the-algorithm differentiators.
- `docs/dev/local-groundtruth.md` — firsthand probes of this machine's Calibre (CLI subcommands, GUI lock, Content Server `/ajax/` shapes).
- `docs/dev/calibredb_help.txt` — full `calibredb` v9.10 CLI dump.
- Decision docs: `docs/dev/DESIGN.md`, `docs/dev/TOOLS-spec.md` (build list of record), `docs/dev/DISTRIBUTION.md`, `docs/dev/INTERACTIVITY.md`, `docs/dev/PRODUCT-DECISIONS.md`.

## Searching the docs corpus (qmd)

`docs/` is indexed for semantic + keyword search under the **`calibre-docs`** qmd
collection. Prefer it over blind `grep`/`Read` when hunting a decision, rationale,
or design detail across the corpus. The `qmd` skill (`.claude/skills/qmd/`) has the
full workflow; the short version:

```bash
qmd query "why route writes through the Content Server" -c calibre-docs   # hybrid + rerank
qmd search "libId resolve" -c calibre-docs                                # fast BM25
```

Always scope with `-c calibre-docs` — the qmd index is global and shared with
unrelated projects. After editing `docs/`, run `qmd update && qmd embed` to refresh.

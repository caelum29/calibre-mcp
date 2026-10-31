# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root — the ubiquitous language (tracked, public).
- **`docs/dev/adr/`** — one ADR per locked decision, `0NNN-slug.md` where `0NNN` = `D-NNN`. Read the ADRs
  that touch the area you're about to work in. `docs/dev/DECISIONS.md` is the index (plus the
  Deferred/LATER registry). `docs/dev/` is **gitignored** — local-only on Artem's machine.

If any of these don't exist (fresh clone, cloud session), **proceed silently**. Don't flag their absence;
don't suggest creating them upfront.

## Writing new entries

- New term → `GLOSSARY.md` (same `**Term**:` / definition / `_Avoid_:` shape).
- New decision → `docs/dev/adr/0NNN-slug.md` with the next free `D-NNN` number, plus a row in
  `docs/dev/DECISIONS.md`. **Not** a root `docs/adr/` — decisions are kept private for now (#338).

## File structure

Single-context:

```
/
├── GLOSSARY.md
├── docs/dev/                ← gitignored
│   ├── DECISIONS.md         ← index + Deferred/LATER registry
│   └── adr/
│       ├── 0001-embedding-model-locked-to-multilingual-e5-small.md
│       └── …
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

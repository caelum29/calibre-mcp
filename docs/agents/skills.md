# Engineering skills (Matt Pocock's set)

How the engineering skills (`grill-with-docs`, `tdd`, `code-review`, `implement`, …) bind to this repo.
The flow itself (which skill when, phase boundaries, context hygiene) is owned by `/ask-matt`: when
unsure which skill fits, tell Artem to run it instead of guessing. This file holds only what the
skills cannot learn from looking: where they write here, and which gates they must pass.

## Who can start what

Most flow skills are **user-invoked** (`disable-model-invocation: true`): the agent cannot call them,
so name the slash command and let Artem run it.

- **User-invoked:** `/ask-matt`, `/grill-with-docs`, `/grill-me`, `/wayfinder`, `/to-spec`, `/to-tickets`,
  `/implement`, `/implement-spec`, `/improve-codebase-architecture`, `/triage`, `/handoff`, `/retro`,
  `/setup-matt-pocock-skills`.
- **Model-invoked** (call with the Skill tool when the trigger fits): `tdd`, `diagnosing-bugs`,
  `codebase-design`, `domain-modeling`, `code-review`, `pr`, `prototype`, `grilling`.

## Pick the depth before planning

Match ceremony to the change (the alignment ladder):

1. **Tiny, obvious diff** (one file, no new term, no decision): implement directly, then the gate.
2. **Anything larger:** start with `/grill-with-docs`. A grill can graduate into `/wayfinder` if it
   turns out bigger than one session; never start at `/wayfinder` for a well-scoped feature.

## Where the skills write here

- **Glossary:** `GLOSSARY.md` at the root. The repo-local `.claude/skills/grill-with-docs` predates
  Pocock's v1.3 rename and still says `CONTEXT.md`; read every `CONTEXT.md` in a skill as `GLOSSARY.md`.
- **ADRs:** `docs/dev/adr/` with `D-NNN` numbers, gitignored and local-only. Layout and shape:
  [domain.md](domain.md).
- **Tickets and triage:** GitHub issues via `gh` ([issue-tracker.md](issue-tracker.md)), labels in
  [triage-labels.md](triage-labels.md). Tickets from `/to-tickets` are already agent-ready: skip `/triage`.

## Gates the skills must pass

- **`tdd` seams** are the ones `CLAUDE.md` already enforces: tool handlers and domain code stay SDK-free,
  and `src/app/` use-cases reach adapters only through ports (`test/architecture.test.ts`). Test through
  those seams, and use `codebase-design` vocabulary when choosing a new one.
- **"Full test suite" in `/implement` and `/implement-spec`** means the hand-back gate in
  [`AGENTS.md`](../../AGENTS.md), including `pnpm build && pnpm catalog:check` when a tool or its schema
  changed.
- **`code-review` Standards axis** reads [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md); the Spec axis
  reads the originating GitHub issue.
- **`/retro` findings** land as a deterministic check (oxlint rule, test, CI job) when the mistake is
  mechanical, and in `CODING_STANDARDS.md` only when it is a judgement call. Retro proposes; Artem applies.

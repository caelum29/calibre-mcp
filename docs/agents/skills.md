# Engineering skills (Matt Pocock's set)

How the engineering skills (`grill-with-docs`, `tdd`, `code-review`, `implement`, …) bind to this repo.
The flow itself (which skill when, phase boundaries, context hygiene) is owned by `/ask-matt`: when
unsure which skill fits, tell Artem to run it instead of guessing. This file holds only what the
skills cannot learn from looking: how to drive them, where they write here, and which gates they must pass.

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

## Driving a run

Practice, not skill rules. Taken from Pocock's own end-to-end run on a real feature
([video, 2026-11-18](https://www.youtube.com/watch?v=jVBlkOF8sHk)).

**Grill**

- Open with the problem and why it hurts, not a solution. Leave the design open when it is open.
- Artem sets the pace. At the crux he may say "one question at a time"; once it is settled, "widen out".
  Artem ends the grill. When his answers turn into plain agreement, the agent is aligned: name
  `/to-spec`.
- Propose a new `GLOSSARY.md` term or ADR and wait for a yes. Do not write either mid-grill unasked.
- To choose a name, scenario-test two or three candidates in a table against real sentences from this
  domain. Add one row: "is this how Artem says it?". Drop a candidate that already means something
  else in `GLOSSARY.md` or in a library this repo uses.
- Read the ADRs that touch the area before proposing to change a decision they record.
- Debt found while grilling becomes a GitHub issue, not scope for the current change.

**Prototype**

- For a question of feel (tool output shape, interaction, layout), use `prototype` in a background
  subagent with two or three variants while the grill continues. A rejected variant is signal too.
- A prototype is a reference for the spec, not code to merge. Implementers re-implement it under the
  gates; Pocock's retro caught prototype code copied straight into the PR.

**Implement**

- Spec and tickets should leave implementers no open decision. An open question goes back to Artem,
  not to the implementer.
- After `/to-tickets`, ask Artem to run `/compact` before `/implement-spec`. The conversation is now a
  document, so little is lost.
- Give a focused sub-problem a fresh subagent instead of reusing one deep in its context. Pocock puts
  the drop in quality at about 150k tokens.

**Review and merge**

- Split a large diff into stacked PRs: two-way doors first, the one-way door last (a release, a change
  to the write gate, anything that touches a real Calibre library). Ship behind a flag if the new path
  must land dark. The one-way door gets a mandatory human review; the rest is reviewed for taste.
- Treat each review comment as a hypothesis about the agent's environment. When the fix is mechanical,
  make it a rule (see `/retro` below) instead of fixing only this diff.
- A comment that explains a workaround is a smell. Fix the workaround, move the reason into an ADR, or
  name a test after it ([CODING_STANDARDS.md](../../CODING_STANDARDS.md): invariants in code, not
  comments).

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
  Feed it the run's session transcripts and the PR review comments (`gh`). A new check that existing
  code already breaks is ratcheted: baseline today's violations, block new ones, tighten over time.
  A finding about a skill itself goes to `mattpocock/skills` as an issue, and only on Artem's go-ahead,
  because that repo is public.

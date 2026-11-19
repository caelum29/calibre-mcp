# AGENTS.md

The agent instructions for this repository live in [`CLAUDE.md`](CLAUDE.md) — read it first.
It is the single source: invariants (SDK-free seam, return-not-throw `isError` results,
stdout is reserved for JSON-RPC, the two-key write gate), working rules, and the context
files it imports (`docs/claude/*.md`; a line starting with `@` there means "read this file").

Engineering skills (Matt Pocock's set: `grill-with-docs`, `tdd`, `code-review`, `implement`, …): read
[`docs/agents/skills.md`](docs/agents/skills.md) before running one. It covers who can start which
skill, how much planning a change needs, how to drive a grill, prototype, tickets, an unattended run,
review and retro, and where the skills write in this repo.

Before handing work back, run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
(plus `pnpm build && pnpm catalog:check` when tools or their schemas change).

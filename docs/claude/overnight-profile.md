# Overnight profile — calibre-mcp

Repo specifics for the `overnight-orchestrator` skill. The skill holds the process; this file holds what is true about this repo.

## Gate

- Install: `pnpm install --frozen-lockfile`
- Local gate (children, before push): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm knip && pnpm widgets:check && pnpm build && pnpm catalog:check && pnpm test`. The tests take ~5 s.
- If the tool surface or descriptions changed, run `pnpm catalog` first and commit the result. If widget sources under `src/ui/` changed, run `pnpm widgets` first and commit `src/ui/generated/`.
- Required checks (`protect-main` ruleset): `static`, `test (22)`, `test (22.16.0)`, `test (24)`, `conventional-title`. PR titles must be conventional commits.
- Merge style: merge commits (`gh pr merge --merge`).

## Merge blockers (park for Artem)

- Bumps `INDEX_VERSION` / `TEXT_CACHE_VERSION`, or changes the index schema (forces users to re-index).
- Adds, removes or renames a tool or tool param, or changes the tool count (CLAUDE.md budget ≤ ~20).
- Adds a runtime dependency or a new `CALIBRE_MCP_*` env var.
- Changes write-path semantics beyond the issue (write gate, preview-first, timeout verify in `src/app/write-policy.ts`).
- Touches ranking / chunking / fusion / rerank in `src/semantic/` without a green `pnpm eval --gate`. The gate builds a synthetic corpus, so EPUB/PDF structure changes still need Artem's eye.

## Prod and live operations (Artem's, never at night)

- `pnpm reindex` in any production mode, including `--flags-only --production` backfills.
- Write tools against the live library. Children use fakes, and `CALIBRE_MCP_ENABLE_WRITE` stays off.
- Installing a `.mcpb` in Claude Desktop, or any manual check in a real client (e.g. "does the model see server instructions").
- Running the SDK codemod (`npx @modelcontextprotocol/codemod`): the classifier blocks it at night, so Artem runs it while awake.

## Releases

Release-please opens the release PR as `github-actions[bot]`, so its checks wait for manual approval until #273 lands. The order is always:
1. approve its runs;
2. curate the CHANGELOG last;
3. merge.

Never part of the overnight wave.

## Model split (defaults)

- **Sonnet:** test-only issues, error/steer text, small handler fixes with existing tests.
- **Opus:** semantic index and search, dedupe keys, build_index timing and progress, anything stateful across processes (SQLite locks, caches).

## Report

Markdown copy at `docs/dev/overnight-<date>.md` (gitignored). Earlier runs: `docs/dev/overnight-2026-10-28.md`, `docs/dev/overnight-2026-10-30.md`.

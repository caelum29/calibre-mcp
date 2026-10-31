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

## Standing risk questions (add to the reviewer prompt when the diff matches)

- **Result shape** (`toolError`, `toolOk`, structuredContent, outputSchema): Claude Desktop shows the model only the text channel, and the Claude Code tab shows only structuredContent when it is present. Does each fact, steer and error message reach the model in both? Run one error and one success through the handler and read both channels.
- **Tool schema or description**: was `pnpm catalog` rerun and committed? An outputSchema field alone breaks `catalog:check`.
- **Shared types or module paths moved** (`ToolDeps`, `src/app/`, `semantic/store/`): which open PRs import them? Tell those chains to sync.
- **Display logic over book text** (snippets, highlights): natural-language queries (stopwords), Cyrillic, short chunks, text at the chunk edge, code containing `>>`/`<<`.
- **`src/semantic/`**: is the `pnpm eval --gate` output in the body from the current head (`git log -1` sha named), not an earlier commit? A full eval run takes ~7–8 min.

## Report

Markdown copy at `docs/dev/overnight-<date>.md` (gitignored). Earlier runs: `docs/dev/overnight-2026-10-28.md`, `docs/dev/overnight-2026-10-30.md`, `docs/dev/overnight-2026-10-31.md`, `docs/dev/overnight-2026-11-01.md`.

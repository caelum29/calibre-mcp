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

## Churn guard (before filing follow-up boxes)

Review findings on a fix become boxes in the next umbrella issue, and the next wave's fix gets its own findings. That spiral ran #308 → #325 → #340 → #370 → #389 on `fts-highlight.ts` (6 PRs in 3 weeks) and #285 → #344 → #370 → #389 on `build-progress.ts`. Before a review finding goes into an umbrella issue:

1. **Count the file's recent fixes.** Run `git log --first-parent --since=21.days --oneline main -- <file>` and skip pure refactor/docs merges. At **3 or more** fix/test PRs, the finding is **not** filed as a box. Put it in the morning report under "Churn: Artem decides", with three options: `fix` / `wontfix` (note in a code comment) / `rewrite` (one issue that replaces the patch series).
2. **Ask for a realistic input.** A finding must name an input a real library or client produces: a real library id, a query a model would send, real calibredb output. If it can't (ids with `~`, ids over 255 bytes, `NOT title:NEAR(…)`), log it as a known limit in a code comment. It is not a box.
3. **Frozen areas.** Don't file new edge-case boxes against these until Artem lifts the freeze. Real-user bugs still go in. Frozen: `src/calibre/fts-highlight.ts` (display only, ranking unaffected) and `src/semantic/build-progress.ts` names (each format change restarts a reindex log).

## Eval runs

- `pnpm eval --gate` takes ~8 min alone; with model evals running in parallel in several chains it took 13–40 min each (2026-11-04). Expect that, or stagger the eval-heavy items across chains.
- Since #387 the gate compares every top-10 list exactly on all three tiers (ON, fusion-only, and the hash tier inside `pnpm test`). Any change that moves a ranking, even an improvement, fails until the PR either re-freezes the baseline (rule commit first, D-012) or adds a `test/eval/retrieval/list-diff-allow.json` entry with a reason. The PR body names which one. Policy is under review in #392.

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
- **New structuredContent / outputSchema field or changed tool behaviour**: are `docs/TOOLS.md` and the `skills/` manuals updated to match? `catalog:check` doesn't catch prose (#391).
- **Write path** (`src/tools/calibre_*update*`, `calibre_merge_books`, `src/app/write-policy.ts`): does new outcome logic sit in `src/app/`, not in the tool file? Does it reuse the existing re-read → outcome mapping, or add another copy of it (#390)?
- **Shared types or module paths moved** (`ToolDeps`, `src/app/`, `semantic/store/`): which open PRs import them? Tell those chains to sync.
- **Display logic over book text** (snippets, highlights): natural-language queries (stopwords), Cyrillic, short chunks, text at the chunk edge, code containing `>>`/`<<`.
- **Decision reversal**: does the diff undo behaviour an earlier PR body or ADR called deliberate? Two examples. #236 chose "dropped write → steer only, no re-read", and #350/#372 then added the re-read. #254 kept "re-read moved away from before counts as landed", and #380 dropped it. If yes, park it for Artem (see `CODING_STANDARDS.md` § Decision reversals).
- **`src/semantic/`**: is the `pnpm eval --gate` output in the body from the current head (`git log -1` sha named), not an earlier commit? A full eval run takes ~7–8 min.

## Report

Markdown copy at `docs/dev/overnight-<date>.md` (gitignored). Earlier runs: `docs/dev/overnight-2026-10-28.md`, `docs/dev/overnight-2026-10-30.md`, `docs/dev/overnight-2026-10-31.md`, `docs/dev/overnight-2026-11-01.md`, `docs/dev/overnight-2026-11-01-b.md`, `docs/dev/overnight-2026-11-01-c.md`, `docs/dev/overnight-2026-11-04.md`.

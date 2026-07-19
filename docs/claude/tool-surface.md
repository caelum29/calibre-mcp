# Tool surface & count policy

<!-- Imported by CLAUDE.md. The tool surface target, the two-surfaces framing, and the
     ≤20 tool-count policy with its evidence base. -->

**Two surfaces (Artem's framing).** The server works at two scopes: the **catalog/library**
(update the library, book metadata, tags, bulk ops, dedupe, enrich) and a **single book** (extract
content — whole book or a chunk — and keyword/semantic search *within* one book). Semantic search
spans both: **across the whole library OR one book separately** — a `scope: library|book` param, not
extra tools (see `docs/TOOLS.md`).

Baseline = the **capability surface** of FaceDeer (full read/write/convert/import/export +
per-library permission model) — **18 = a capability target, not a tool-count target**. See
`docs/RESEARCH.md` §5.0 for the verified inventory and the coverage table.

**Tool-count target: keep the model-facing surface ≤ ~20 task/intent tools.** Field + research
evidence (`docs/DESIGN.md` §9.1): selection accuracy degrades as the number of *confusable* tools per
query grows (OpenAI's "<20" is a soft heuristic; the measured degradation zone is ~30–50 similar
tools — we must stay under it). So **don't 1:1-mirror calibredb subcommands as tools**; fold related
operations into fewer **task/intent** tools (e.g. one `calibre_recover_metadata` doing
ISBN→OpenLibrary→GoogleBooks internally, not three chainable tools). Cheap evidence-backed wins:
**namespacing**, **tool consolidation**, lean tool-def token budgets, sharp **descriptions** (the
10x selection lever). At ≤20 we do **not** need RAG-over-tools / MCP-Zero machinery internally.

> The differentiator list, the consolidated **14→15 LOCKED tool list**, and its name-mapping live in
> `docs/DECISIONS.md` D-005 (rationale) and `docs/TOOLS.md` (build list of record).

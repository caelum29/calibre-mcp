# Tech stack & licensing rules

<!-- Imported by CLAUDE.md. The locked tech stack and the GPL clean-room operating rules. -->

## Tech stack (decided in research, confirm in design)

- **`@modelcontextprotocol/sdk` 1.29.0** (protocol `2025-11-25`), `registerTool` + `outputSchema`/`structuredContent`.
  Do **not** wait for SDK v2 (alpha); isolate the SDK behind a thin layer to de-risk migration.
- **Zod** for input schemas (with the coercion layer in CLAUDE.md's gotchas).
- **Semantic search:** `multilingual-e5-small` (LOCKED — `docs/DECISIONS.md` D-001/D-010), in-memory
  brute-force cosine on `node:sqlite` BLOBs + hybrid FTS5/RRF; full pipeline in `docs/SEMANTIC-SEARCH.md`.
- **Clean Architecture:** keep tool logic (schemas, handlers, embedding/DB code) free of SDK types.
- Package via **npx** + **MCPB** bundle for Claude Desktop (release recipe → `docs/DECISIONS.md` D-006).

## Reusable code (licensing)

**Decision (2026-06-27): our server is MIT/Apache (permissive), clean-room** (`docs/DECISIONS.md` D-004).
Operating rules:
- ✅ Call Calibre as a *program* (shell `calibredb`, Content Server HTTP, `ebook-convert`,
  `fetch-ebook-metadata`) — mere use, GPL does not propagate. This is our primary interface.
- ✅ Read Calibre/plugin GPL source to *understand the contract* (`/cdb/cmd` arg shapes in
  `src/calibre/db/cli/cmd_*.py`, encoding in `utils/serialize.py`, query grammar in `db/search.py`,
  `check_isbn`/`author_to_author_sort` in `ebooks/metadata/`).
- ✅ Reimplement algorithms *independently* from the manual / observed behavior / well-known formulas
  (ISBN checksum, Flesch/Fog, SHA dedupe). **Do NOT line-by-line translate GPL code** (Calibre or
  kiwidude/JimmXinu plugins — all GPL-3.0) into TS; that would force our server to be GPL.
- ✅ Copy freely from permissive sources only (the attribution list is in `docs/DECISIONS.md`).

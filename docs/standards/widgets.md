# Standards: MCP Apps widgets

Applies to `src/ui/**`, `_meta.ui`, and the widget-internal tools (`calibre_board_data`,
`calibre_open_book`). Host behaviour differs from the spec and between Desktop and Claude Code;
every widget bug in this repo came from an unprobed assumption (#69, #70, #72, #130, #246).

## Probe-backed host behaviour

- Any reliance on how the host answers (`ui/message`, `ui/open-link`, widget `tools/call`) cites a
  live probe or a recorded response. Desktop resolves `ui/open-link` with `isError: true` on
  success, so `isError → degrade` is a finding; degrade only on `-32601` (#72).
- The PR states which build was tested (release `.mcpb`, dev bundle, `dist/`); a stale bundle
  explained several false bug reports.

## Data via the widget's own call

- `structuredContent` is stripped from the tool-result notification; the widget fetches its data
  through `calibre_board_data`, keyed by library and filter (D-017, #215).

## Entity UI only for entities

- Zero results or an aggregate (count, category list) attach no board; a single hit gets the book
  card, not a one-book board (#67, #68, #71).

## Layout states

- Collapse sets an explicit height of 0; pending states avoid flashing the control they replace
  (#70, cd3c9de).

## Widget sources

- Widget CSS/JS/HTML live as real files in `src/ui/{board,card,figures}/` and `src/ui/debug.js`;
  `src/ui/generated/widgets.ts` is their build output (`pnpm widgets`, drift-checked in CI). A diff
  that edits the generated file by hand, or a source file without regenerating, is a finding (#271).

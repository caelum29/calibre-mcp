// `pnpm eval` entry: the only place that calls main(). run.ts stays import-only (tests import its
// helpers), so there is no entry detection that could fail open and make `--gate` exit 0 silently (#416).

import { main } from "./run.js";

main().catch((err: unknown) => {
  process.stderr.write(`[eval] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

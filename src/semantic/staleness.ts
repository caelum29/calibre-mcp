// Is an index compatible with this server's pipeline? Pure comparison of an index's meta against the
// locked model/dim/generation constants — no I/O, so use-cases (src/app) may import it (#354).

import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "./model.js";
import type { IndexMeta } from "./store/index.js";

/** What differs between an index's meta and this server's pipeline, or undefined if it matches. */
export function staleness(m: IndexMeta): string | undefined {
  const diffs: string[] = [];
  if (m.modelId !== MODEL_ID) diffs.push(`model ${m.modelId} (server: ${MODEL_ID})`);
  if (m.dim !== EMBED_DIM) diffs.push(`dim ${m.dim} (server: ${EMBED_DIM})`);
  if (m.indexVersion !== INDEX_VERSION) diffs.push(`indexVersion ${m.indexVersion} (server: ${INDEX_VERSION})`);
  return diffs.length ? diffs.join(", ") : undefined;
}

// RED stub (#655): replaced by the real stage in the GREEN commit.
import type { OffsetMap } from "./offset-map.js";
export interface RuleSet {
  readonly name: string;
}
export const CHARACTER_RULES: RuleSet = { name: "character" };
export function normaliseText(raw: string, _sets: readonly RuleSet[]): { text: string; map: OffsetMap } {
  return { text: raw, map: { edits: [] } };
}

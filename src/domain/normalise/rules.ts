// Rule plumbing of the normalisation stage (#655): the rule and rule-set shapes and the regex
// helpers rule sets build on. Pure, SDK-free, no npm imports.

import { mergeTouching, type TextEdit } from "./offset-map.js";

/** One pass of a rule set: input text → output text plus its edits (input → output). */
export interface TextRule {
  readonly name: string;
  apply(text: string): RuleResult;
}

export interface RuleResult {
  text: string;
  edits: TextEdit[];
}

/** A named, ordered list of rules (one rule set = one ADR-0033 item). */
export interface RuleSet {
  readonly name: string;
  readonly rules: readonly TextRule[];
}

/**
 * Replace every match of `re` (global) by `replace(match)`; `undefined` or the match itself keeps
 * it. Returns the new text and the edits, for rules that are one regex.
 */
export function replaceMatches(
  text: string,
  re: RegExp,
  replace: (m: RegExpExecArray) => string | undefined,
): RuleResult {
  const edits: TextEdit[] = [];
  const out: string[] = [];
  let last = 0;
  let shift = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex += 1; // never loop on an empty match
      continue;
    }
    const by = replace(m);
    if (by === undefined || by === m[0]) continue;
    out.push(text.slice(last, m.index), by);
    edits.push({
      inStart: m.index,
      inEnd: m.index + m[0].length,
      outStart: m.index + shift,
      outEnd: m.index + shift + by.length,
    });
    shift += by.length - m[0].length;
    last = m.index + m[0].length;
  }
  if (edits.length === 0) return { text, edits };
  out.push(text.slice(last));
  return { text: out.join(""), edits: mergeTouching(edits) };
}

/**
 * Delete the given `[start, end)` spans of `text` (sorted, non-overlapping). Each deletion is its
 * own edit, so positions between two deleted markers map back exactly.
 */
export function deleteSpans(text: string, spans: readonly (readonly [number, number])[]): RuleResult {
  const edits: TextEdit[] = [];
  const parts: string[] = [];
  let last = 0;
  let removed = 0;
  for (const [start, end] of spans) {
    if (end <= start) continue;
    parts.push(text.slice(last, start));
    edits.push({ inStart: start, inEnd: end, outStart: start - removed, outEnd: start - removed });
    removed += end - start;
    last = end;
  }
  if (edits.length === 0) return { text, edits };
  parts.push(text.slice(last));
  return { text: parts.join(""), edits: mergeTouching(edits) };
}

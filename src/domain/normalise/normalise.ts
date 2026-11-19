// The text-normalisation stage (#655, ADR-0033): runs once on the converter's raw output, before
// figure markers, EPUB spine anchoring and everything else, so the cache, chunks, vectors, stems,
// snippets, section spans and calibre_get_content all read one cleaned text. Rule sets plug in;
// index version 5 has the character set (here) and the EPUB artefact set (#560). Invariants every
// rule keeps: `\f` is never deleted (page labels, scanPageStarts) and heading markers survive.
// Pure, SDK-free, no npm imports.

import { composeEdits, IDENTITY_MAP, mergeTouching, type OffsetMap, type TextEdit } from "./offset-map.js";

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

/** Cleaned text plus the map from its positions back to the raw text. */
export interface NormalisedText {
  text: string;
  map: OffsetMap;
}

/** Run the rule sets in order; the composed map leads from the final text back to `raw`. */
export function normaliseText(raw: string, sets: readonly RuleSet[]): NormalisedText {
  let text = raw;
  let edits: TextEdit[] = [];
  for (const set of sets) {
    for (const rule of set.rules) {
      const r = rule.apply(text);
      if (r.edits.length === 0) continue;
      text = r.text;
      edits = edits.length === 0 ? r.edits : composeEdits(edits, r.edits);
    }
  }
  return { text, map: edits.length === 0 ? IDENTITY_MAP : { edits } };
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

// --- character rule set (ADR-0033 item 6) ---

// C0/C1 controls except \t (09), \n (0A), \f (0C); \r goes too, so CRLF becomes LF. Zero-width
// space, word joiner and BOM are invisible format characters: dropped, not spaced, so a URL or
// identifier with a ZWSP wrap point stays one token. ZWJ/ZWNJ (200C/200D) carry meaning, kept.
const DROP = "\\u0000-\\u0008\\u000B\\u000D-\\u001F\\u007F-\\u009F\\u200B\\u2060\\uFEFF";
// Unicode spaces (Zs other than U+0020): no-break, ogham, en…hair, narrow no-break, math, ideographic
const SPACES = "\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000";
// line / paragraph separators become plain line breaks (chunker and headings key on \n)
const LINE_SEPS = "\\u2028\\u2029";
const CONTROL_RE = new RegExp(`(?<drop>[${DROP}]+)|(?<space>[${SPACES}])|[${LINE_SEPS}]`, "gu");

const controlsAndSpaces: TextRule = {
  name: "controls-and-spaces",
  apply: (text) => replaceMatches(text, CONTROL_RE, (m) => (m.groups?.drop ? "" : m.groups?.space ? " " : "\n")),
};

// A line-end hyphen (- ‐ ‑ or the soft hyphen) after a letter, joined only when the next line
// (optionally after one blank line) starts lowercase: marker's rule, with \p{Ll} so Cyrillic joins
// too. Never crosses \f (a page break between the halves keeps both). Any other soft hyphen goes.
const HYPHEN_RE = /(?<=\p{L})[-\u2010\u2011\u00AD][ \t]*\n(?:[ \t]*\n)?[ \t]*(?=\p{Ll})|\u00AD/gu;

const hyphenJoin: TextRule = {
  name: "hyphen-join",
  apply: (text) => replaceMatches(text, HYPHEN_RE, () => ""),
};

/**
 * Superscript and subscript code points NFKC must not fold (`x²` is not `x2`, `H₂O` is not
 * `H2O`): ª ² ³ ¹ º; modifier letters ʰ–ʸ and ˠ–ˤ; the phonetic superscripts/subscripts
 * U+1D2C–U+1D6A, U+1D78, U+1D9B–U+1DBF; the Superscripts and Subscripts block U+2070–U+209F;
 * ⱼ ⱽ; Cyrillic ꚜ ꚝ; ꝰ ꟸ ꟹ; ꭜ–ꭟ ꭩ; Latin Extended-F U+10780–U+107BA; Cyrillic Extended-D
 * U+1E030–U+1E06D. Also the numero sign № (U+2116): NFKC makes it "No", an English stop word in
 * Russian/Ukrainian text, where readers type № in queries (Artem confirmed, 2026-11-19).
 */
export const KEPT_SCRIPTS =
  /[\u00AA\u00B2\u00B3\u00B9\u00BA\u02B0-\u02B8\u02E0-\u02E4\u1D2C-\u1D6A\u1D78\u1D9B-\u1DBF\u2070-\u209F\u2116\u2C7C\u2C7D\uA69C\uA69D\uA770\uA7F8\uA7F9\uAB5C-\uAB5F\uAB69\u{10780}-\u{107BA}\u{1E030}-\u{1E06D}]/u;

// The unit NFKC is applied to: a non-ASCII starter with its combining marks, an ASCII base with
// the marks that compose with it, or stray marks. Per unit, so each edit (and the offset map)
// stays as narrow as one character. Known limit: a fold that spans units (conjoining Hangul jamo,
// a half-width katakana voicing mark) is not composed.
// oxlint-disable-next-line no-control-regex -- the ASCII range (U+0000–U+007F), not a control match
const UNIT = /[\u0000-\u007F]\p{M}+|[^\u0000-\u007F]\p{M}*/gu;

const nfkc: TextRule = {
  name: "nfkc",
  apply: (text) => {
    if (text.normalize("NFKC") === text) return { text, edits: [] }; // the common case: nothing to do
    return replaceMatches(text, UNIT, (m) => (KEPT_SCRIPTS.test(m[0]) ? undefined : m[0].normalize("NFKC")));
  },
};

/** ADR-0033 item 6: controls and Unicode spaces, hyphen joins and the soft hyphen, then NFKC. */
export const CHARACTER_RULES: RuleSet = {
  name: "character",
  rules: [controlsAndSpaces, hyphenJoin, nfkc],
};

/**
 * The rule sets for one extraction backend. Every text gets the character set; the EPUB artefact
 * set (#560) joins it for `ebook-convert` output only.
 */
export function ruleSetsFor(_backend: string): readonly RuleSet[] {
  return [CHARACTER_RULES];
}

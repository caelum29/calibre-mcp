// EPUB artefact rule set of the normalisation stage (#560, ADR-0033 item 5): Calibre's Markdown
// writer (ebook-convert --txt-output-formatting=markdown) leaves punctuation escapes, emphasis
// markers, inline-code backticks, blank-line runs, trailing spaces and token-spaced code in the
// text. Nothing inside a fenced code block changes, and heading markers stay (the chunker and the
// chapter detectors read them). Pure, SDK-free, no npm imports.

import type { TextEdit } from "./offset-map.js";
import { deleteSpans, replaceMatches, type RuleResult, type RuleSet, type TextRule } from "./rules.js";

/** `[start, end)` ranges of fenced code blocks (``` or ~~~ fences, fence lines included). */
function fencedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const fence = /^[ \t]*(```|~~~)[^\n]*$/gm;
  let open: number | undefined;
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    if (open === undefined) open = m.index;
    else {
      ranges.push([open, m.index + m[0].length]);
      open = undefined;
    }
  }
  if (open !== undefined) ranges.push([open, text.length]); // an unclosed fence runs to the end
  return ranges;
}

/** `[start, end)` ranges of single-backtick inline code spans on one line. */
function codeSpanRanges(text: string): [number, number][] {
  return [...text.matchAll(/`[^`\n]+`/g)].map((m) => [m.index, m.index + m[0].length]);
}

const inside = (ranges: readonly [number, number][], at: number, end: number) =>
  ranges.some(([s, e]) => at < e && end > s);

/** A regex rule that leaves every match touching a protected range unchanged. */
function protectedRule(
  name: string,
  re: RegExp,
  replace: (m: RegExpExecArray) => string | undefined,
  protect: (text: string) => [number, number][],
): TextRule {
  return {
    name,
    apply: (text: string): RuleResult => {
      const ranges = protect(text);
      return replaceMatches(text, re, (m) => (inside(ranges, m.index, m.index + m[0].length) ? undefined : replace(m)));
    },
  };
}

const fences = (text: string) => fencedRanges(text);
const fencesAndCode = (text: string) => [...fencedRanges(text), ...codeSpanRanges(text)];

/**
 * A rule that deletes markers around a kept body: each match of `re` (group 1 = the body) loses
 * its first `open` and last `close` chars. Matches touching a protected range, or that `keep` names, stay.
 */
function markerRule(
  name: string,
  re: RegExp,
  marks: { open: number; close: number; keep?: (m: RegExpExecArray) => boolean },
  protect: (text: string) => [number, number][],
): TextRule {
  return {
    name,
    apply: (text: string): RuleResult => {
      const ranges = protect(text);
      const spans: [number, number][] = [];
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const end = m.index + m[0].length;
        if (inside(ranges, m.index, end) || marks.keep?.(m)) continue;
        spans.push([m.index, m.index + marks.open]);
        if (marks.close > 0) spans.push([end - marks.close, end]);
      }
      return deleteSpans(text, spans);
    },
  };
}

// 1. A backslash before ASCII punctuation is a CommonMark escape: delete the backslash. Literal in
// fenced and inline code; an escaped backslash stays one backslash. `\#` opening a line stays
// escaped, so it never becomes an ATX heading for the chunker or the chapter detectors.
const unescape = markerRule(
  "markdown-unescape",
  /(?<!\\)\\[!-/:-@[-`{-~]/g,
  {
    open: 1,
    close: 0,
    keep: (m) => m[0] === "\\#" && /(^|\n)[ \t]*$/.test(m.input.slice(Math.max(0, m.index - 64), m.index)),
  },
  fencesAndCode,
);

// 2. Paired emphasis (`**x**`, `*x*`) with CommonMark flanking: the opener is followed and the
// closer preceded by a non-space, and neither touches a letter or digit outside the pair, so
// `a*b`, `2 * 3` and `a*b*c` stay. Underscore emphasis is left alone (identifiers like __init__).
const strong = markerRule(
  "markdown-strong",
  /(?<![\p{L}\p{N}*\\])\*\*(?=[^\s*])[^\n]*?[^\s*\\]\*\*(?![\p{L}\p{N}*])/gu,
  { open: 2, close: 2 },
  fencesAndCode,
);
const em = markerRule(
  "markdown-em",
  /(?<![\p{L}\p{N}*\\])\*(?=[^\s*])[^\n*]*?[^\s*\\]\*(?![\p{L}\p{N}*])/gu,
  { open: 1, close: 1 },
  fencesAndCode,
);

// 2b. Inline-code backticks at word boundaries: the code stays, the backticks go.
const backticks = markerRule(
  "markdown-code-span",
  /(?<![`\p{L}\p{N}])`[^`\n]+`(?![`\p{L}\p{N}])/gu,
  { open: 1, close: 1 },
  fences,
);

// 3. Token-spaced code (book 715: `np    .    array    (    x`). A line qualifies when, after
// its indentation, at least three runs of 3+ spaces separate its tokens and at least one token is
// bare punctuation; a space-aligned table has no bare punctuation token, so it stays. Each run
// becomes one space, and none next to `.`, `(` or `[`.
const SPACED_LINE = /^([ \t]*)(\S[^\n]*)$/gm;
const BARE_PUNCT = /(?:^| {3,})[.,()[\]{}=:;]+(?= {3,}|$)/;

/** True for a token-spaced code line (indentation already cut off). */
function isTokenSpaced(body: string): boolean {
  return (body.match(/\S {3,}(?=\S)/g) ?? []).length >= 3 && BARE_PUNCT.test(body);
}

const squeeze: TextRule = {
  name: "token-spaced-code",
  apply: (text) => {
    const ranges = fences(text);
    const edits: TextEdit[] = [];
    const parts: string[] = [];
    let last = 0;
    let shift = 0;
    for (const m of text.matchAll(SPACED_LINE)) {
      const start = m.index + m[1]!.length;
      if (inside(ranges, m.index, m.index + m[0].length)) continue;
      const body = m[2]!;
      if (!isTokenSpaced(body)) continue;
      // per-run edits keep the offset map as fine as the change
      for (const run of body.matchAll(/ {3,}/g)) {
        const before = body[run.index - 1] ?? "";
        const after = body[run.index + run[0].length] ?? "";
        if (after === "") continue; // trailing spaces are rule 4's
        const by = ".([".includes(before) || ".([".includes(after) ? "" : " ";
        const at = start + run.index;
        parts.push(text.slice(last, at), by);
        edits.push({ inStart: at, inEnd: at + run[0].length, outStart: at + shift, outEnd: at + shift + by.length });
        shift += by.length - run[0].length;
        last = at + run[0].length;
      }
    }
    if (edits.length === 0) return { text, edits };
    parts.push(text.slice(last));
    return { text: parts.join(""), edits };
  },
};

// 4. Trailing spaces and tabs on a line (Markdown hard breaks).
const trailing = protectedRule("trailing-spaces", /[ \t]+(?=\n|$)/g, () => "", fences);

// 5. Three or more line breaks (blank-line runs) become one blank line; `\n\n` stays (the chunker
// prefers it). Runs only over plain `\n`, so a `\f` page break is never merged away.
const blankRuns = protectedRule("blank-runs", /\n{3,}/g, () => "\n\n", fences);

/** ADR-0033 item 5 (#560): ebook-convert Markdown artefacts, after the character rules. */
export const EPUB_ARTEFACT_RULES: RuleSet = {
  name: "epub-artefacts",
  rules: [unescape, strong, em, backticks, squeeze, trailing, blankRuns],
};

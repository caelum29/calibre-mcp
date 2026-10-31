// Snippet window (#243): show the part of a chunk that matched the query, not its head. Pure
// string logic, display only — ranking never reads it. Terms are matched on stems (the keyword
// half's transform, so Cyrillic inflections match) and weighted by rarity within the chunk, so a
// rare query term outweighs a generic one that is everywhere.

import { stemmedTokens } from "./stem.js";

/** Length of a result snippet (chars) — the store's head snippet and this window share it. */
export const SNIPPET_CHARS = 320;

// Query stems shorter than this are skipped (в, и, of: noise even off the stopword list).
const MIN_TERM_CHARS = 3;
// How far back from a term to look for the start of its sentence.
const MAX_SENTENCE_LEAD = 160;
// Near the chunk end a window may start late (at its sentence) only while it keeps this share
// of the width; below that it shifts back to `end - width` so the snippet isn't a sliver.
const MIN_TAIL_SHARE = 2 / 3;
const SENTENCE_END = /[.!?…]\s+|\n/g;
// A hit may open a window only if its term weighs at least this share of the rarest term's.
const ANCHOR_WEIGHT_SHARE = 0.5;

// Function words that carry no topic: a natural-language query is mostly these, and without
// the list "how does the raft consensus work" would pick the head (how/does/the/work) over Raft.
// Matched on the lowercased raw token (ё→е), before stemming.
const STOPWORDS = new Set(
  (
    "a an the and or but nor not no so if then than as at by for from in into of off on onto out " +
    "over to up with about after before under between through during without within is am are was " +
    "were be been being do does did doing done have has had having can could will would shall should " +
    "may might must how what when where which who whom whose why this that these those there here it " +
    "its they them their we our you your he she his her i me my all any some each every both few more " +
    "most other such only own same too very just also use used using via vs " +
    "и в во на с со к ко у о об от до по за из изо для без над под при про через между а но или либо " +
    "да нет не ни же ли бы то это этот эта эти тот та те так как что чтобы кто где когда зачем почему " +
    "какой какая какие чем там тут здесь уже еще ещё был была были было быть есть будет он она оно они " +
    "мы вы ты я его ее её их им ему ей нас вас все всё весь вся всех свой своя свои также тоже очень " +
    "можно нужно надо"
  )
    .split(" ")
    .map((w) => w.replace(/ё/g, "е")),
);

/** Where a snippet of `body` starts (chunk-relative) and its text, "…"-prefixed when cut. */
export interface SnippetWindow {
  start: number;
  text: string;
}

/**
 * Pick the `width`-char window of a chunk whose distinct query terms weigh most (each term
 * counts 1 / its occurrences in the chunk; ties → earliest), opened at the sentence of an
 * informative hit (a term near the rarest one's weight). Falls back to the chunk head when no term occurs (a semantic-only hit) or the
 * chunk fits in one snippet.
 */
export function snippetWindow(body: string, query: string, width: number = SNIPPET_CHARS): SnippetWindow {
  const head = { start: 0, text: wholeSlice(body, 0, width) };
  if (body.length <= width) return head;
  const terms = queryTerms(query);
  if (terms.size === 0) return head;
  const hits = [...stemmedTokens(body)].filter((t) => terms.has(t.stem));
  if (hits.length === 0) return head;

  const occurrences = new Map<string, number>();
  for (const h of hits) occurrences.set(h.stem, (occurrences.get(h.stem) ?? 0) + 1);

  const weight = (stem: string) => 1 / occurrences.get(stem)!;
  // Windows open only at informative hits: a generic term everywhere in the chunk must not pick
  // where the snippet starts, even when its window also reaches the rare terms at its tail.
  const maxWeight = Math.max(...hits.map((h) => weight(h.stem)));
  const anchors = hits.filter((h) => weight(h.stem) >= maxWeight * ANCHOR_WEIGHT_SHARE);

  let best = { start: 0, score: 0 };
  for (const anchor of anchors) {
    const start = placeWindow(body, anchor.index, width);
    const inside = new Set(
      hits.filter((h) => h.index >= start && h.index + h.length <= start + width).map((h) => h.stem),
    );
    let score = 0;
    for (const stem of inside) score += weight(stem);
    if (score > best.score) best = { start, score };
  }
  const start = pairStart(body, best.start);
  const text = wholeSlice(body, start, start + width);
  return { start, text: start > 0 ? `…${text}` : text };
}

// A UTF-16 cut between the two halves of an astral char (emoji, 𝔸) leaves a lone surrogate:
// ill-formed text that some clients reject or render as "�". Cuts move to the pair boundary.
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** `at`, moved forward past a low surrogate whose high half sits before it. */
function pairStart(body: string, at: number): number {
  return at > 0 && isLow(body.charCodeAt(at)) && isHigh(body.charCodeAt(at - 1)) ? at + 1 : at;
}

/** body.slice(start, end), ending one unit early rather than on the high half of a pair. */
function wholeSlice(body: string, start: number, end: number): string {
  const cut = end < body.length && isHigh(body.charCodeAt(end - 1)) && isLow(body.charCodeAt(end)) ? end - 1 : end;
  return body.slice(start, cut);
}

/** Distinct stems of the query's topic words: stopwords and very short stems dropped. */
function queryTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const t of stemmedTokens(query)) {
    const raw = query
      .slice(t.index, t.index + t.length)
      .toLowerCase()
      .replace(/ё/g, "е");
    if (!STOPWORDS.has(raw) && t.stem.length >= MIN_TERM_CHARS) terms.add(t.stem);
  }
  return terms;
}

/**
 * Window start for a term at `at`: its sentence start; near the chunk end, shifted back so the
 * window keeps most of its width (the earliest sentence start that still leaves MIN_TAIL_SHARE
 * of it, else `end - width` at a word boundary).
 */
function placeWindow(body: string, at: number, width: number): number {
  const start = sentenceStart(body, at);
  if (body.length - start >= width) return start;
  const back = body.length - width;
  const sentence = firstSentenceStart(body, back, start);
  if (sentence !== undefined && body.length - sentence >= width * MIN_TAIL_SHARE) return sentence;
  return wordStartFrom(body, back, start);
}

/** Start of the sentence holding `at`, if it begins within MAX_SENTENCE_LEAD chars; else `at`. */
function sentenceStart(body: string, at: number): number {
  const from = Math.max(0, at - MAX_SENTENCE_LEAD);
  let start = from === 0 ? 0 : at;
  for (const m of body.slice(from, at).matchAll(SENTENCE_END)) start = from + m.index + m[0].length;
  return start;
}

/** The earliest sentence start in [from, to], or undefined when none begins there. */
function firstSentenceStart(body: string, from: number, to: number): number | undefined {
  if (from === 0 || /[.!?…]\s$|\n$/.test(body.slice(Math.max(0, from - 2), from))) return from;
  for (const m of body.slice(from, to).matchAll(SENTENCE_END)) return from + m.index + m[0].length;
  return undefined;
}

/** `from`, moved forward to the next word start so the window doesn't open mid-word (≤ `limit`). */
function wordStartFrom(body: string, from: number, limit: number): number {
  if (from === 0 || /\s/.test(body[from - 1]!)) return from;
  const ws = body.slice(from, limit).search(/\s/);
  return ws === -1 ? from : from + ws + 1;
}

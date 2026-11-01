// Edition parsing for fuzzy duplicate keys (#242). Pure, SDK-free, clean-room. Strips
// "3rd Edition" / "2nd ed." / "3e" / "3-е издание" / "друге видання" (+ whatever trails
// them) from a title and keeps the edition number on the side, so the same work groups
// across suffixes while different editions can still be told apart. Title digits that are
// not an edition ("Python 3", "Web 2.0", "C++20") are left alone.

import { isEmptyDate } from "../merge.js";

/** Not preceded / followed by a letter or digit — `\b` is ASCII-only, titles are not. */
const L = String.raw`(?<![\p{L}\p{N}])`;
const R = String.raw`(?![\p{L}\p{N}])`;

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  // RU (ё already folded to е by the caller)
  первое: 1,
  второе: 2,
  третье: 3,
  четвертое: 4,
  пятое: 5,
  шестое: 6,
  седьмое: 7,
  восьмое: 8,
  девятое: 9,
  десятое: 10,
  // UA
  перше: 1,
  друге: 2,
  третє: 3,
  четверте: 4,
  "п'яте": 5,
  шосте: 6,
  сьоме: 7,
  восьме: 8,
  "дев'яте": 9,
  десяте: 10,
};

const EN_WORD = String.raw`(?:edition|edn|ed)${R}\.?`;
// "вид." needs its dot: bare "вид" is an ordinary RU/UA word ("view", "kind").
const CYR_WORD = String.raw`(?:издание|изд|видання|вид(?=\.))${R}\.?`;
const ORDINAL_ALT = Object.keys(ORDINALS).join("|");

/** Each pattern captures the edition number (digits or an ordinal word) in group 1. */
const PATTERNS: RegExp[] = [
  // 3rd edition, 2nd ed., 3 ed
  new RegExp(String.raw`${L}(\d{1,2})\s*(?:st|nd|rd|th)?\s*${EN_WORD}`, "u"),
  // 3e
  new RegExp(String.raw`${L}(\d{1,2})e${R}`, "u"),
  // edition 3
  new RegExp(String.raw`${L}edition\s+(\d{1,2})${R}`, "u"),
  // 3-е издание, 2-е изд., 3-тє видання, 2-ге вид.
  new RegExp(String.raw`${L}(\d{1,2})\s*-?\s*(?:\p{L}{1,3})?\s*${CYR_WORD}`, "u"),
  // издание 3-е, видання 2-ге
  new RegExp(String.raw`${L}(?:издание|видання)\s+(\d{1,2})(?:\s*-?\s*\p{L}{1,3})?${R}`, "u"),
  // third edition, второе издание, друге видання
  new RegExp(String.raw`${L}(${ORDINAL_ALT})\s+(?:${EN_WORD}|${CYR_WORD})`, "u"),
];

/** A title with its edition phrase removed, plus the parsed edition number (if any). */
export interface EditionSplit {
  rest: string;
  edition?: number;
}

/**
 * Find the earliest edition phrase in a lowercased, accent-folded title. Everything from
 * the phrase on is dropped ("3rd Edition 2020", "2-е изд., перераб. и доп." are all
 * edition noise); if the phrase opens the title, only the phrase itself is removed.
 */
export function splitEdition(title: string): EditionSplit {
  const t = title.replace(/[’ʼ]/g, "'");
  let best: RegExpExecArray | undefined;
  for (const re of PATTERNS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.index)) best = m;
  }
  if (!best) return { rest: t };

  const raw = best[1]!;
  const edition = /^\d+$/.test(raw) ? Number(raw) : ORDINALS[raw];
  const prefix = t.slice(0, best.index);
  const rest = /[\p{L}\p{N}]/u.test(prefix) ? prefix : t.slice(best.index + best[0].length);
  return { rest, edition };
}

/** A title with a trailing publication year removed ("Excel 2019" → "Excel" + 2019). */
export interface YearSplit {
  rest: string;
  year?: number;
}

/**
 * Strip a trailing 19xx/20xx year that follows other title text. A title that IS a year
 * ("1984") keeps it — there would be nothing left to compare.
 */
export function splitTrailingYear(title: string): YearSplit {
  const m = /^(.*[\p{L}\p{N}].*?)[\s,.\-–—]+((?:19|20)\d{2})[\s.,]*$/u.exec(title);
  if (!m) return { rest: title };
  return { rest: m[1]!, year: Number(m[2]) };
}

/** Publication year from a Calibre pubdate; the 0101-01-01 "no date" sentinel → undefined. */
export function pubYear(pubdate: string | undefined): number | undefined {
  if (isEmptyDate(pubdate)) return undefined;
  const m = /^(\d{4})-/.exec(pubdate!);
  return m ? Number(m[1]) : undefined;
}

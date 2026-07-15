// Chapter-structure detector: maps a book's extracted plain text to chapter spans
// (number, heading, char offsets) plus a table-of-contents flag. Powers the `structure`
// mode of calibre_get_content and the calibre-distill skill's chapter walk.
//
// Ported from virgiliojr94/book-to-skill book_to_skill/utils.py (MIT) with Cyrillic
// extensions — their detector has no RU/UK support (глава/часть/раздел, оглавление/
// содержание) and returns only counts; we add those languages and return char offsets so
// callers can seek to a chapter start via a content cursor.

/** One detected chapter as a span over the extracted text. */
export interface ChapterSpan {
  /** Chapter number (explicit "Chapter N"), or a 1-based ordinal for structural headings. */
  n: number;
  /** The heading line, trimmed. */
  heading: string;
  /** Char offset where the heading line starts (== chapter body start). */
  startChar: number;
  /** Char offset where the next chapter starts (text end for the last chapter). */
  endChar: number;
}

export interface StructureResult {
  chapters: ChapterSpan[];
  hasToc: boolean;
  /** Which strategy produced `chapters`: numeric headings, structural (Markdown), or none. */
  detector: "numeric" | "structural" | "none";
}

// Explicit chapter heading: "Chapter 5", "Capítulo 5: ...", "Глава 5.", "Розділ 3".
// Latin chapter words (en/fr/de/es/pt/it/nl) + Cyrillic (ru/uk) + "ch."; "ch.?" stays
// last so the longer words win. Captures the number (1..99 — drops years like "2025.")
// and the line remainder so we can reject prose cross-references.
const EXPLICIT_CHAPTER =
  /^\s*(?:chapter|chapitre|kapitel|cap[ií]tulo|capitolo|hoofdstuk|глава|глави|розділ|розд[іi]л|часть|частина|раздел|ch\.?)\s*(\d{1,2})\b(.*)$/i;

// A heading's number is followed by end-of-line, punctuation, or a Capitalized title
// word. A lowercase continuation ("Chapter 6 explores…", "Глава 5 рассматривает…") is
// prose, not a heading. Uppercase class covers Latin-1 (À-Þ) and Cyrillic (RU + UK
// І/Ї/Є/Ґ), so "Überblick" and "Программное" both qualify.
const HEADING_TAIL = /^\s*$|^\s*[.:\-—–]|^\s+[A-ZÀ-Þ0-9А-ЯЁІЇЄҐ"“(]/u;

// Roman-numeral chapter heading: "I: Loomings", "II. The Carpet-Bag". Requires a
// separator and a Capitalized title, so a bare "I" (page divider) is not a chapter.
const ROMAN_HEAD = /^\s*([IVXLCDM]+)\s*[:.]\s+[A-ZÀ-Þ"“(]/;
const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

// CJK chapter headings: explicit "第N章" and Markdown "## 一 · …" / "## 第一讲".
const CN_NUM_VALUES: Record<string, number> = {
  "〇": 0, "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9,
};
const CN_NUM_UNITS: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };
const CN_NUM_CLASS = "〇零一二两三四五六七八九十百千";
const FW_DIGITS = "０-９"; // full-width Arabic digits (Japanese typesetting: "第１章")
const CN_CHAPTER = new RegExp(`^\\s*第\\s*([0-9${FW_DIGITS}${CN_NUM_CLASS}]+)\\s*[章回卷节篇讲]`);
const MD_CN_HEADING = new RegExp(`^#{1,6}\\s+第?\\s*([${FW_DIGITS}${CN_NUM_CLASS}]+)\\s*[·、.:：章回卷节篇讲]`);

// Table-of-contents header lines, whole-line anchored so an inline "the contents of this
// chapter" never matches. EN/ES/PT/CJK/FR/DE/IT/NL + Cyrillic (ru: оглавление/содержание,
// uk: зміст).
const TOC_HEADERS = [
  "table of contents", "contents", "índice", "sumário",
  "目录", "目錄", "目次",
  "table des matières",
  "inhaltsverzeichnis",
  "indice", "sommario",
  "inhoudsopgave",
  "оглавление", "содержание", "зміст",
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOC_PATTERN = new RegExp(`^\\s*(?:${TOC_HEADERS.map(escapeRe).join("|")})\\s*$`, "im");

// ATX heading ("# Title", "== Section"); required space distinguishes AsciiDoc "== X"
// from an RST underline "=====" (no space, ignored). Setext underline: a full row of
// "=" (level 1) or "-" (level 2), length >= 2.
const ATX_HEADING = /^(#{1,6}|={1,6})\s+(.+?)\s*#*$/;
const SETEXT_UNDERLINE = /^(={2,}|-{2,})$/;

function intToRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
    [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [val, sym] of table) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

/** Convert a Roman numeral to int, rejecting non-canonical forms ("IIII", "VV") and >200. */
function romanToInt(raw: string): number | null {
  const s = raw.toUpperCase();
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[s[i]!];
    if (v === undefined) return null;
    total += v < prev ? -v : v;
    prev = Math.max(prev, v);
  }
  if (total === 0 || total > 200) return null;
  return intToRoman(total) === s ? total : null;
}

/** Parse a Chinese (or ASCII-digit) chapter numeral into an int (1..999). */
function cnNumeralToInt(s: string): number | null {
  if (/^[0-9０-９]+$/.test(s)) {
    const n = Number(s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)));
    return n >= 1 && n <= 999 ? n : null;
  }
  let section = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in CN_NUM_VALUES) {
      current = CN_NUM_VALUES[ch]!;
    } else if (ch in CN_NUM_UNITS) {
      section += (current || 1) * CN_NUM_UNITS[ch]!;
      current = 0;
    } else {
      return null;
    }
  }
  const total = section + current;
  return total >= 1 && total <= 999 ? total : null;
}

/** Return the chapter number if `line` is a genuine chapter heading, else null. */
export function chapterNumber(line: string): number | null {
  const s = line.trim();
  if (s.length > 80) return null; // headings are short; long lines are prose
  const m = EXPLICIT_CHAPTER.exec(s);
  if (m && HEADING_TAIL.test(m[2]!)) return Number(m[1]);
  const rm = ROMAN_HEAD.exec(s);
  if (rm) return romanToInt(rm[1]!);
  const cm = CN_CHAPTER.exec(s) ?? MD_CN_HEADING.exec(s);
  if (cm) return cnNumeralToInt(cm[1]!);
  return null;
}

/** A structural (Markdown/AsciiDoc) heading occurrence with its depth and offset. */
interface StructHeading {
  depth: number;
  title: string;
  heading: string;
  startChar: number;
}

/**
 * Collect ATX/setext structural headings with offsets, then keep the shallowest depth
 * with >= 2 distinct titles (the real chapter level in a "# Book / ## Chapter" layout);
 * fall back to all headings for a thin doc. Fence-aware; rejects bare-digit and
 * punctuation-only titles. Runs only when numeric detection found nothing.
 */
function structuralChapters(lineStarts: LineInfo[]): StructHeading[] {
  const found: StructHeading[] = [];
  let inFence = false;
  let prev: { text: string; start: number } | null = null;

  for (const { text: raw, start } of lineStarts) {
    const s = raw.trim();
    if (s.startsWith("```") || s.startsWith("~~~")) {
      inFence = !inFence;
      prev = null;
      continue;
    }
    if (inFence) {
      prev = null;
      continue;
    }
    // Setext underline directly under a title line at least as long as the underline.
    if (SETEXT_UNDERLINE.test(s) && prev && prev.text && !SETEXT_UNDERLINE.test(prev.text) && s.length >= prev.text.length) {
      found.push({ depth: s[0] === "=" ? 1 : 2, title: prev.text.toLowerCase(), heading: prev.text, startChar: prev.start });
      prev = null;
      continue;
    }
    const m = ATX_HEADING.exec(s);
    if (m) {
      const title = m[2]!.trim();
      // Reject empty, bare-digit-led ("## 5 Setup"), and all-punctuation titles.
      if (title && !/^\d/.test(title) && /\w/u.test(title)) {
        found.push({ depth: m[1]!.length, title: title.toLowerCase(), heading: title, startChar: start });
      }
      prev = null;
      continue;
    }
    prev = { text: s, start };
  }

  if (found.length === 0) return [];

  // Group by depth, counting distinct titles; pick the shallowest with >= 2 distinct.
  const byDepth = new Map<number, StructHeading[]>();
  for (const h of found) {
    const arr = byDepth.get(h.depth) ?? [];
    arr.push(h);
    byDepth.set(h.depth, arr);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    const arr = byDepth.get(depth)!;
    const distinct = new Set(arr.map((h) => h.title));
    if (distinct.size >= 2) return dedupeByTitle(arr);
  }
  // Thin doc: no depth has >= 2 distinct titles → keep every heading (offset order).
  return dedupeByTitle(found.slice().sort((a, b) => a.startChar - b.startChar));
}

/** Keep the first occurrence of each distinct title, sorted by offset. */
function dedupeByTitle(headings: StructHeading[]): StructHeading[] {
  const seen = new Set<string>();
  const out: StructHeading[] = [];
  for (const h of headings.slice().sort((a, b) => a.startChar - b.startChar)) {
    if (seen.has(h.title)) continue;
    seen.add(h.title);
    out.push(h);
  }
  return out;
}

interface LineInfo {
  text: string;
  start: number;
}

/** Split `text` into lines carrying each line's char offset (handles \n and \r\n). */
function lineOffsets(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  return lines;
}

/**
 * Detect chapter spans and ToC presence in extracted book text.
 *
 * Numeric headings ("Chapter N" / "Глава N") are preferred; a chapter number can recur
 * (a ToC entry and the body heading), so for each distinct number we keep the occurrence
 * with the largest body — the real chapter, not the ToC line. Text before the first kept
 * chapter is front matter (excluded from spans, but its ToC flag is kept). When no numeric
 * headings exist, fall back to structural Markdown/AsciiDoc headings.
 */
export function detectChapters(text: string): StructureResult {
  const hasToc = TOC_PATTERN.test(text.slice(0, 30_000));
  const lines = lineOffsets(text);

  // 1. Every numeric heading occurrence, in text order.
  const occ: { n: number; heading: string; startChar: number }[] = [];
  for (const { text: raw, start } of lines) {
    const n = chapterNumber(raw);
    if (n !== null) occ.push({ n, heading: raw.trim(), startChar: start });
  }

  if (occ.length > 0) {
    // Body of occurrence i = distance to the next heading occurrence (ToC lines cluster
    // → tiny bodies; real chapters → large bodies).
    const bodyLen = (i: number): number => (i + 1 < occ.length ? occ[i + 1]!.startChar : text.length) - occ[i]!.startChar;

    // For each distinct number, keep the largest-body occurrence.
    const best = new Map<number, { heading: string; startChar: number }>();
    const bestBody = new Map<number, number>();
    for (let i = 0; i < occ.length; i++) {
      const o = occ[i]!;
      const len = bodyLen(i);
      if (!bestBody.has(o.n) || len > bestBody.get(o.n)!) {
        bestBody.set(o.n, len);
        best.set(o.n, { heading: o.heading, startChar: o.startChar });
      }
    }

    const picked = [...best.entries()]
      .map(([n, v]) => ({ n, ...v }))
      .sort((a, b) => a.startChar - b.startChar);

    const chapters: ChapterSpan[] = picked.map((c, i) => ({
      n: c.n,
      heading: c.heading,
      startChar: c.startChar,
      endChar: i + 1 < picked.length ? picked[i + 1]!.startChar : text.length,
    }));
    return { chapters, hasToc, detector: "numeric" };
  }

  // 2. Structural fallback (Markdown/AsciiDoc headings → sequential ordinals).
  const struct = structuralChapters(lines);
  if (struct.length > 0) {
    const chapters: ChapterSpan[] = struct.map((h, i) => ({
      n: i + 1,
      heading: h.heading,
      startChar: h.startChar,
      endChar: i + 1 < struct.length ? struct[i + 1]!.startChar : text.length,
    }));
    return { chapters, hasToc, detector: "structural" };
  }

  return { chapters: [], hasToc, detector: "none" };
}

// A "first chapter" deeper than this is more likely a detector miss than real front matter;
// claiming 20%+ of a book as front matter would demote genuine body content in search.
const FRONT_MATTER_MAX_FRACTION = 0.2;
const FRONT_MATTER_MAX_CHARS = 60_000;

/**
 * Char offset where the book's body starts: everything before the first detected chapter
 * (TOC, praise pages, foreword) is front matter. Returns 0 — "no front matter claimed" —
 * when no chapters are detected or the boundary is implausibly deep (see the guard above).
 * Powers the front-matter demotion in semantic search (issue #18).
 */
export function frontMatterEnd(text: string): number {
  const { chapters } = detectChapters(text);
  if (chapters.length === 0) return 0;
  const boundary = chapters[0]!.startChar;
  const cap = Math.min(FRONT_MATTER_MAX_FRACTION * text.length, FRONT_MATTER_MAX_CHARS);
  return boundary > cap ? 0 : boundary;
}
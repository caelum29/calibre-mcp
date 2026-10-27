// Caption-line detection for the Figure inventory (D-018, CONTEXT.md § Book images).
// A Figure is an image the text refers to; the caption line is its anchor. Patterns are
// a code constant on purpose — extending them is a PR, never config or user regex (#30).

/** A caption line found in extracted page text. */
export interface Caption {
  /** 1-based PDF page the caption line sits on. */
  page: number;
  /** Figure number as printed (`1-1`, `15.7`) — kept as a string, separators vary. */
  label: string;
  /** Caption text after the label, wrapped lines joined; empty for a label-only Figure. */
  text: string;
}

// Line-start caption patterns. The separator after the number is what distinguishes a
// caption ("Figure 1-1. The mental model…") from an in-text reference ("Figure 1-1
// illustrates…") — probe 2026-07-22: O'Reilly uses `.`, No Starch `:`, Packt a spaced
// dash ("Figure 12.1 – Logical architecture…", EPUB probe #78; space required so the
// label's own hyphen never reads as a separator). Leading \f is real: pdftotext starts
// each page with a form feed, and a caption can be the first line of a page.
// RU: `Рис. 15.7.` (Lesovsky), no-space `рис.15.7` (Nikolskiy), `Рисунок 3. …`.
const RU_PATTERN = /^[\f\s]*(?:Рис(?:унок)?|рис(?:унок)?)\.?\s?(\d+(?:[.,–-]\d+)?)\.?\s*[–—-]?\s*(.*)$/u;

const CAPTION_PATTERNS: readonly RegExp[] = [
  // EN: Figure 1-1. … | Figure 1.1: … | Fig. 3. … | Figure 12.1 – …
  // (?!\d) keeps a dotted label whole: "Figure 4.1 and…" must not backtrack into
  // label "4" + separator "." + text "1 and…" — an in-text reference, not a caption.
  /^[\f\s]*(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)\s*(?:[.:](?!\d)|\s[–—-])\s*(.*)$/u,
  // Manning: Figure 4.1␣␣Text — no `.`/`:` separator, a wide gap (2+ spaces / tab)
  // instead (probe #77: the strict pattern misreads the label's own dot as the
  // separator → label "4", text "1 Text"). Text must not start lowercase — that's
  // the in-text-reference shape ("Figure 2.12  displays…" wrapped oddly).
  /^[\f\s]*(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)(?:[ \t]{2,})(?![a-zа-яё])(\S.*)$/u,
  RU_PATTERN,
];

// Context guard (#116): an in-text reference that wraps to the start of a line is
// indistinguishable from a caption on the line alone ("Figure 2.10. This instruction
// pipeline is…" — the `.` is the *referring* sentence's period). The distinguishing
// signal is the previous line: a caption is preceded by a blank line or a line ending
// in terminal punctuation, a wrapped reference by prose whose sentence runs on.
// Length-gated because short run-on lines are diagram inner labels ("Выход",
// "спортсмен"), not prose — probe over 30 sampled PDFs: 21 rejections, all genuine
// in-text references bar one ambiguous two-column RU case, 0 real captions lost.
const PROSE_LINE_MIN = 40;
const RUNS_ON = /[a-zа-яё,;\-–—¬­]\s*$/u;

/** True when `prevLine` is a wrapped prose line whose sentence continues into the next. */
export function runsOnIntoNextLine(prevLine: string): boolean {
  const prev = prevLine.replace(/\s+$/u, "");
  return prev.length >= PROSE_LINE_MIN && RUNS_ON.test(prev);
}

/** Split extracted PDF text into pages on the form feeds pdftotext emits. */
export function splitPages(text: string): string[] {
  return text.split("\f");
}

// Two-line bare label (#107): "Figure 2.10" alone on its line, caption text on the next
// (Modern Processor Design, Manning PDFs, RU "Рис. 7.2" under a diagram). PDF page text
// only — matchCaptionLine stays single-line for EPUB blocks and marker placement.
const BARE_LABEL = /^[\f\s]*(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)\s*$/u;
// Caption text opening on closing punctuation is the referring sentence running on past
// the label: "(см.\nрис. 11.10) или…" — the "(см." period fools the #116 guard (#107).
const REFERENCE_TAIL = /^[)\]},;]/u;
// RU captions start capitalized; "рис. 3.18 наглядно видно…" and "рис. 3.2 (справа)."
// are references (books 503, 590). EN keeps lowercase starts: identifiers lead real
// captions ("tcp_v4_do_rcv …").
const RU_REFERENCE_TEXT = /^\(?[а-яё]/u;
// Dingbat-font separator glyphs land in the Private Use Area (book 610 prints U+F076
// between "Рис. 1.1" and the text).
export const PUA_LEAD = /^[\uE000-\uF8FF]\s*/u;

// Multi-line captions (#107): pdftotext breaks captions at the column edge, so the
// scan joins continuation lines. A continuation starts lowercase or "(", or follows a
// dangling function word; captions set as a block under a bare label are Title Case, so
// there any line continues until terminal punctuation. Blank lines and caption lines end
// it, as do the caps — a caption longer than that is a paragraph we'd be swallowing.
const TERMINAL = /[.!?…]["'”»)]?$/u;
const DANGLING =
  /(?:^|\s)(?:a|an|the|of|and|or|to|for|in|on|with|by|from|at|as|into|via|its|their|that|which|и|или|в|во|на|для|с|со|по|из|к|о|об|от|при|а|но|что|как)$/iu;
const CONTINUES = /^[a-zа-яё(]/u;
const MAX_CONTINUATION_LINES = 3;
export const CAPTION_MAX = 300;

/** Scan extracted text (with `\f` page breaks) for captions, in document order. */
export function scanCaptions(text: string): Caption[] {
  const captions: Caption[] = [];
  const pages = splitPages(text);
  for (let p = 0; p < pages.length; p++) {
    const lines = (pages[p] ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hit = readCaption(lines, i);
      if (hit) captions.push({ page: p + 1, ...hit });
    }
  }
  return dropStrayLabels(captions);
}

// A page carrying this many label-only heads is a list of figures or a back-of-book
// index ("ARP message format / Figure 13-6 / 218"), not figures (book 1111: 322 rows).
const LABEL_LIST_PAGE_MIN = 4;

/**
 * Drop label-only captions that aren't figures: a label that also has a real caption
 * elsewhere (the label-only one is a reference or an index entry), and every label-only
 * head on a page dense with them. Label-only figures with no captioned twin stay.
 */
function dropStrayLabels(captions: Caption[]): Caption[] {
  const captioned = new Set(captions.filter((c) => c.text !== "").map((c) => normalizeLabel(c.label)));
  const labelOnlyPerPage = new Map<number, number>();
  for (const c of captions) {
    if (c.text === "") labelOnlyPerPage.set(c.page, (labelOnlyPerPage.get(c.page) ?? 0) + 1);
  }
  return captions.filter(
    (c) =>
      c.text !== "" ||
      (!captioned.has(normalizeLabel(c.label)) && (labelOnlyPerPage.get(c.page) ?? 0) < LABEL_LIST_PAGE_MIN),
  );
}

/** Label separators vary within one book (`2-1` vs `2.1` vs `2–1`) — compare canonically. */
function normalizeLabel(label: string): string {
  return label.replace(/[-–.,]/g, ".");
}

/** The caption starting at `lines[i]` with its continuation lines joined; null when none. */
function readCaption(lines: string[], i: number): { label: string; text: string } | null {
  const line = lines[i] ?? "";
  const prev = lines[i - 1];
  const hit = matchCaptionLine(line, prev) ?? matchBareLabel(line, prev);
  if (!hit) return null;

  let next = i + 1;
  let block = false;
  if (hit.text === "") {
    // "…is shown in\n\nFigure 12-32." — the referring sentence wrapped past a blank line;
    // the period is the sentence's, so look through the blank for run-on prose.
    if (/\.\s*$/u.test(line) && runsOnIntoNextLine(previousNonBlank(lines, i))) return null;
    const following = (lines[next] ?? "").trim();
    if (following !== "") {
      // a lowercase line under a label-only head is a wrapped reference ("Figure 2.10\n
      // shows…") or a diagram's inner label ("sys_socket"), never caption text
      if (/^[a-zа-яё]/u.test(following)) return null;
      if (looksLikeBlockCaption(following)) {
        hit.text = following;
        block = true;
        next++;
      }
    }
    // blank next line: a label-only Figure (RU "Рис. 7.2" under a diagram) — still a Figure
  }

  let joined = 0;
  let lastLen = hit.text.length; // physical length of the line joined last
  for (; joined < MAX_CONTINUATION_LINES; joined++) {
    if (hit.text === "" || hit.text.length >= CAPTION_MAX || TERMINAL.test(hit.text)) break;
    const cont = (lines[next] ?? "").trim();
    if (endsBlock(cont)) break;
    // Title Case block captions continue on a capitalized line only after a full-width
    // line; a short one ("The methods of Map") followed by a sentence is a heading + prose
    const wrapped = block && lastLen >= BLOCK_WRAP_MIN;
    if (!wrapped && !CONTINUES.test(cont) && !DANGLING.test(hit.text)) break;
    hit.text = joinLine(hit.text, cont);
    lastLen = cont.length;
    next++;
  }
  // A block caption is a short self-contained run under its label. Body prose that
  // happens to follow a label ("Figure 2-2" / "Figure 2-3 shows the same information…",
  // book 947) runs on past it — keep the label-only Figure, not the paragraph.
  if (block) {
    const isolated = endsBlock((lines[next] ?? "").trim());
    const shortSentence = TERMINAL.test(hit.text) && joined <= 1;
    if (FIGURE_WORD.test(hit.text) || !(isolated || shortSentence)) hit.text = "";
  }
  hit.text = markCut(hit.text);
  return hit;
}

/** Mark a cut caption instead of ending silently mid-clause: over the cap, or on a dangling word. */
export function markCut(text: string): string {
  if (text.length > CAPTION_MAX) return `${text.slice(0, CAPTION_MAX - 1)}…`;
  return DANGLING.test(text) ? `${text}…` : text;
}

export const FIGURE_WORD = /^(?:Figure|FIGURE|Fig\.|Рис)/u;
/** Shortest line that reads as wrapped at the column edge rather than ending a title. */
const BLOCK_WRAP_MIN = 30;
// What sits under a bare label besides its caption (sweep of 1037 books): page numbers and
// back-of-book index entries ("Ручное тестирование 371,385,510"), image ids ("F03MQ02"),
// sidebar admonitions ("ПРИМЕЧАНИЕ Метод…"), footnote links, lone words.
// Starts: "Network…", "IDA Pro…", "P6 Microarchitecture…", "(a) A Four-Stage…"
const CAPTION_START = /^(?:[A-ZА-ЯЁ][a-zа-яё]|[A-ZА-ЯЁ]+\d*[\s/-]|\([a-zа-я]\)\s)/u;
export const ADMONITION = /^(?:NOTE|TIP|WARNING|CAUTION|IMPORTANT|ПРИМЕЧАНИЕ|СОВЕТ|ВНИМАНИЕ|ПРЕДУПРЕЖДЕНИЕ)(?=\s|$)/u;
export const PAGE_LIST_TAIL = /\s\d[\d,\s–-]*$/u;

/** True when the line under a bare label reads as caption text, not page furniture. */
export function looksLikeBlockCaption(line: string): boolean {
  return (
    CAPTION_START.test(line) &&
    !ADMONITION.test(line) &&
    !PAGE_LIST_TAIL.test(line) &&
    line.split(/[\s-]+/u).filter((w) => /\p{L}/u.test(w)).length >= 2
  );
}

/** A blank line or the next caption ends a caption's run of lines. */
function endsBlock(line: string): boolean {
  return line === "" || matchCaptionLine(line) !== null || BARE_LABEL.test(line);
}

/** A line that is only a figure label; the #116 run-on guard applies as for any caption. */
export function matchBareLabel(line: string, prevLine?: string): { label: string; text: string } | null {
  if (prevLine !== undefined && runsOnIntoNextLine(prevLine)) return null;
  const m = BARE_LABEL.exec(line);
  return m ? { label: m[1] ?? "", text: "" } : null;
}

function previousNonBlank(lines: string[], i: number): string {
  for (let k = i - 1; k >= 0; k--) {
    if ((lines[k] ?? "").trim() !== "") return lines[k] ?? "";
  }
  return "";
}

/** Join a wrapped line: soft hyphens and RU word breaks drop, EN compounds keep their dash. */
export function joinLine(text: string, cont: string): string {
  if (/[¬\u00ad]$/u.test(text)) return text.slice(0, -1) + cont;
  if (/[а-яё]-$/u.test(text) && /^[а-яё]/u.test(cont)) return text.slice(0, -1) + cont;
  if (/[A-Za-z]-$/u.test(text) && /^[a-z]/u.test(cont)) return text + cont;
  return `${text} ${cont}`;
}

/**
 * Match one line against the caption patterns; null when it isn't a caption.
 * `prevLine` is the physically preceding line when the caller has one (PDF page text);
 * callers matching a standalone block (EPUB caption elements) omit it.
 */
export function matchCaptionLine(line: string, prevLine?: string): { label: string; text: string } | null {
  // Guard: long lines are prose that happens to start with "Figure …" mid-sentence
  // wrapped to line start; real captions are short. 300 chars is generous.
  if (line.length > 300) return null;
  if (prevLine !== undefined && runsOnIntoNextLine(prevLine)) return null;
  for (const re of CAPTION_PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    const text = (m[2] ?? "").trim().replace(PUA_LEAD, "");
    if (REFERENCE_TAIL.test(text)) return null;
    if (re === RU_PATTERN && RU_REFERENCE_TEXT.test(text)) return null;
    return { label: m[1] ?? "", text };
  }
  return null;
}

// Caption-dedicated blocks (EPUB figcaption/h1–h6, their markdown `#####` rendering in the
// ebook-convert txt) hold captions, never prose, so a numbered "Figure 4.1 Standard RL loop"
// WITHOUT a separator is trustworthy there (pandoc and newer Manning EPUBs emit exactly
// that). In running text the separator stays required, or in-text references ("Figure 4.1
// and how it compares…") would false-match. Greedy label first, so "4.1" stays whole (the
// strict pattern would misread the label's own dot as the separator); separator optional.
const RELAXED_EN = /^(?:Figure|FIGURE|Fig\.)\s?(\d+(?:[-–.]\d+)?[a-z]?)(?:\s*[.:]|\s+[–—-])?(?:\s+|$)(.*)$/u;

/**
 * Match the text of a caption-dedicated block (heading/figcaption): the separator-less
 * form first, then the regular caption patterns. Null when it isn't a caption.
 */
export function matchCaptionElement(text: string): { label: string; text: string } | null {
  if (text.length > 300) return null;
  const relaxed = RELAXED_EN.exec(text);
  if (relaxed) return { label: relaxed[1] ?? "", text: (relaxed[2] ?? "").trim() };
  return matchCaptionLine(text);
}

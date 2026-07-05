// D1.4 mechanical legal gate — the deterministic, model-free half of the E3.1 verifier
// (PRODUCT-DECISIONS.md D1.4 / D1.7). Given a distilled skill's shareable text + the source
// book text(s) it was built from, run five structural checks that catch verbatim leakage
// (quotes/code/tables), abridgment drift, ToC mirroring, cursor leaks, and missing
// attribution. Pure & SDK/IO-free: every function takes strings/structs and returns findings,
// so it runs identically in a unit test and in scripts/legal-gate.mjs. Unicode-safe — RU text
// is a first-class case (the library is EN+RU).

// ── Exported thresholds (single source of truth; the report and tests read these) ──────────

/** Sliding-window size for verbatim-shingle detection (D1.4). 8 words = the validated probe. */
export const SHINGLE_SIZE = 8;
/** A single quoted span longer than this (words) trips the quote budget (D1.3 #2). */
export const MAX_WORDS_PER_QUOTE = 25;
/** Total quoted words across the artifact above this trips the budget. */
export const MAX_TOTAL_QUOTED_WORDS = 200;
/** Whole-artifact compression floor: sourceTokensRead / skillTokens must be ≥ this. */
export const MIN_COMPRESSION_FACTOR = 20;
/** Fraction of the skill's own expressive headings allowed to verbatim-match source chapters. */
export const MAX_HEADING_MATCH_FRACTION = 0.5;

// ── Text normalization ─────────────────────────────────────────────────────────────────────

/**
 * Normalize prose for shingle comparison: lowercase, drop every non-letter/non-number to a
 * space (Unicode-aware, so Cyrillic survives and `«»`/`—`/contractions vanish), collapse
 * whitespace. Returns the token array.
 */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Strip a leading YAML frontmatter block (`---\n…\n---`). Frontmatter is skill METADATA
 * (name/description), not prose — its quoted `description:` value would otherwise be
 * miscounted as a book quotation by quoteBudget (hit live on the kafka prototype).
 */
export function stripFrontmatter(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return m ? markdown.slice(m[0].length) : markdown;
}

/**
 * Strip a Markdown document down to its running prose: remove YAML frontmatter, HTML
 * comments, fenced code blocks, inline code, ATX/setext headings, table rows/separators,
 * and blockquote/list markers. Config tables and code are FACTS (not expression) and would
 * false-positive the shingle check, so they're excluded — the gate protects PROSE (D1.4).
 */
export function extractProse(markdown: string): string {
  let s = stripFrontmatter(markdown);
  s = s.replace(/<!--[\s\S]*?-->/g, " "); // HTML comments
  s = s.replace(/```[\s\S]*?```/g, " "); // fenced code (backtick)
  s = s.replace(/~~~[\s\S]*?~~~/g, " "); // fenced code (tilde)
  s = s.replace(/`[^`\n]*`/g, " "); // inline code

  const kept: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue; // ATX heading
    if (/^[=-]{2,}$/.test(line)) continue; // setext underline / hr
    if (/^\s*\|/.test(line) || (line.match(/\|/g)?.length ?? 0) >= 2) continue; // table row
    if (/^\s*[-*+:]+\s*$/.test(line)) continue; // table separator / bullet-only
    // Strip leading blockquote + list markers, then keep the prose remainder.
    kept.push(line.replace(/^\s*>+\s*/, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""));
  }
  return kept.join("\n");
}

/** Rough token estimate for the compression floor (whitespace words ≈ tokens; good enough). */
export function estimateTokens(text: string): number {
  return normalizeWords(text).length;
}

// ── 1. Verbatim shingle overlap ──────────────────────────────────────────────────────────

export interface ShingleHit {
  /** The offending 8-word run, normalized. */
  shingle: string;
  /** Word index into the skill's prose token stream (approximate position). */
  wordIndex: number;
}

export interface ShingleOptions {
  /**
   * Phrases exempt from matching — at minimum each source's title/subtitle and author names.
   * The mandatory bibliography reprints the title verbatim, which legitimately appears in the
   * source's own title page; without this allowlist the attribution self-trips the gate
   * (D1.7 finding a).
   */
  allowlist?: string[];
  /** Override the shingle size (defaults to SHINGLE_SIZE). */
  size?: number;
}

/**
 * Find normalized `size`-word shingles the skill's PROSE shares with `sourceText`. Markdown
 * syntax + code + tables are stripped from the skill first (extractProse); the source is
 * plain extracted text. Any shingle fully contained in an allowlist phrase (title/authors) is
 * exempt. Returns the hits (empty = clean).
 */
export function shingleOverlaps(
  skillText: string,
  sourceText: string,
  opts: ShingleOptions = {},
): ShingleHit[] {
  const size = opts.size ?? SHINGLE_SIZE;
  const allow = (opts.allowlist ?? []).map((p) => normalizeWords(p).join(" ")).filter(Boolean);

  const sourceShingles = new Set<string>();
  const src = normalizeWords(sourceText);
  for (let i = 0; i + size <= src.length; i++) {
    sourceShingles.add(src.slice(i, i + size).join(" "));
  }

  const prose = normalizeWords(extractProse(skillText));
  const hits: ShingleHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + size <= prose.length; i++) {
    const shingle = prose.slice(i, i + size).join(" ");
    if (!sourceShingles.has(shingle)) continue;
    if (allow.some((phrase) => phrase.includes(shingle))) continue; // title/author window
    if (seen.has(shingle)) continue;
    seen.add(shingle);
    hits.push({ shingle, wordIndex: i });
  }
  return hits;
}

// ── 2. Quote budget ────────────────────────────────────────────────────────────────────────

export interface QuoteSpan {
  text: string;
  words: number;
  kind: "double" | "guillemet" | "blockquote";
}

export interface QuoteBudgetResult {
  spans: QuoteSpan[];
  totalWords: number;
  /** Spans exceeding MAX_WORDS_PER_QUOTE. */
  overLong: QuoteSpan[];
  /** True if a span is too long OR the total exceeds MAX_TOTAL_QUOTED_WORDS. */
  exceeded: boolean;
}

/**
 * Account for quoted material: straight/curly double quotes, `«…»` guillemets, and Markdown
 * blockquote lines. Flags any single span > MAX_WORDS_PER_QUOTE and a running total >
 * MAX_TOTAL_QUOTED_WORDS. Code fences are stripped first so string literals aren't miscounted.
 */
export function quoteBudget(skillText: string): QuoteBudgetResult {
  // Frontmatter is metadata — its quoted description: value is not a book quotation.
  const noCode = stripFrontmatter(skillText)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const spans: QuoteSpan[] = [];

  const pushSpan = (text: string, kind: QuoteSpan["kind"]): void => {
    const words = normalizeWords(text).length;
    if (words > 0) spans.push({ text: text.trim(), words, kind });
  };

  for (const m of noCode.matchAll(/[“"]([^“”"]{1,4000})[”"]/g)) pushSpan(m[1]!, "double");
  for (const m of noCode.matchAll(/«([^»]{1,4000})»/g)) pushSpan(m[1]!, "guillemet");

  // Consecutive blockquote lines coalesce into one span.
  let block: string[] = [];
  const flush = (): void => {
    if (block.length) pushSpan(block.join(" "), "blockquote");
    block = [];
  };
  for (const line of noCode.split("\n")) {
    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) block.push(bq[1]!);
    else flush();
  }
  flush();

  const totalWords = spans.reduce((n, s) => n + s.words, 0);
  const overLong = spans.filter((s) => s.words > MAX_WORDS_PER_QUOTE);
  return {
    spans,
    totalWords,
    overLong,
    exceeded: overLong.length > 0 || totalWords > MAX_TOTAL_QUOTED_WORDS,
  };
}

// ── 3. Compression floor ───────────────────────────────────────────────────────────────────

export interface CompressionInput {
  skillTokens: number;
  sourceTokensRead: number;
  /** Optional per-chapter ratios (per-book skills) — each is checked against the floor too. */
  chapters?: { heading: string; skillTokens: number; sourceTokens: number }[];
}

export interface CompressionResult {
  ratio: number;
  floor: number;
  /** Per-chapter entries below the floor (empty for topic skills with no chapters supplied). */
  belowFloor: { heading: string; ratio: number }[];
  pass: boolean;
}

/**
 * Whole-artifact compression floor: `sourceTokensRead / skillTokens ≥ MIN_COMPRESSION_FACTOR`.
 * Optionally verifies each per-chapter ratio for per-book skills. A skill that isn't lossy
 * enough is an abridgment, not a summary (D1 factor-3/4).
 */
export function compressionCheck(input: CompressionInput): CompressionResult {
  const floor = MIN_COMPRESSION_FACTOR;
  const ratio = input.skillTokens > 0 ? input.sourceTokensRead / input.skillTokens : 0;
  const belowFloor = (input.chapters ?? [])
    .map((c) => ({ heading: c.heading, ratio: c.skillTokens > 0 ? c.sourceTokens / c.skillTokens : 0 }))
    .filter((c) => c.ratio < floor);
  return { ratio, floor, belowFloor, pass: ratio >= floor && belowFloor.length === 0 };
}

// ── 4. Heading match (ToC mirror) ────────────────────────────────────────────────────────

export interface HeadingMatchOptions {
  threshold?: number;
  /**
   * Predicate marking a skill heading as an EXEMPT metadata block (bibliography / L4 /
   * attribution) — headings there are REQUIRED to mirror the source, so they don't count
   * toward the mirror fraction (D1.4).
   */
  exempt?: (heading: string) => boolean;
}

export interface HeadingMatchResult {
  matched: string[];
  /** Expressive (non-exempt) skill headings considered. */
  considered: number;
  fraction: number;
  threshold: number;
  /** FAIL when the fraction exceeds the threshold (a verbatim-ToC mirror). */
  pass: boolean;
}

const normHeading = (h: string): string => normalizeWords(h).join(" ");

/** Default exemption: bibliography / L4 / attribution / "going deeper" section headings. */
export function isMetadataHeading(heading: string): boolean {
  return /biblio|attribution|going deeper|sources?|references?|\bl4\b|further reading|литератур|источник/i.test(
    heading,
  );
}

/**
 * Fraction of the skill's own EXPRESSIVE section headings that verbatim-match (after
 * normalization) a source chapter heading. Above `threshold` = the skill mirrors a source's
 * table of contents (a faithful-recount tell). Metadata/L4 headings are exempt.
 */
export function headingMatch(
  skillHeadings: string[],
  detectedChapters: string[],
  opts: HeadingMatchOptions = {},
): HeadingMatchResult {
  const threshold = opts.threshold ?? MAX_HEADING_MATCH_FRACTION;
  const isExempt = opts.exempt ?? isMetadataHeading;
  const sourceSet = new Set(detectedChapters.map(normHeading).filter(Boolean));

  const expressive = skillHeadings.filter((h) => h.trim() && !isExempt(h));
  const matched = expressive.filter((h) => sourceSet.has(normHeading(h)));
  const fraction = expressive.length > 0 ? matched.length / expressive.length : 0;
  return {
    matched,
    considered: expressive.length,
    fraction,
    threshold,
    pass: fraction <= threshold,
  };
}

// ── 5. Cursor leak ───────────────────────────────────────────────────────────────────────

export interface CursorHit {
  token: string;
  index: number;
}

// Content cursors are base64url(JSON {offset,id,format}) (src/tools/content-cursor.ts). Also
// catch the generator's `{{CHAPTER_CURSOR}}` template slot if it leaks into a shareable file.
const BASE64URL_RUN = /[A-Za-z0-9_-]{16,}/g;
const CURSOR_PLACEHOLDER = /\{\{\s*[A-Z_]*CURSOR[A-Z_]*\s*\}\}/g;

/** True if `s` base64url-decodes to a content-cursor shape ({offset,id,format}). */
function looksLikeCursor(s: string): boolean {
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    if (!json.includes("{")) return false;
    const o = JSON.parse(json) as unknown;
    if (typeof o !== "object" || o === null) return false;
    const c = o as Record<string, unknown>;
    return typeof c.offset === "number" && typeof c.id === "number" && typeof c.format === "string";
  } catch {
    return false;
  }
}

/**
 * Detect content-cursor tokens (or unfilled `{{…CURSOR…}}` slots) in text destined for a
 * shareable file. Cursors are non-portable local extraction indices and must never cross the
 * wire (D2.4) — their presence in a shared artifact is a leak.
 */
export function cursorLeak(text: string): CursorHit[] {
  const hits: CursorHit[] = [];
  for (const m of text.matchAll(CURSOR_PLACEHOLDER)) hits.push({ token: m[0], index: m.index });
  for (const m of text.matchAll(BASE64URL_RUN)) {
    if (looksLikeCursor(m[0])) hits.push({ token: m[0], index: m.index });
  }
  return hits;
}

// ── 6. Attribution presence ────────────────────────────────────────────────────────────────

export interface AttributionResult {
  hasIsbn: boolean;
  hasAuthorBlock: boolean;
  hasBuyLine: boolean;
  missing: string[];
  pass: boolean;
}

const ISBN_MENTION = /\bISBN\b|\b97[89][\d\s-]{10,17}\b/i;
const AUTHOR_MENTION = /\b(author|by|edition)\b|—\s*[A-ZА-ЯЁ]/i;
const BUY_LINE = /\b(buy|purchase|consider buying|own the book|support the author|acquire)\b/i;

/**
 * Structural attribution check: the artifact must carry an ISBN, an author/edition reference,
 * and a buy-the-book line (D1.3 #6 / D1.7 rule 3). Model-free — just presence.
 */
export function attributionPresent(skillText: string): AttributionResult {
  const hasIsbn = ISBN_MENTION.test(skillText);
  const hasAuthorBlock = AUTHOR_MENTION.test(skillText);
  const hasBuyLine = BUY_LINE.test(skillText);
  const missing: string[] = [];
  if (!hasIsbn) missing.push("isbn");
  if (!hasAuthorBlock) missing.push("author");
  if (!hasBuyLine) missing.push("buy-the-book line");
  return { hasIsbn, hasAuthorBlock, hasBuyLine, missing, pass: missing.length === 0 };
}

// ── Aggregate ──────────────────────────────────────────────────────────────────────────────

export type LegalCheck =
  | "shingle"
  | "compression_floor"
  | "heading_match"
  | "cursors"
  | "quote_budget"
  | "attribution";

export interface LegalFinding {
  check: LegalCheck;
  pass: boolean;
  detail: string;
  /** Structured payload for programmatic report rendering. */
  data?: unknown;
}

export interface LegalGateResult {
  pass: boolean;
  findings: LegalFinding[];
}

export interface LegalGateInputs {
  /** Concatenated shareable prose (all shareable files joined). */
  skillText: string;
  /** Source book texts (one per source), with a label for reporting. */
  sources: { label: string; text: string }[];
  /** Title/subtitle + author names exempt from the shingle check (D1.7 finding a). */
  allowlist: string[];
  /** The skill's own ATX section headings (expressive files). */
  skillHeadings: string[];
  /** Chapter headings detected across the sources (detectChapters output). */
  detectedChapters: string[];
  skillTokens: number;
  sourceTokensRead: number;
  /** Optional per-chapter compression rows (per-book skills). */
  chapters?: CompressionInput["chapters"];
}

/**
 * Run all five D1.4 checks and aggregate into `{pass, findings}` whose `check` keys match the
 * manifest `quality.legal_gate` block (shingle, compression_floor, heading_match, cursors) plus
 * quote_budget + attribution. `pass` is the AND of every check.
 */
export function runLegalGate(inputs: LegalGateInputs): LegalGateResult {
  const findings: LegalFinding[] = [];

  // shingle — union of hits across every source.
  const shingleHits = inputs.sources.flatMap((s) =>
    shingleOverlaps(inputs.skillText, s.text, { allowlist: inputs.allowlist }).map((h) => ({
      ...h,
      source: s.label,
    })),
  );
  findings.push({
    check: "shingle",
    pass: shingleHits.length === 0,
    detail:
      shingleHits.length === 0
        ? `0 verbatim ${SHINGLE_SIZE}-word overlaps across ${inputs.sources.length} source(s)`
        : `${shingleHits.length} verbatim ${SHINGLE_SIZE}-word overlap(s) — e.g. "${shingleHits[0]!.shingle}" (${shingleHits[0]!.source})`,
    data: shingleHits,
  });

  // compression floor
  const comp = compressionCheck({
    skillTokens: inputs.skillTokens,
    sourceTokensRead: inputs.sourceTokensRead,
    chapters: inputs.chapters,
  });
  findings.push({
    check: "compression_floor",
    pass: comp.pass,
    detail: `${comp.ratio.toFixed(1)}× compression (floor ${comp.floor}×)${
      comp.belowFloor.length ? `; ${comp.belowFloor.length} chapter(s) below floor` : ""
    }`,
    data: comp,
  });

  // heading match
  const head = headingMatch(inputs.skillHeadings, inputs.detectedChapters);
  findings.push({
    check: "heading_match",
    pass: head.pass,
    detail: `${(head.fraction * 100).toFixed(0)}% of ${head.considered} expressive heading(s) mirror a source chapter (max ${(head.threshold * 100).toFixed(0)}%)`,
    data: head,
  });

  // cursors
  const cursorHits = cursorLeak(inputs.skillText);
  findings.push({
    check: "cursors",
    pass: cursorHits.length === 0,
    detail: cursorHits.length === 0 ? "no cursor tokens in shareable text" : `${cursorHits.length} cursor token(s) leaked`,
    data: cursorHits,
  });

  // quote budget
  const quotes = quoteBudget(inputs.skillText);
  findings.push({
    check: "quote_budget",
    pass: !quotes.exceeded,
    detail: `${quotes.totalWords} quoted word(s) in ${quotes.spans.length} span(s); ${quotes.overLong.length} over ${MAX_WORDS_PER_QUOTE} words (cap ${MAX_TOTAL_QUOTED_WORDS} total)`,
    data: quotes,
  });

  // attribution
  const attr = attributionPresent(inputs.skillText);
  findings.push({
    check: "attribution",
    pass: attr.pass,
    detail: attr.pass ? "isbn + author + buy-the-book line present" : `missing: ${attr.missing.join(", ")}`,
    data: attr,
  });

  return { pass: findings.every((f) => f.pass), findings };
}

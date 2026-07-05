import { describe, it, expect } from "vitest";
import {
  shingleOverlaps,
  quoteBudget,
  compressionCheck,
  headingMatch,
  cursorLeak,
  attributionPresent,
  runLegalGate,
  extractProse,
  normalizeWords,
  MAX_WORDS_PER_QUOTE,
  MAX_TOTAL_QUOTED_WORDS,
  MIN_COMPRESSION_FACTOR,
  MAX_HEADING_MATCH_FRACTION,
} from "../../../src/domain/distill/legal-gate.js";

const SOURCE_EN =
  "A message is considered committed once it has been written to all in sync replicas but " +
  "not necessarily flushed to disk. The broker keeps the last five batches per partition and " +
  "drops any resend, which removes producer retry duplicates without any coordination.";

const SOURCE_RU =
  "Сообщение считается зафиксированным после того как оно записано во все синхронизированные " +
  "реплики но не обязательно сброшено на диск. Брокер хранит последние пять пакетов на раздел.";

describe("normalizeWords / extractProse", () => {
  it("is Unicode-safe and strips punctuation", () => {
    expect(normalizeWords("Apache Kafka, 2-е изд.")).toEqual(["apache", "kafka", "2", "е", "изд"]);
  });

  it("strips fenced code, tables and headings from prose", () => {
    const md = [
      "# Heading",
      "Real prose sentence here.",
      "```",
      "code that must not count as prose",
      "```",
      "| a | b |",
      "|---|---|",
      "> quoted line kept as prose",
    ].join("\n");
    const prose = extractProse(md);
    expect(prose).toContain("Real prose sentence here.");
    expect(prose).toContain("quoted line kept as prose");
    expect(prose).not.toContain("code that must not count");
    expect(prose).not.toContain("Heading");
    expect(prose).not.toContain("| a | b |");
  });
});

describe("shingleOverlaps", () => {
  it("passes clean original prose (no 8-word overlap)", () => {
    const skill = "Reliability is a whole system property you assemble from several independent layers.";
    expect(shingleOverlaps(skill, SOURCE_EN)).toHaveLength(0);
  });

  it("flags one lifted sentence (>= 8-word verbatim run)", () => {
    const skill = "Note: the broker keeps the last five batches per partition and drops any resend.";
    const hits = shingleOverlaps(skill, SOURCE_EN);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.shingle).toContain("keeps the last five batches");
  });

  it("exempts a title/author run via the allowlist (bibliography does not self-trip)", () => {
    // The lifted-looking run is entirely the source title, which is allowlisted.
    const title = "Apache Kafka Streaming Data Processing And Analysis Second Edition Definitive Guide";
    const skill = `See the bibliography: ${title}.`;
    const withoutAllow = shingleOverlaps(skill, title);
    const withAllow = shingleOverlaps(skill, title, { allowlist: [title] });
    expect(withoutAllow.length).toBeGreaterThan(0);
    expect(withAllow).toHaveLength(0);
  });

  it("round-trips RU text (Cyrillic verbatim lift detected)", () => {
    // Lifts the 8-word run "сообщение считается зафиксированным после того как оно записано".
    const skill = "Здесь сообщение считается зафиксированным после того как оно записано во все реплики системы.";
    const hits = shingleOverlaps(skill, SOURCE_RU);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("quoteBudget", () => {
  it("passes short, few quotes", () => {
    const r = quoteBudget('The author calls this "effectively once" delivery.');
    expect(r.exceeded).toBe(false);
    expect(r.totalWords).toBeGreaterThan(0);
  });

  it("flags an over-long single quote (> MAX_WORDS_PER_QUOTE)", () => {
    const long = Array.from({ length: MAX_WORDS_PER_QUOTE + 5 }, (_, i) => `word${i}`).join(" ");
    const r = quoteBudget(`He wrote: "${long}"`);
    expect(r.overLong).toHaveLength(1);
    expect(r.exceeded).toBe(true);
  });

  it("flags exceeding the total-words cap across many small quotes", () => {
    const small = '"one two three four five" ';
    const r = quoteBudget(small.repeat(50)); // 250 quoted words, each span < cap
    expect(r.overLong).toHaveLength(0);
    expect(r.totalWords).toBeGreaterThan(MAX_TOTAL_QUOTED_WORDS);
    expect(r.exceeded).toBe(true);
  });

  it("ignores the YAML frontmatter description (metadata, not a quotation)", () => {
    const longDesc = Array.from({ length: MAX_WORDS_PER_QUOTE + 15 }, (_, i) => `w${i}`).join(" ");
    const md = `---\nname: x\ndescription: "${longDesc}"\n---\n\nBody prose with "a short quote" only.`;
    const r = quoteBudget(md);
    expect(r.overLong).toHaveLength(0);
    expect(r.exceeded).toBe(false);
    expect(extractProse(md)).not.toContain("w0"); // frontmatter never counts as prose either
  });

  it("counts guillemets and blockquotes", () => {
    const r = quoteBudget("«цитата из книги здесь» и обычный текст\n> a blockquote line");
    expect(r.spans.map((s) => s.kind)).toContain("guillemet");
    expect(r.spans.map((s) => s.kind)).toContain("blockquote");
  });
});

describe("compressionCheck", () => {
  it("passes at or above the floor", () => {
    const r = compressionCheck({ skillTokens: 100, sourceTokensRead: 100 * MIN_COMPRESSION_FACTOR });
    expect(r.pass).toBe(true);
    expect(r.ratio).toBe(MIN_COMPRESSION_FACTOR);
  });

  it("fails below the floor", () => {
    const r = compressionCheck({ skillTokens: 100, sourceTokensRead: 500 });
    expect(r.pass).toBe(false);
  });

  it("fails when a per-chapter ratio is below the floor", () => {
    const r = compressionCheck({
      skillTokens: 100,
      sourceTokensRead: 100_000,
      chapters: [{ heading: "ch1", skillTokens: 100, sourceTokens: 500 }],
    });
    expect(r.pass).toBe(false);
    expect(r.belowFloor).toHaveLength(1);
  });
});

describe("headingMatch", () => {
  const chapters = ["Chapter 1 Introduction", "Chapter 2 Producers", "Chapter 3 Brokers"];

  it("passes concept-keyed headings that don't mirror the ToC", () => {
    const skill = ["The reliability stack", "Choosing a delivery semantic", "Exactly once explained"];
    const r = headingMatch(skill, chapters);
    expect(r.pass).toBe(true);
    expect(r.fraction).toBe(0);
  });

  it("fails a verbatim-ToC mirror", () => {
    const r = headingMatch(chapters.slice(), chapters);
    expect(r.pass).toBe(false);
    expect(r.fraction).toBeGreaterThan(MAX_HEADING_MATCH_FRACTION);
  });

  it("exempts an L4/bibliography heading that matches (required to mirror)", () => {
    // The only matching heading is the bibliography one → exempt → fraction over expressive = 0.
    const skill = ["A concept heading", "Bibliography & going deeper (L4)", "Another concept"];
    const chaptersPlus = [...chapters, "Bibliography & going deeper (L4)"];
    const r = headingMatch(skill, chaptersPlus);
    expect(r.considered).toBe(2); // the L4 heading was excluded
    expect(r.matched).toHaveLength(0);
    expect(r.pass).toBe(true);
  });
});

describe("cursorLeak", () => {
  it("detects an encoded content-cursor token", () => {
    const token = Buffer.from(JSON.stringify({ offset: 29290, id: 187, format: "pdf" }), "utf8").toString(
      "base64url",
    );
    const hits = cursorLeak(`Jump here: ${token} for chapter 1.`);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.token).toBe(token);
  });

  it("detects an unfilled {{CHAPTER_CURSOR}} slot", () => {
    expect(cursorLeak("seek {{CHAPTER_CURSOR}} now").length).toBeGreaterThan(0);
  });

  it("ignores ordinary base64-looking text that isn't a cursor", () => {
    expect(cursorLeak("identifiers isbn 9785446122882 and some_long_identifier_name_here")).toHaveLength(0);
  });
});

describe("attributionPresent", () => {
  it("passes a full block", () => {
    const r = attributionPresent("Author: Chip Huyen. ISBN 9781098166304. Consider buying the book.");
    expect(r.pass).toBe(true);
  });

  it("reports the missing pieces", () => {
    const r = attributionPresent("Just some prose with no attribution at all.");
    expect(r.pass).toBe(false);
    expect(r.missing).toContain("isbn");
    expect(r.missing).toContain("buy-the-book line");
  });
});

describe("runLegalGate", () => {
  const cleanSkill = [
    "# Kafka Reliability",
    "<!-- topic aggregate -->",
    "## The reliability stack",
    "Reliability is a whole system property you assemble from independent layers, each with a best source.",
    "## Bibliography & going deeper (L4)",
    "Kafka: The Definitive Guide, 2nd ed — Shapira et al, ISBN 9785446122882. Consider buying the book.",
  ].join("\n");

  const baseInputs = {
    skillText: cleanSkill,
    sources: [{ label: "DG2", text: SOURCE_EN }],
    allowlist: ["Kafka The Definitive Guide", "Shapira"],
    skillHeadings: ["The reliability stack", "Bibliography & going deeper (L4)"],
    detectedChapters: ["Chapter 7 Reliable delivery", "Chapter 8 Exactly once"],
    skillTokens: 30,
    sourceTokensRead: 30 * MIN_COMPRESSION_FACTOR + 10,
  };

  it("a clean skill passes every check", () => {
    const r = runLegalGate(baseInputs);
    expect(r.pass).toBe(true);
    expect(r.findings.map((f) => f.check).sort()).toEqual(
      ["attribution", "compression_floor", "cursors", "heading_match", "quote_budget", "shingle"].sort(),
    );
  });

  it("a lifted sentence flips shingle to FAIL", () => {
    const dirty = baseInputs.skillText + "\nThe broker keeps the last five batches per partition and drops any resend.";
    const r = runLegalGate({ ...baseInputs, skillText: dirty });
    expect(r.pass).toBe(false);
    expect(r.findings.find((f) => f.check === "shingle")!.pass).toBe(false);
  });

  it("a leaked cursor flips cursors to FAIL", () => {
    const token = Buffer.from(JSON.stringify({ offset: 1, id: 2, format: "pdf" }), "utf8").toString("base64url");
    const r = runLegalGate({ ...baseInputs, skillText: baseInputs.skillText + `\nseek ${token}` });
    expect(r.findings.find((f) => f.check === "cursors")!.pass).toBe(false);
    expect(r.pass).toBe(false);
  });
});

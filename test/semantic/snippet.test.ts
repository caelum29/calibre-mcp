// snippetWindow (#243): which part of a chunk a library hit shows. Stopwords and frequent
// generic terms must not beat a rare topic term; the window keeps its width near the chunk end;
// sentence back-off is bounded; every result is a real slice of the chunk.

import { describe, expect, it } from "vitest";
import { SNIPPET_CHARS, snippetWindow, type SnippetWindow } from "../../src/semantic/snippet.js";

/** The snippet text without its "…" cut marker. */
const raw = (w: SnippetWindow) => w.text.replace(/^…/, "");

const NEUTRAL = "Plan the rollout in small steps. "; // 33 chars, no query terms below
const TAIL = NEUTRAL.repeat(14); // keeps the end-of-chunk shift out of the way

describe("snippetWindow", () => {
  it("EN stopwords and a frequent generic term don't beat the rare topic terms", () => {
    const head = "How does the team work? How does the process work when the team does the work? ".repeat(15);
    const raft = "The Raft consensus algorithm keeps replicated logs in sync.";
    const body = head + raft + " " + TAIL;
    const w = snippetWindow(body, "how does the raft consensus work");
    expect(w.start).toBe(head.length);
    expect(w.text).toBe(`…${body.slice(head.length, head.length + SNIPPET_CHARS)}`);
  });

  it("RU stopwords (что/как/это) don't beat the topic term", () => {
    const head = "Что это такое и как это работает? Как это работает на практике, что делать? ".repeat(12);
    const hit = "Консенсус достигается голосованием большинства узлов.";
    const body = head + hit + " " + TAIL;
    const w = snippetWindow(body, "что такое консенсус и как это работает");
    expect(w.start).toBe(head.length);
    expect(raw(w).startsWith(hit)).toBe(true);
  });

  it("a rare term outweighs a term repeated all over the head (systems vs Paxos)", () => {
    const head = "Distributed systems need care. Large systems fail in odd ways. Systems thinking helps. ".repeat(4);
    const paxos = "Paxos is the classic answer to agreement.";
    const body = head + NEUTRAL.repeat(25) + paxos + " " + TAIL;
    const w = snippetWindow(body, "systems Paxos");
    expect(w.start).toBe(body.indexOf(paxos));
  });

  it("near the chunk end shifts back to the earliest sentence that keeps 2/3 of the width", () => {
    const body = NEUTRAL.repeat(40) + "Only the final line names Paxos."; // 1320 + 32 chars
    const w = snippetWindow(body, "Paxos");
    // end - width = 1032 is mid-sentence; the next sentence starts at 33 * 32 = 1056
    expect(w.start).toBe(1056);
    expect(raw(w)).toBe(body.slice(1056));
    expect(raw(w).length).toBe(296);
    expect(w.text).toContain("Paxos");
  });

  it("near the chunk end without sentence breaks keeps the full width from a word start", () => {
    const body = "word ".repeat(300) + "Paxos"; // the term is the last token
    const w = snippetWindow(body, "Paxos");
    expect(w.start).toBe(1185); // 1505 - 320, already a word start
    expect(raw(w).length).toBe(SNIPPET_CHARS);
    expect(raw(w).endsWith("Paxos")).toBe(true);
  });

  it("starts at the term itself when its sentence began more than 160 chars back", () => {
    const body = "Intro. " + "lorem ".repeat(40) + "Paxos keeps going. " + TAIL;
    const w = snippetWindow(body, "Paxos");
    expect(w.start).toBe(7 + 240);
    expect(raw(w).startsWith("Paxos keeps going.")).toBe(true);
  });

  it("a newline counts as a sentence break within the lead", () => {
    const body = "Intro line\n" + "lorem ".repeat(10) + "Paxos keeps going. " + TAIL;
    const w = snippetWindow(body, "Paxos");
    expect(w.start).toBe(11);
    expect(raw(w).startsWith("lorem lorem")).toBe(true);
  });

  it("a term at index 0 keeps the head, without a cut marker", () => {
    const body = "Paxos made simple. " + TAIL + TAIL;
    const w = snippetWindow(body, "Paxos");
    expect(w).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("an all-stopword query falls back to the head", () => {
    const body = "Raft. " + TAIL + "how does the thing work";
    expect(snippetWindow(body, "how does the")).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("every window is a real slice of the chunk at its start", () => {
    const bodies = [
      "changes how teams own their systems. " + NEUTRAL.repeat(20),
      NEUTRAL.repeat(40) + "Only the final line names Paxos.",
      "word ".repeat(300) + "Paxos",
      "Intro. " + "lorem ".repeat(40) + "Paxos keeps going. " + TAIL,
      "Что это такое? ".repeat(30) + "Консенсус узлов. " + TAIL,
    ];
    for (const body of bodies) {
      for (const q of ["Paxos", "консенсус", "lorem Paxos", "nothing here"]) {
        const w = snippetWindow(body, q);
        expect(body.slice(w.start).startsWith(raw(w)), `${q} @${w.start}`).toBe(true);
        expect(w.text.startsWith("…")).toBe(w.start > 0);
      }
    }
  });
});

// #325 (from #323): very long queries, a surrogate pair cut at a window edge, mixed EN/RU.
describe("snippetWindow edge cases (#325)", () => {
  const ASTRAL = "𝔸"; // U+1D538: one char, two UTF-16 units (a surrogate pair)
  const FILLER = "Plain filler words about nothing in particular. "; // 48 chars, no query terms

  it("a very long query (2,000 words) still opens at its one matching topic term", () => {
    const query = Array.from({ length: 2000 }, (_, i) => `zzterm${i}`).join(" ") + " Paxos";
    const body = FILLER.repeat(10) + "Paxos is the classic answer. " + TAIL;
    const w = snippetWindow(body, query);
    expect(w.start).toBe(480);
    expect(w.text).toBe(`…${body.slice(480, 480 + SNIPPET_CHARS)}`);
  });

  it("does not end on a lone high surrogate: the cut pair is dropped whole", () => {
    // window opens at Paxos (480); 320 units later is the middle of an astral pair
    const body = FILLER.repeat(10) + "Paxos xy " + ASTRAL.repeat(300);
    const w = snippetWindow(body, "Paxos");
    expect(w.start).toBe(480);
    expect(w.text).toBe(`…${body.slice(480, 480 + SNIPPET_CHARS - 1)}`);
    expect(w.text.isWellFormed()).toBe(true);
  });

  it("does not start on a lone low surrogate: the start moves past the cut pair", () => {
    // no whitespace before the term → the end-of-chunk shift lands on end - width = 289, mid-pair
    const body = ASTRAL.repeat(300) + ",Paxos xy";
    const w = snippetWindow(body, "Paxos");
    expect(w.start).toBe(290);
    expect(w.text).toBe(`…${body.slice(290)}`);
    expect(w.text.isWellFormed()).toBe(true);
  });

  it("the head fallback does not end on a lone high surrogate either", () => {
    const body = "x" + ASTRAL.repeat(300); // unit 319 is a high surrogate
    const w = snippetWindow(body, "nothing here");
    expect(w).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS - 1) });
    expect(w.text.isWellFormed()).toBe(true);
  });

  it("a mixed EN/RU query opens at the rare RU term, matched across inflection", () => {
    // "Raft" is everywhere in the head (generic); "консенсуса" occurs once (rare) and must win
    const head = "Raft notes. Raft logs. Raft again here. ".repeat(10);
    const hit = "Для консенсуса нужно большинство голосов.";
    const body = head + hit + " " + TAIL;
    const w = snippetWindow(body, "Raft консенсус");
    expect(w.start).toBe(head.length);
    expect(raw(w).startsWith(hit)).toBe(true);
  });
});

// #657: the head fallback (no topic term in the query or in the chunk) opens at a sentence start
// when the chunk head is mid-sentence (first non-space char lowercase), within 160 chars.
describe("snippetWindow head fallback opens at a sentence start (#657)", () => {
  const EN_MID = "changes how teams own their systems. "; // 37 chars, lowercase head
  const RU_MID = "ется голосованием большинства узлов. "; // 37 chars, Cyrillic lowercase head
  const RU_NEXT = "Каждый узел хранит копию журнала. "; // capitalised next sentence
  const NOTHING = "nothing here"; // no query term in any body below
  const STOP_ONLY = "how does the"; // no topic term at all

  it("EN: a mid-sentence head opens at the next sentence, with the cut marker", () => {
    const body = EN_MID + NEUTRAL.repeat(20);
    expect(snippetWindow(body, NOTHING)).toEqual({
      start: 37,
      text: "…" + body.slice(37, 37 + SNIPPET_CHARS),
    });
  });

  it("EN: the same move applies when the query has no topic term (stopwords only)", () => {
    const body = EN_MID + NEUTRAL.repeat(20);
    expect(snippetWindow(body, STOP_ONLY)).toEqual({
      start: 37,
      text: "…" + body.slice(37, 37 + SNIPPET_CHARS),
    });
  });

  it("RU: a Cyrillic lowercase head opens at the next sentence", () => {
    const body = RU_MID + RU_NEXT.repeat(15);
    const w = snippetWindow(body, "консенсус");
    expect(w).toEqual({ start: 37, text: "…" + body.slice(37, 37 + SNIPPET_CHARS) });
    expect(w.text.startsWith("…Каждый узел хранит копию журнала.")).toBe(true);
  });

  it("a newline counts as a sentence start for the head", () => {
    const body = "the end of a wrapped line\n" + NEUTRAL.repeat(20); // newline at 25
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 26, text: "…" + body.slice(26, 26 + SNIPPET_CHARS) });
  });

  it("leading whitespace before a lowercase head does not stop the move", () => {
    const body = "  " + EN_MID + NEUTRAL.repeat(20); // sentence start at 39
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 39, text: "…" + body.slice(39, 39 + SNIPPET_CHARS) });
  });

  it("a capitalised head keeps the head", () => {
    const body = NEUTRAL.repeat(20);
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("a head that starts with a digit keeps the head", () => {
    const body = "3 replicas keep the log safe. " + NEUTRAL.repeat(20);
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("a head that starts with punctuation (>> prompt) keeps the head", () => {
    const body = ">> print(x) prints the value. " + NEUTRAL.repeat(20);
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("a form feed before a capital keeps the head", () => {
    const body = "\fChapter two opens here. " + NEUTRAL.repeat(20);
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("code and decimals (a.b(), 3.14) are not sentence ends: no start within 160 keeps the head", () => {
    const code = "obj.call(a.b(), 3.14) && x.y.z(); "; // 34 chars, no ". " or newline
    const body = code.repeat(6) + "Then it ends. " + NEUTRAL.repeat(10); // first break at 204+14
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body.slice(0, SNIPPET_CHARS) });
  });

  it("an abbreviation followed by a space counts as a sentence end (the anchored-window rule)", () => {
    const body = "see e.g. the log. " + NEUTRAL.repeat(20); // "e.g. " ends at 9
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 9, text: "…" + body.slice(9, 9 + SNIPPET_CHARS) });
  });

  it("a sentence start exactly at 160 moves the head; one at 161 keeps it", () => {
    const at160 = "x".repeat(158) + ". " + NEUTRAL.repeat(15);
    expect(snippetWindow(at160, NOTHING)).toEqual({
      start: 160,
      text: "…" + at160.slice(160, 160 + SNIPPET_CHARS),
    });
    const at161 = "x".repeat(159) + ". " + NEUTRAL.repeat(15);
    expect(snippetWindow(at161, NOTHING)).toEqual({ start: 0, text: at161.slice(0, SNIPPET_CHARS) });
  });

  it("a lowercase body that fits in one snippet is returned whole from 0", () => {
    const body = EN_MID + NEUTRAL.repeat(8); // 37 + 264 = 301 chars
    expect(snippetWindow(body, NOTHING)).toEqual({ start: 0, text: body });
  });

  it("keeps the head when the new start leaves less than two thirds of the width", () => {
    // 2/3 of 320 = 213.3: a start at 150 with 214 chars after it moves, with 213 it stays at 0
    const lead = "x".repeat(148) + ". "; // sentence start at 150
    const enough = lead + "Y".repeat(214);
    expect(snippetWindow(enough, NOTHING)).toEqual({ start: 150, text: "…" + enough.slice(150) });
    const tooFew = lead + "Y".repeat(213);
    expect(snippetWindow(tooFew, NOTHING)).toEqual({ start: 0, text: tooFew.slice(0, SNIPPET_CHARS) });
  });

  it("a moved head whose cut lands inside a surrogate pair ends one unit early", () => {
    const ASTRAL = "𝔸"; // two UTF-16 units
    const body = "changes it. x" + ASTRAL.repeat(300); // start 12; unit 12 + 319 = 331 is a high half
    const w = snippetWindow(body, NOTHING);
    expect(w).toEqual({ start: 12, text: "…" + body.slice(12, 12 + SNIPPET_CHARS - 1) });
    expect(w.text.isWellFormed()).toBe(true);
  });
});

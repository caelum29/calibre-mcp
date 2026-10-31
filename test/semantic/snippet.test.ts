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

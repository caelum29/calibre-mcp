# Study note template

Reproduce this structure exactly. `{...}` are placeholders; comments in
(parentheses) are instructions to the generating agent — never emit them.

```markdown
---
title: "{Topic} — {Book title}, {chapter ref}"
book_id: {calibre id}
book_uuid: "{uuid}"
source: "{Author}, «{Book title}», {chapter/pages}"
cursors:
  - chapter: "{chapter title}"
    cursor: "{cursor value from calibre_get_content structure=true}"
created: {YYYY-MM-DD}
last_reviewed: null
next_review: {YYYY-MM-DD, created + 1 day}
depth: {quick|deep}
reader_level: {new|adjacent|refreshing}
goal: "{interview|deep-study|reference}"
tags: [study-note, {topic-slug}]
---

# {Тема}

## TL;DR
(3–5 sentences, own words, no book phrasing. The single takeaway a reader
should retain if they remember nothing else.)

## Що треба знати перед цим
(2–4 bullet prerequisites. Each: concept — one-line why it matters here.
Link to other study notes with [[wikilinks]] if they exist.)

## {Core concept 1}
> ❓ Перш ніж читати далі: {guiding question 1}? {guiding question 2}?

**Що це.** (Definition in own words, 2–4 sentences.)

**Навіщо існує.** (What problem it solves / what breaks without it. The
"why" is retained better than the "what" — never skip it.)

**Приклад.** (Fresh example from the reader's domain. For technical books —
a short runnable code snippet written from scratch, never copied.)

**Типова помилка.** (The most common misconception or production mistake
about this concept, and the correct mental model.)

(Optional, only if the concept has structure prose conveys worse:)
```mermaid
{diagram per SKILL.md mermaid rules}
```

(Optional, deep mode, only when scope:library search found real divergence:)
> 📚 **Де джерела розходяться:** {book B} пояснює це через {...}, тоді як
> {source book} робить акцент на {...}. ({one-line practical implication})

> 💡 У review-сесії попроси: "покажи інтерактивно {concept}"

(Repeat the section per concept. One idea per section. scaffold mode:
replace the four blocks above with the guiding questions +
`_Твоє пояснення:_` + `_Приклад зі свого досвіду:_` + source pointer.)

## Як це все пов'язано
(3–6 sentences tying the concepts into one causal story, own words.
Plus [[wikilinks]] to related notes/topics for the knowledge graph.)

## Self-test
(5–10 questions, ordered easy → hard. Mix: definition recall, "why",
applied "what happens if", one transfer question to the reader's domain.)

1. {Question}?
   <details><summary>Відповідь</summary>
   {Answer in 1–3 sentences.}
   📖 {chapter title}, cursor: `{cursor}`
   </details>

## Мої нотатки
(Emit exactly this, leave empty for the human:)
_Що не зрозумів / до чого повернутись:_

## Anki
(One fact per card. Semicolon-separated, importable as-is.)
```text
{Question 1};{Short answer 1}
{Question 2};{Short answer 2}
```

## Review log
(Emit the empty section; review mode appends lines:
`- {YYYY-MM-DD} — {n}/{m}, слабкі місця: {concepts}`)
```

## Length calibration

| Depth | Concepts | Self-test | Anki | Diagrams |
|-------|----------|-----------|------|----------|
| quick | 3–5      | 5         | 5–8  | 0        |
| deep  | 5–9      | 8–10      | 10–15| 0–3 total|

Total note body must stay ≤ 10–15% of the source chapter text length.
When in doubt — cut. A study note that is too short sends the reader back
to the book (good); one that is too long replaces it (bad).

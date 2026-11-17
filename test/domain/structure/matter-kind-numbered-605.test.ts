// #605 review round 2: short numbered lines alone are not a contents list. A preface that walks
// the reader through numbered setup steps stays weak (reranked like prose); a contents block still
// needs page numbers, a chapter keyword or a contents heading above the run.

import { describe, expect, it } from "vitest";
import { isStrongMatter } from "../../../src/domain/structure/matter-kind.js";

const PREFACE_WITH_STEPS = [
  "Preface",
  "",
  "Every example in this book runs on an ordinary laptop. Before you start, set up a",
  "working environment the way we describe below, so that each listing behaves exactly",
  "as printed and the exercises at the end of every chapter give the expected answers.",
  "",
  "1. Install Node",
  "2. Configure the project",
  "3. Run the tests",
  "4. Open the docs",
  "5. Read chapter one",
].join("\n");

// Russian: a foreword, then a contents block whose entries carry the chapter keyword "Глава".
const RU_CONTENTS = [
  "Предисловие",
  "Эта книга выросла из курса лекций, который автор много лет читал инженерам, впервые",
  "столкнувшимся с поисковыми системами, и потому начинается с самых простых примеров,",
  "постепенно переходя к устройству индексов и к оценке качества ранжирования.",
  "Содержание",
  "Глава 1. Токены и термины",
  "Глава 2. Оценка по BM25",
  "Глава 3. Обучение ранжированию",
  "Глава 4. Измерение качества",
].join("\n");

// Ukrainian: a contents heading over bare titles (no page numbers, no keyword), after a foreword.
const UK_CONTENTS = [
  "Передмова",
  "Ця книжка виросла з курсу лекцій, який автор багато років читав інженерам, що вперше",
  "зіткнулися з пошуковими системами, тому вона починається з найпростіших прикладів і",
  "поступово переходить до будови індексів та до оцінювання якості ранжування.",
  "Зміст",
  "Токени й терміни",
  "Оцінювання за BM25",
  "Навчання ранжуванню",
  "Вимірювання якості",
].join("\n");

describe("numbered steps are not a contents block (#605 review round 2)", () => {
  it("a preface with five numbered setup steps and a prose paragraph stays weak", () => {
    expect(isStrongMatter("front", PREFACE_WITH_STEPS)).toBe(false);
  });

  it("a Russian contents block of 'Глава N.' entries after a foreword is strong", () => {
    expect(isStrongMatter("front", RU_CONTENTS)).toBe(true);
  });

  it("a Ukrainian 'Зміст' heading over bare titles after a foreword is strong", () => {
    expect(isStrongMatter("front", UK_CONTENTS)).toBe(true);
  });
});

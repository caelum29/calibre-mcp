// Russian language pack: Snowball russian stemmer (snowball-stemmers) + snippet stop words.
// Also the fallback for every other Cyrillic-script language until a pack of its own exists
// (ADR-0032 item 1).

import snowball from "snowball-stemmers";
import type { LanguagePack } from "./pack.js";

const stemmer = snowball.newStemmer("russian");

// ё and е are one letter to most writers, so both spellings must share a stem and a stop word.
const yoToYe = (w: string): string => w.replaceAll("ё", "е");

/** Russian: the default pack for Cyrillic-script tokens. */
export const ru: LanguagePack = {
  id: "ru",
  version: 1,
  script: "Cyrillic",
  distinctiveLetters: "ыэъё",
  stopwords: new Set(
    (
      "и в во на с со к ко у о об от до по за из изо для без над под при про через между а но или либо " +
      "да нет не ни же ли бы то это этот эта эти тот та те так как что чтобы кто где когда зачем почему " +
      "какой какая какие чем там тут здесь уже еще ещё был была были было быть есть будет он она оно они " +
      "мы вы ты я его ее её их им ему ей нас вас все всё весь вся всех свой своя свои также тоже очень " +
      "можно нужно надо"
    )
      .split(" ")
      .map(yoToYe),
  ),
  stem: (w) => stemmer.stem(yoToYe(w)),
};

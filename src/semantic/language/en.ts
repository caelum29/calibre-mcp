// English language pack: Snowball english stemmer (snowball-stemmers) + snippet stop words.
// Also the fallback for every other Latin-script language (ADR-0032 item 1).

import snowball from "snowball-stemmers";
import type { LanguagePack } from "./pack.js";

const stemmer = snowball.newStemmer("english");

/** English: the default pack for Latin-script tokens. */
export const en: LanguagePack = {
  id: "en",
  version: 1,
  script: "Latin",
  distinctiveLetters: "",
  stopwords: new Set(
    (
      "a an the and or but nor not no so if then than as at by for from in into of off on onto out " +
      "over to up with about after before under between through during without within is am are was " +
      "were be been being do does did doing done have has had having can could will would shall should " +
      "may might must how what when where which who whom whose why this that these those there here it " +
      "its they them their we our you your he she his her i me my all any some each every both few more " +
      "most other such only own same too very just also use used using via vs"
    ).split(" "),
  ),
  stem: (w) => stemmer.stem(w),
};

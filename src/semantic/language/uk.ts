// Ukrainian language pack: the Snowball 3.2.0 Ukrainian stemmer (vendored, generated from
// algorithms/ukrainian.sbl) + snippet stop words. Before it, Ukrainian went through the Russian
// stemmer and inflections like функція / функції never shared a stem (#654).

import UkrainianStemmer from "./snowball/ukrainian-stemmer.js";
import type { LanguagePack } from "./pack.js";

// the vendored stemmer is @ts-nocheck JS, so pin the one method we call
const stemmer: { stemWord(word: string): string } = new UkrainianStemmer();

/** Ukrainian: picked by book language or by its distinctive letters, never the Cyrillic default. */
export const uk: LanguagePack = {
  id: "uk",
  version: 1,
  script: "Cyrillic",
  distinctiveLetters: "іїєґ",
  stopwords: new Set(
    (
      "і й та або чи але а що щоб як коли де куди хто який яка яке які це цей ця ці той те ті там тут " +
      "вже ще не ні так також теж дуже можна треба потрібно був була було були бути є буде він вона " +
      "воно вони ми ви ти я його її їх їм йому їй нас вас все всі весь вся свій своя свої в у на з із " +
      "зі до від по за для без над під при про через між"
    ).split(" "),
  ),
  stem: (w) => stemmer.stemWord(w),
};

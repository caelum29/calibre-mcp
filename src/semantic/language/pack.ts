// Language pack contract (ADR-0032, #654): one language's rules for the keyword half of hybrid
// search. Packs are compiled in; there is no runtime plugin loading. A pack holds the stemmer and
// the snippet stop words only — figure labels and heading words stay in src/domain/.

/** Writing systems the keyword half routes by. A token's script picks its candidate packs. */
export type Script = "Latin" | "Cyrillic";

/** One language's stemmer, stop words and detection hints for the keyword half. */
export interface LanguagePack {
  /** Short language code, e.g. `en`; stored as `books.lang`. */
  readonly id: string;
  /** Bumped whenever `stem` output changes; part of the stem version (`meta.stem_version`). */
  readonly version: number;
  /** The script this language's words are written in. */
  readonly script: Script;
  /** Letters only this language uses within its script; detection and routing evidence. */
  readonly distinctiveLetters: string;
  /** Function words with no topic, lowercased with ё→е; snippet term picking skips them. */
  readonly stopwords: ReadonlySet<string>;
  /** Stem one lowercased word token of this pack's script. */
  readonly stem: (lowerToken: string) => string;
}

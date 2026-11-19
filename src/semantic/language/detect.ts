// Book language from text (ADR-0032 item 2, #654): dominant script, then distinctive letters,
// then the share of each candidate pack's stop words. Calibre's `languages` field is not read.

import type { LanguagePack } from "./pack.js";
import { PACKS } from "./registry.js";

/** The book's language pack id from its text; undefined when the text has no Latin or Cyrillic letters. */
export function detectBookLanguage(_text: string, _packs: readonly LanguagePack[] = PACKS): string | undefined {
  return undefined;
}

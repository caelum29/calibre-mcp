// Language-pack registry (ADR-0032, #654): the compiled-in packs and token → pack routing for the
// keyword half. Index side: a token goes to its book language's pack for its script, unless it
// carries another pack's distinctive letters. Query side: decided once for the whole query.
// Every router takes the pack list as a parameter so tests can route over packs of their own.

import { en } from "./en.js";
import type { LanguagePack, Script } from "./pack.js";
import { ru } from "./ru.js";

/** Every compiled-in pack. The first pack of a script is that script's default. */
export const PACKS: readonly LanguagePack[] = [en, ru];

// Checked in this order: a mixed-script token with any Cyrillic letter counts as Cyrillic.
const SCRIPT_TESTS: ReadonlyArray<readonly [Script, RegExp]> = [
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Latin", /\p{Script=Latin}/u],
];

function scriptOf(token: string): Script | undefined {
  return SCRIPT_TESTS.find(([, re]) => re.test(token))?.[0];
}

/**
 * The pack that stems `token` on the index side: its script's default pack; undefined for digits
 * or other scripts.
 */
export function packForToken(
  token: string,
  _bookLang?: string,
  packs: readonly LanguagePack[] = PACKS,
): LanguagePack | undefined {
  const script = scriptOf(token);
  return script === undefined ? undefined : packs.find((p) => p.script === script);
}

/**
 * Query-side routing for a whole query: a function giving each token its packs (one stem per
 * pack, OR-ed). Empty for digits or other scripts.
 */
export function queryPacks(
  tokens: readonly string[],
  _libraryLangs?: ReadonlySet<string>,
  packs: readonly LanguagePack[] = PACKS,
): (token: string) => readonly LanguagePack[] {
  void tokens;
  return (token) => {
    const p = packForToken(token, undefined, packs);
    return p ? [p] : [];
  };
}

/** The stem version of a pack set, e.g. `en:1|ru:1`: recorded with the stems an index holds. */
export function stemVersion(_packs: readonly LanguagePack[] = PACKS): string {
  return "";
}

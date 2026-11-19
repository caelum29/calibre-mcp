// Language-pack registry (ADR-0032, #654): the compiled-in packs and token → pack routing for the
// keyword half. Today a token goes to its script's default pack (Cyrillic → ru, Latin → en);
// book- and query-language routing arrives with the Ukrainian pack (#654 L2).

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

/** The pack that stems `token`: its script's default pack; undefined for digits or other scripts. */
export function packForToken(token: string): LanguagePack | undefined {
  const script = scriptOf(token);
  return script === undefined ? undefined : PACKS.find((p) => p.script === script);
}

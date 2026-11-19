// Language-pack registry (ADR-0032, #654): the compiled-in packs and token → pack routing for the
// keyword half. Index side: a token goes to its book language's pack for its script, unless it
// carries another pack's distinctive letters. Query side: decided for the whole query, over the
// packs the library's books were stemmed with.
// Every router takes the pack list as a parameter so tests can route over packs of their own.

import { en } from "./en.js";
import type { LanguagePack, Script } from "./pack.js";
import { ru } from "./ru.js";
import { uk } from "./uk.js";

/**
 * Every compiled-in pack. The first pack of a script is that script's default, so Cyrillic text of
 * any other language keeps today's Russian stemming (ADR-0032 item 1).
 */
export const PACKS: readonly LanguagePack[] = [en, ru, uk];

// Checked in this order: a mixed-script token with any Cyrillic letter counts as Cyrillic.
const SCRIPT_TESTS: ReadonlyArray<readonly [Script, RegExp]> = [
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Latin", /\p{Script=Latin}/u],
];

function scriptOf(token: string): Script | undefined {
  return SCRIPT_TESTS.find(([, re]) => re.test(token))?.[0];
}

/** The packs of `script`, default first. */
function packsOf(script: Script, packs: readonly LanguagePack[]): LanguagePack[] {
  return packs.filter((p) => p.script === script);
}

/** The first pack whose distinctive letters `token` holds (checked case-insensitively). */
function evidencePack(token: string, candidates: readonly LanguagePack[]): LanguagePack | undefined {
  const lower = token.toLowerCase();
  return candidates.find((p) => [...p.distinctiveLetters].some((ch) => lower.includes(ch)));
}

/**
 * The pack that stems `token` on the index side: a pack whose distinctive letters it holds (a
 * Russian quote in a Ukrainian book stems as Russian), else the book language's pack for its
 * script, else the script's default pack. Undefined for digits or other scripts.
 */
export function packForToken(
  token: string,
  bookLang?: string,
  packs: readonly LanguagePack[] = PACKS,
): LanguagePack | undefined {
  const script = scriptOf(token);
  if (script === undefined) return undefined;
  const candidates = packsOf(script, packs);
  return evidencePack(token, candidates) ?? candidates.find((p) => p.id === bookLang) ?? candidates[0];
}

/**
 * The packs a library's books may have stemmed `script`'s words with: the pack of every book
 * language of that script, plus the script's default when a book has no detected language
 * (`undefined`) or a language of another script — such a book stems this script's words with the
 * default (a Russian book detected as `en` for its code). Without library languages, the default.
 */
function candidatePacks(
  script: Script,
  libraryLangs: ReadonlySet<string | undefined> | undefined,
  packs: readonly LanguagePack[],
): LanguagePack[] {
  const all = packsOf(script, packs);
  if (!libraryLangs || libraryLangs.size === 0) return all.slice(0, 1);
  const needsDefault = [...libraryLangs].some((id) => !all.some((p) => p.id === id));
  return all.filter((p, i) => libraryLangs.has(p.id) || (i === 0 && needsDefault));
}

/**
 * Query-side routing, decided for the whole query: a function giving each token its packs, one
 * stem per pack, OR-ed. A token with a pack's distinctive letters always gets that pack, as the
 * index stems it (item 3). Per script, when one pack has such evidence and is a candidate in the
 * library, it takes every token of that script; otherwise a token without evidence gets every
 * candidate pack (`candidatePacks`, from `books.lang`). Empty for digits or other scripts.
 */
export function queryPacks(
  tokens: readonly string[],
  libraryLangs?: ReadonlySet<string | undefined>,
  packs: readonly LanguagePack[] = PACKS,
): (token: string) => readonly LanguagePack[] {
  const route = new Map<Script, readonly LanguagePack[]>();
  const evidence = new Map<Script, Set<LanguagePack>>();
  for (const t of tokens) {
    const script = scriptOf(t);
    const p = script && evidencePack(t, packsOf(script, packs));
    if (script && p) evidence.set(script, (evidence.get(script) ?? new Set()).add(p));
  }
  for (const [script] of SCRIPT_TESTS) {
    const candidates = candidatePacks(script, libraryLangs, packs);
    const seen = [...(evidence.get(script) ?? [])];
    // The whole-query switch only to a pack the library's books were stemmed with (#716 review).
    const only = seen.length === 1 && candidates.includes(seen[0]!) ? seen[0] : undefined;
    route.set(script, only ? [only] : candidates);
  }
  return (token) => {
    const script = scriptOf(token);
    if (script === undefined) return [];
    const own = evidencePack(token, packsOf(script, packs));
    return own ? [own] : (route.get(script) ?? []);
  };
}

/** The stem version of a pack set, e.g. `en:1|ru:1`: recorded with the stems an index holds. */
export function stemVersion(packs: readonly LanguagePack[] = PACKS): string {
  return packs.map((p) => `${p.id}:${p.version}`).join("|");
}

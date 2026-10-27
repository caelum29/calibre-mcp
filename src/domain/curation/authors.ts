// Author-name hygiene for metadata recovery + quality checks (#201). Providers and importers
// hand us "Last, First" names, several people glued into one string, or junk like a year.
// Pure, SDK-free, clean-room heuristics from observed library data — not a port of Calibre code.

/** Why an author value looks wrong; `undefined` from authorSuspectReason means it looks fine. */
export type AuthorSuspectReason = "comma" | "semicolon" | "no-letters";

/** Collapse runs of whitespace and trim. */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Turn one raw author string into clean "First Last" names:
 *  - "Graham, Paul" → ["Paul Graham"] (comma parts pair up as Last, First)
 *  - "Petre, Marian,Hoek, André van der" → ["Marian Petre", "André van der Hoek"]
 *  - "Ian Miell, Aidan Hobson Sayers" → two people (every comma part is a full name)
 * An odd mix that fits neither reading is returned unchanged rather than guessed at.
 */
export function splitAuthorString(raw: string): string[] {
  const s = collapseWs(raw).replace(/;+$/, "").trim();
  if (!s) return [];
  const parts = s.split(",").map(collapseWs).filter(Boolean);
  if (parts.length === 1) return parts;
  // every part has a space → a list of full names ("Jez Humble, Joanne Molesky")
  if (parts.every((p) => p.includes(" "))) return parts;
  if (parts.length % 2 !== 0) return [s];
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 2) names.push(`${parts[i + 1]} ${parts[i]}`);
  return names;
}

/** Split/flip every entry via {@link splitAuthorString}, dropping case-insensitive duplicates. */
export function normalizeAuthors(authors: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of authors.flatMap(splitAuthorString)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Why a stored author value is suspect, or `undefined` if it looks like a real name. Calibre
 * keeps one person per author entry, so a comma means a glued list or an unflipped
 * "Last, First"; a year/number came from the filename; a trailing ";" is importer residue.
 */
export function authorSuspectReason(name: string): AuthorSuspectReason | undefined {
  if (!/\p{L}/u.test(name)) return "no-letters";
  if (name.includes(";")) return "semicolon";
  if (name.includes(",")) return "comma";
  return undefined;
}

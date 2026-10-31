// Offline fallback for resolving a library display name to its Content Server libId.
// Calibre derives the libId by replacing spaces with underscores ("Programming Books"
// → "Programming_Books"). This is a FALLBACK ONLY — prefer the authoritative
// library_map from /ajax/library-info (a real underscore in a name breaks this).

/** Fallback display-name to libId mapping (spaces to underscores); prefer the server's library_map. */
export function toLibId(displayName: string): string {
  return displayName.replace(/ /g, "_");
}

/**
 * A Content Server library ID ("Programming_Books"), as opposed to a display name
 * ("Programming Books"). `calibredb --with-library` 404s on the latter (D-008), so the
 * type makes the resolve step compile-checked.
 */
export type LibId = string & { readonly __brand: "LibId" };

/**
 * Mint a {@link LibId}. Only `ContentServerClient.resolveLibraryId` may call this in `src/`
 * (guarded in test/architecture.test.ts); tests mint fixtures with it.
 */
export function asLibId(id: string): LibId {
  return id as LibId;
}

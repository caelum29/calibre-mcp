// The branded Content Server libId. Only ContentServerClient.resolveLibraryId mints one, from the
// authoritative library_map (/ajax/library-info) — never by guessing from a display name (#438).

/**
 * A Content Server library ID ("My_Books"), as opposed to a display name
 * ("My Books"). `calibredb --with-library` 404s on the latter (D-008), so the
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

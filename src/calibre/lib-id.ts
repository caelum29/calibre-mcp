// Offline fallback for resolving a library display name to its Content Server libId.
// Calibre derives the libId by replacing spaces with underscores ("Programming Books"
// → "Programming_Books"). This is a FALLBACK ONLY — prefer the authoritative
// library_map from /ajax/library-info (a real underscore in a name breaks this).

export function toLibId(displayName: string): string {
  return displayName.replace(/ /g, "_");
}

// Domain entities for a Calibre book. Pure, SDK-free, dependency-free — the shapes
// every client returns and every handler consumes (Clean Architecture core).

/** Identifier scheme → value (e.g. `{ isbn: "9780…", google: "…" }`). */
export interface Identifiers {
  isbn?: string;
  [scheme: string]: string | undefined;
}

/** A format string as Calibre reports it, lower-cased (e.g. "pdf", "epub"). */
export type BookFormat = string;

/** Full metadata for one book, normalized from the Content Server `/ajax/book` shape. */
export interface Book {
  id: number;
  uuid: string;
  title: string;
  authors: string[];
  authorSort?: string;
  /** Free-text, HTML/markup, attacker-influenceable → must be fenced on output (DESIGN §5). */
  comments?: string;
  identifiers: Identifiers;
  formats: BookFormat[];
  series?: string;
  seriesIndex?: number;
  tags: string[];
  /** ISO-639 language codes. */
  languages: string[];
  publisher?: string;
  /** ISO date string as returned by `/ajax`. */
  pubdate?: string;
  pages?: number;
  rating?: number;
  coverUrl?: string;
  lastModified?: string;
}

/**
 * Lightweight payload for building a `resource_link` without shipping the full record
 * (the context-window win at ~801 books, DESIGN §2).
 */
export interface BookSummary {
  id: number;
  title: string;
  authors: string[];
  /** Match snippet from fts/semantic search; fence if present (untrusted text). */
  snippet?: string;
}

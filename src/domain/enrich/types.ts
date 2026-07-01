// Domain shapes for metadata recovery. A ProviderHit is one normalized candidate record
// from an external source (Open Library / Google Books); a Proposal is the diff we surface
// to the user + a ready-to-apply `changes` object shaped for calibre_update_book. Pure,
// SDK-free, I/O-free — the provider HTTP clients live in src/enrich/ and map into these.

import type { ChangeValue } from "../../calibre/metadata-fields.js";

/** A normalized metadata candidate from one external provider. */
export interface ProviderHit {
  source: "openlibrary" | "googlebooks";
  title?: string;
  authors?: string[];
  publisher?: string;
  /** Year or ISO-ish date string as the provider reports it. */
  pubdate?: string;
  series?: string;
  /** Best ISBN (13 preferred) this hit carries, checksum-valid. */
  isbn?: string;
  /** 0..1 — ISBN lookups score high, title/author searches are fuzzy (heuristic). */
  confidence: number;
}

/** Why a field is being proposed (drives the preview wording; never a clobber of good data). */
export type ProposeReason = "missing" | "weak";

/** One field the recovery would fill, with provenance. */
export interface ProposedField {
  /** calibre_update_book field name (title, authors, publisher, pubdate, series, identifiers). */
  field: string;
  current?: unknown;
  proposed: ChangeValue;
  source: string;
  confidence: number;
  reason: ProposeReason;
}

/** The full recovery preview: human-facing fields + the machine-applyable `changes`. */
export interface Proposal {
  fields: ProposedField[];
  /** Subset shaped for calibre_update_book's `changes` input (allowlisted fields only). */
  changes: Record<string, ChangeValue>;
}

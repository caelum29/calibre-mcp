// The metadata-provider contract. Each provider (Open Library, Google Books) maps its API
// onto ProviderHit[] and RETURNS-NOT-THROWS at this boundary: a dead/rate-limited provider
// yields [] so the recovery chain degrades to the next source instead of failing the tool.

import type { ProviderHit } from "../domain/enrich/types.js";

export interface Provider {
  name: ProviderHit["source"];
  /** Exact ISBN lookup — high-confidence hits. Returns [] on miss or transport failure. */
  lookupByIsbn(isbn: string): Promise<ProviderHit[]>;
  /** Fuzzy title(+author) search — lower-confidence hits. Returns [] on miss or failure. */
  searchByTitleAuthor(title: string, author?: string): Promise<ProviderHit[]>;
}

// Google Books provider (www.googleapis.com/books/v1, keyless — subject to anonymous rate
// limits). Maps the volumes endpoint onto ProviderHit[]:
//   - q=isbn:x                       → exact ISBN lookup (high confidence)
//   - q=intitle:t[+inauthor:a]       → fuzzy title/author search (low confidence)
// Response shape per developers.google.com/books/docs/v1. Returns-not-throws.

import type { ProviderHit } from "../domain/enrich/types.js";
import { isValidIsbn } from "../domain/curation/isbn.js";
import { fetchJson, type FetchJson } from "./http.js";
import type { Provider } from "./provider.js";

const BASE = "https://www.googleapis.com/books/v1/volumes";
const ISBN_HIT = 0.95;
const SEARCH_HIT = 0.6;

interface VolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  industryIdentifiers?: { type?: string; identifier?: string }[];
}
interface Volumes {
  items?: { volumeInfo?: VolumeInfo }[];
}

/** Best checksum-valid ISBN from industryIdentifiers, ISBN_13 preferred. */
function bestIsbn(ids: VolumeInfo["industryIdentifiers"]): string | undefined {
  const values = (ids ?? []).map((i) => i.identifier ?? "").filter(Boolean);
  return values.find((v) => v.length === 13 && isValidIsbn(v)) ?? values.find((v) => isValidIsbn(v));
}

function mapVolume(info: VolumeInfo, confidence: number, fallbackIsbn?: string): ProviderHit {
  const title = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
  return {
    source: "googlebooks",
    title,
    authors: info.authors,
    publisher: info.publisher,
    pubdate: info.publishedDate,
    isbn: bestIsbn(info.industryIdentifiers) ?? fallbackIsbn,
    confidence,
  };
}

async function query(fj: FetchJson, q: string): Promise<Volumes> {
  const url = new URL(BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "5");
  return fj<Volumes>(url.toString());
}

export function createGoogleBooks(fj: FetchJson = fetchJson): Provider {
  return {
    name: "googlebooks",
    async lookupByIsbn(isbn) {
      try {
        const data = await query(fj, `isbn:${isbn}`);
        const info = data.items?.[0]?.volumeInfo;
        return info ? [mapVolume(info, ISBN_HIT, isbn)] : [];
      } catch {
        return [];
      }
    },
    async searchByTitleAuthor(title, author) {
      try {
        // Terms are space-separated; URLSearchParams encodes the space. A literal "+" would
        // be percent-encoded to %2B and treated as text, not a term separator.
        const q = `intitle:${title}${author ? ` inauthor:${author}` : ""}`;
        const data = await query(fj, q);
        return (data.items ?? [])
          .slice(0, 5)
          .map((it) => it.volumeInfo)
          .filter((v): v is VolumeInfo => v !== undefined)
          .map((v) => mapVolume(v, SEARCH_HIT));
      } catch {
        return [];
      }
    },
  };
}

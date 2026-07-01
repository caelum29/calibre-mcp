// Open Library provider (openlibrary.org, keyless). Maps two endpoints onto ProviderHit[]:
//   - /api/books?bibkeys=ISBN:x&jscmd=data  → exact ISBN lookup (high confidence)
//   - /search.json?title=&author=           → fuzzy title/author search (low confidence)
// Response shapes verified live against the API (2026-07-01). Returns-not-throws.

import type { ProviderHit } from "../domain/enrich/types.js";
import { isValidIsbn } from "../domain/curation/isbn.js";
import { fetchJson, type FetchJson } from "./http.js";
import type { Provider } from "./provider.js";

const BASE = "https://openlibrary.org";
const ISBN_HIT = 0.95;
const SEARCH_HIT = 0.6;

/** /api/books jscmd=data record (only the fields we read). */
interface OlDataRecord {
  title?: string;
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  publish_date?: string;
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
}

interface OlSearchDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  isbn?: string[];
}
interface OlSearch {
  docs?: OlSearchDoc[];
}

/** First checksum-valid ISBN in a list, 13 preferred over 10. */
function bestIsbn(...lists: (string[] | undefined)[]): string | undefined {
  const all = lists.flatMap((l) => l ?? []);
  return all.find((s) => s.length === 13 && isValidIsbn(s)) ?? all.find((s) => isValidIsbn(s));
}

function mapData(rec: OlDataRecord, fallbackIsbn: string): ProviderHit {
  return {
    source: "openlibrary",
    title: rec.title,
    authors: rec.authors?.map((a) => a.name ?? "").filter(Boolean),
    publisher: rec.publishers?.[0]?.name,
    pubdate: rec.publish_date,
    isbn: bestIsbn(rec.identifiers?.isbn_13, rec.identifiers?.isbn_10) ?? fallbackIsbn,
    confidence: ISBN_HIT,
  };
}

function mapDoc(doc: OlSearchDoc): ProviderHit {
  return {
    source: "openlibrary",
    title: doc.title,
    authors: doc.author_name,
    publisher: doc.publisher?.[0],
    pubdate: doc.first_publish_year !== undefined ? String(doc.first_publish_year) : undefined,
    isbn: bestIsbn(doc.isbn),
    confidence: SEARCH_HIT,
  };
}

export function createOpenLibrary(fj: FetchJson = fetchJson): Provider {
  return {
    name: "openlibrary",
    async lookupByIsbn(isbn) {
      try {
        const key = `ISBN:${isbn}`;
        const url = `${BASE}/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`;
        const data = await fj<Record<string, OlDataRecord>>(url);
        const rec = data[key];
        return rec ? [mapData(rec, isbn)] : [];
      } catch {
        return [];
      }
    },
    async searchByTitleAuthor(title, author) {
      try {
        const url = new URL(`${BASE}/search.json`);
        url.searchParams.set("title", title);
        if (author) url.searchParams.set("author", author);
        url.searchParams.set("limit", "5");
        url.searchParams.set("fields", "title,author_name,first_publish_year,publisher,isbn");
        const data = await fj<OlSearch>(url.toString());
        return (data.docs ?? []).slice(0, 5).map(mapDoc);
      } catch {
        return [];
      }
    },
  };
}

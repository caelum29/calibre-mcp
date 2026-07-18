// Content Server read client — the preferred read path (fast, GUI-safe, documented
// /ajax/* API; CAPABILITIES §1). SDK-free. This is the ONLY place that knows the raw
// /ajax JSON key names; every method maps them to domain objects and goes through
// getJson() for uniform timeout/error handling.

import type { Config } from "../config.js";
import type { Book, Identifiers } from "../domain/book.js";
import type { LibraryInfo, Category, CategoryItem, CategoryItemsPage } from "../domain/library.js";
import type { SearchParams, SearchPage } from "../domain/search.js";
import { getJson } from "./http.js";
import { toLibId } from "./lib-id.js";

// --- Raw /ajax response shapes (loose; only the fields we read) ---

interface RawLibraryInfo {
  library_map?: Record<string, string>;
  default_library?: string;
}

interface RawSearch {
  total_num?: number;
  num?: number;
  offset?: number;
  sort?: string;
  book_ids?: number[];
  library_id?: string;
}

interface RawBook {
  application_id?: number;
  id?: number;
  uuid?: string;
  title?: string;
  authors?: string[];
  author_sort?: string;
  comments?: string | null;
  identifiers?: Record<string, string>;
  formats?: string[];
  series?: string | null;
  series_index?: number | null;
  tags?: string[];
  languages?: string[];
  publisher?: string | null;
  pubdate?: string | null;
  pages?: number | null;
  rating?: number | null;
  last_modified?: string | null;
}

interface RawCategory {
  name?: string;
  url?: string;
  count?: number;
}

interface RawCategoryItem {
  name?: string;
  count?: number;
  average_rating?: number;
  url?: string;
}

interface RawCategoryItems {
  category_name?: string;
  total_num?: number;
  offset?: number;
  num?: number;
  items?: RawCategoryItem[];
}

/** Synonyms so a caller's `field` maps to the server's display category name. */
const FIELD_SYNONYMS: Record<string, string> = {
  author: "authors",
  authors: "authors",
  tag: "tags",
  tags: "tags",
  language: "languages",
  languages: "languages",
  series: "series",
  publisher: "publisher",
  rating: "rating",
};

/** Resolve a caller's `field` to a category node by case-insensitive name (+ synonyms). */
export function matchCategory(categories: Category[], field: string): Category | undefined {
  const raw = field.trim().toLowerCase();
  const target = FIELD_SYNONYMS[raw] ?? raw;
  return (
    categories.find((c) => c.name.toLowerCase() === target) ??
    categories.find((c) => c.name.toLowerCase() === raw)
  );
}

export class ContentServerClient {
  // Process-lifetime cache of libId → display name. Libraries rarely change; a
  // rename/add mid-session goes stale until restart (acceptable for local stdio use).
  #libMap?: Record<string, string>;
  // The server's own default library (a libId), for when no library is configured.
  #defaultLibId?: string;

  constructor(private readonly cfg: Config) {}

  private get base(): string {
    return this.cfg.serverUrl.replace(/\/+$/, "");
  }

  /** GET /ajax/library-info → {libraryMap, defaultLibrary}; caches map + default. */
  async libraryInfo(): Promise<LibraryInfo> {
    const raw = await getJson<RawLibraryInfo>(`${this.base}/ajax/library-info`);
    const libraryMap = raw.library_map ?? {};
    this.#libMap = libraryMap;
    this.#defaultLibId = raw.default_library || Object.keys(libraryMap)[0];
    return { libraryMap, defaultLibrary: raw.default_library ?? "" };
  }

  /**
   * Resolve a display name ("Programming Books") to its libId ("Programming_Books")
   * via the authoritative library_map; falls back to space→underscore substitution
   * only if the server doesn't list it (DESIGN: don't hard-code the substitution).
   * No name anywhere (no arg, empty config) → the server's own default library.
   */
  async resolveLibraryId(display?: string): Promise<string> {
    const name = display || this.cfg.defaultLibrary;
    if (!this.#libMap) await this.libraryInfo();
    const map = this.#libMap ?? {};
    if (!name) {
      if (this.#defaultLibId) return this.#defaultLibId;
      throw new Error(
        `The Content Server at ${this.cfg.serverUrl} reports no libraries; ` +
          "set CALIBRE_MCP_LIBRARY or check the server.",
      );
    }
    // If `name` already IS a libId (a key), use it directly.
    if (map[name] !== undefined) return name;
    for (const [libId, displayName] of Object.entries(map)) {
      if (displayName === name) return libId;
    }
    return toLibId(name);
  }

  /** GET /ajax/search/{libId}?query=&num=&offset=&sort=&sort_order= → SearchPage (ids only). */
  async search(p: SearchParams): Promise<SearchPage> {
    const libId = await this.resolveLibraryId(p.library);
    const url = new URL(`${this.base}/ajax/search/${encodeURIComponent(libId)}`);
    url.searchParams.set("query", p.query);
    if (p.num !== undefined) url.searchParams.set("num", String(p.num));
    if (p.offset !== undefined) url.searchParams.set("offset", String(p.offset));
    if (p.sort) url.searchParams.set("sort", p.sort);
    if (p.sortOrder) url.searchParams.set("sort_order", p.sortOrder);

    const raw = await getJson<RawSearch>(url.toString());
    const bookIds = raw.book_ids ?? [];
    return {
      bookIds,
      total: raw.total_num ?? bookIds.length,
      num: raw.num ?? bookIds.length,
      offset: raw.offset ?? p.offset ?? 0,
      sort: raw.sort ?? p.sort ?? "title",
      libraryId: raw.library_id ?? libId,
    };
  }

  /** GET /ajax/book/{id}/{libId} → full Book. */
  async getBook(id: number, library?: string): Promise<Book> {
    const libId = await this.resolveLibraryId(library);
    const url = `${this.base}/ajax/book/${id}/${encodeURIComponent(libId)}`;
    const raw = await getJson<RawBook>(url);
    return this.mapBook(raw, id, libId);
  }

  /** GET /ajax/books/{libId}?ids=1,2,3 → Map<id, Book|null> (batched page fetch). */
  async booksByIds(ids: number[], library?: string): Promise<Map<number, Book | null>> {
    const out = new Map<number, Book | null>();
    if (ids.length === 0) return out;
    const libId = await this.resolveLibraryId(library);
    const url = `${this.base}/ajax/books/${encodeURIComponent(libId)}?ids=${ids.join(",")}`;
    const raw = await getJson<Record<string, RawBook | null>>(url);
    for (const id of ids) {
      const entry = raw[String(id)];
      out.set(id, entry ? this.mapBook(entry, id, libId) : null);
    }
    return out;
  }

  /**
   * GET /get/thumb/{id}/{libId}?sz=WxH → base64 thumbnail for calibre_get_book's
   * include_cover opt-in (issue #22). The cover is a nicety: any failure (no cover,
   * server down, timeout) returns null and the caller degrades with a note.
   */
  async coverThumb(
    id: number,
    library?: string,
    sz = "300x400",
  ): Promise<{ data: string; mimeType: string } | null> {
    const libId = await this.resolveLibraryId(library);
    const url = `${this.base}/get/thumb/${id}/${encodeURIComponent(libId)}?sz=${sz}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { data: buf.toString("base64"), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** GET /ajax/categories/{libId} → Category[]. */
  async categories(library?: string): Promise<Category[]> {
    const libId = await this.resolveLibraryId(library);
    const raw = await getJson<RawCategory[]>(
      `${this.base}/ajax/categories/${encodeURIComponent(libId)}`,
    );
    return raw.map((c) => ({ name: c.name ?? "", url: c.url ?? "", count: c.count }));
  }

  /**
   * Fetch one category's values via a node `url` from {@link categories} (e.g.
   * `/ajax/category/<hex>/<libId>`). The url is hex-encoded by the server — used
   * verbatim, never hand-built. Supports `num`/`offset` paging.
   */
  async categoryItemsByUrl(
    url: string,
    opts: { num?: number; offset?: number; sort?: string } = {},
  ): Promise<CategoryItemsPage> {
    const u = new URL(`${this.base}${url}`);
    if (opts.num !== undefined) u.searchParams.set("num", String(opts.num));
    if (opts.offset !== undefined) u.searchParams.set("offset", String(opts.offset));
    if (opts.sort) u.searchParams.set("sort", opts.sort);

    const raw = await getJson<RawCategoryItems>(u.toString());
    const items: CategoryItem[] = (raw.items ?? []).map((it) => ({
      name: it.name ?? "",
      count: it.count,
      averageRating: it.average_rating,
    }));
    return {
      items,
      total: raw.total_num ?? items.length,
      offset: raw.offset ?? opts.offset ?? 0,
      num: raw.num ?? items.length,
    };
  }

  /** Normalize a raw /ajax book dict → domain Book. The single /ajax-key-aware spot. */
  private mapBook(raw: RawBook, fallbackId: number, libId: string): Book {
    const id = raw.application_id ?? raw.id ?? fallbackId;
    const identifiers: Identifiers = { ...(raw.identifiers ?? {}) };
    return {
      id,
      uuid: raw.uuid ?? "",
      title: raw.title ?? "",
      authors: raw.authors ?? [],
      authorSort: raw.author_sort,
      comments: raw.comments ?? undefined,
      identifiers,
      formats: (raw.formats ?? []).map((f) => f.toLowerCase()),
      series: raw.series ?? undefined,
      seriesIndex: raw.series_index ?? undefined,
      tags: raw.tags ?? [],
      languages: raw.languages ?? [],
      publisher: raw.publisher ?? undefined,
      pubdate: raw.pubdate ?? undefined,
      pages: raw.pages ?? undefined,
      rating: raw.rating ?? undefined,
      coverUrl: `${this.base}/get/cover/${id}/${encodeURIComponent(libId)}`,
      lastModified: raw.last_modified ?? undefined,
    };
  }
}

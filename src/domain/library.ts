// Library-level domain shapes from the Content Server `/ajax/library-info` and
// `/ajax/categories` contracts. SDK-free.

/** The Content Server's view of available libraries. */
export interface LibraryInfo {
  /** libId (underscored, e.g. "Programming_Books") → display name ("Programming Books"). */
  libraryMap: Record<string, string>;
  /** libId of the default library. */
  defaultLibrary: string;
}

/** A Tag-Browser category node (Authors, Tags, Series, …). */
export interface Category {
  name: string;
  url: string;
  count?: number;
}

/** One value within a category (an author name, a tag, …) with its book count. */
export interface CategoryItem {
  name: string;
  count?: number;
  /** Opaque item id from the Content Server, when present. */
  id?: string;
  averageRating?: number;
}

/** One page of a category's values. */
export interface CategoryItemsPage {
  items: CategoryItem[];
  total: number;
  offset: number;
  num: number;
}

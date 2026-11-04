// Deliberately broken IndexStore wrappers for eval tests: prove a gate or metric actually
// measures ranking by feeding it a retriever known to be wrong.

import type { IndexStore } from "../../../src/semantic/store/index.js";

/** Wrap a store so every search comes back worst-first — a deliberately broken retriever. */
export function reversed(inner: IndexStore): IndexStore {
  return {
    hasIndex: (l) => inner.hasIndex(l),
    indexMeta: (l) => inner.indexMeta(l),
    hasVectors: (l) => inner.hasVectors(l),
    isBookIndexed: (l, b, m, o) => inner.isBookIndexed(l, b, m, o),
    replaceBook: (l, m, c, f, o) => inner.replaceBook(l, m, c, f, o),
    refreshBookMeta: (l, m, c) => inner.refreshBookMeta(l, m, c),
    bookChunkSpans: (l, b) => inner.bookChunkSpans(l, b),
    bookVectorCount: (l, b) => inner.bookVectorCount(l, b),
    booksMissingVectors: (l) => inner.booksMissingVectors(l),
    indexedBookIds: (l) => inner.indexedBookIds(l),
    deleteBooks: (l, b) => inner.deleteBooks(l, b),
    searchLibrary: (l, q, k) => inner.searchLibrary(l, q, k).reverse(),
    searchBook: (l, b, q, k) => inner.searchBook(l, b, q, k).reverse(),
    searchLibraryFts: (l, q, k) => inner.searchLibraryFts(l, q, k).reverse(),
    searchBookFts: (l, b, q, k) => inner.searchBookFts(l, b, q, k).reverse(),
    searchFigures: (l, q, k, b) => inner.searchFigures(l, q, k, b).reverse(),
    searchFiguresFts: (l, q, k, b) => inner.searchFiguresFts(l, q, k, b).reverse(),
    figureCount: (l, b) => inner.figureCount(l, b),
    chunkAt: (l, b, o) => inner.chunkAt(l, b, o),
    figuresInSpan: (l, b, s, e) => inner.figuresInSpan(l, b, s, e),
    stats: (l) => inner.stats(l),
    vectorCount: (l) => inner.vectorCount(l),
    close: () => inner.close(),
  };
}

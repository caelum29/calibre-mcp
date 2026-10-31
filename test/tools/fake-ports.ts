// Full-port test fakes (#316, #325): each builder returns a COMPLETE port, so a port that gains a
// method fails typecheck here, once, instead of passing every `satisfies Partial<Port> as Port`
// fake and failing at runtime in whichever handler test first reaches it. Methods a test doesn't
// stub throw a named error, so reaching one fails loudly rather than as "x is not a function".

import type { LibraryWriter } from "../../src/calibre/client.js";
import type { LibraryReader } from "../../src/calibre/content-server.js";
import type { TextExtractor } from "../../src/calibre/extract.js";
import type { FigureSource } from "../../src/calibre/figure-inventory.js";
import type { Embedder } from "../../src/semantic/embedder.js";

/** A port method the test didn't stub: throws, naming the port and method. */
function unstubbed(port: string, method: string): () => never {
  return () => {
    throw new Error(`fake ${port}.${method} not stubbed in this test`);
  };
}

/** Content Server reads (`deps.content`). */
export function fakeContent(over: Partial<LibraryReader> = {}): LibraryReader {
  const u = (m: keyof LibraryReader) => unstubbed("content", m);
  return {
    libraryInfo: u("libraryInfo"),
    resolveLibraryId: u("resolveLibraryId"),
    search: u("search"),
    getBook: u("getBook"),
    booksByIds: u("booksByIds"),
    bookMergeFacts: u("bookMergeFacts"),
    coverThumb: u("coverThumb"),
    virtualLibraries: u("virtualLibraries"),
    categories: u("categories"),
    categoryItemsByUrl: u("categoryItemsByUrl"),
    ...over,
  };
}

/** calibredb writes (`deps.calibre`). */
export function fakeCalibre(over: Partial<LibraryWriter> = {}): LibraryWriter {
  const u = (m: keyof LibraryWriter) => unstubbed("calibre", m);
  return { calibredb: u("calibredb"), listLibraries: u("listLibraries"), ...over };
}

/** Book-text extraction (`deps.extractor`). */
export function fakeExtractor(over: Partial<TextExtractor> = {}): TextExtractor {
  return { getText: unstubbed("extractor", "getText"), ...over };
}

/** Figure inventory + pixel fetch (`deps.figures`). */
export function fakeFigures(over: Partial<FigureSource> = {}): FigureSource {
  const u = (m: keyof FigureSource) => unstubbed("figures", m);
  return { getInventory: u("getInventory"), fetchFigures: u("fetchFigures"), ...over };
}

/** Query/passage embedding (`deps.embedder`); `loadState` is optional on the port and left out. */
export function fakeEmbedder(over: Partial<Embedder> = {}): Embedder {
  const u = (m: keyof Embedder) => unstubbed("embedder", m);
  return {
    embedQuery: u("embedQuery"),
    embedPassages: u("embedPassages"),
    warmup: u("warmup"),
    countTokens: u("countTokens"),
    ...over,
  };
}

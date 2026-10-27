// calibre_get_book — full metadata for one book by db id or uuid. Returns structured
// data plus a fenced text summary and a resource_link the host can follow for cover/text.
// On MCP Apps hosts the result renders as a book-card widget (issue #22): structuredContent
// carries serverUrl/libraryId so the card can build thumb + viewer URLs token-free;
// include_cover opts into a real ImageContent block only when the model must SEE the cover.

import { z } from "zod";
import type { Book } from "../domain/book.js";
import { CalibreHttpError } from "../domain/errors.js";
import { isEmptyDate } from "../domain/merge.js";
import { BookId, CoercedBool } from "./coerce.js";
import { bookIdArg } from "./resolve-id.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock } from "./types.js";

// All-optional so the SDK validates structuredContent without stripping/rejecting (permissive).
const bookSchema = z.object({
  id: z.number().optional(),
  uuid: z.string().optional(),
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  authorSort: z.string().optional(),
  comments: z.string().optional(),
  identifiers: z.record(z.string(), z.string()).optional(),
  formats: z.array(z.string()).optional(),
  series: z.string().optional(),
  seriesIndex: z.number().optional(),
  tags: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  pubdate: z.string().optional(),
  pages: z.number().optional(),
  rating: z.number().optional(),
  coverUrl: z.string().optional(),
  lastModified: z.string().optional(),
});

export const getBookTool = defineTool({
  name: "calibre_get_book",
  title: "Get book metadata",
  description:
    "Get full metadata (authors, ISBN, formats, comments, cover) for one book by its id or uuid (id and bookId are interchangeable — pass the bookId from a search result). Set include_cover=true only when the cover image itself must be inspected.",
  inputSchema: {
    id: BookId().optional(),
    bookId: BookId().optional(),
    library: z.string().optional(),
    include_cover: CoercedBool().default(false),
  },
  outputSchema: {
    book: bookSchema.optional(),
    // Widget plumbing (issue #22): the book card builds /get/thumb and viewer URLs from these.
    serverUrl: z.string().optional(),
    libraryId: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    const idArg = bookIdArg(args);
    if (idArg === undefined) return toolError("Provide id (the book's db id or uuid).");
    try {
      // BookId coerces numeric strings to numbers, so a string here is a uuid.
      let numericId: number;
      if (typeof idArg === "number") {
        numericId = idArg;
      } else {
        const page = await deps.content.search({
          query: `uuid:${idArg}`,
          num: 1,
          library: args.library,
        });
        const first = page.bookIds[0];
        if (first === undefined) return toolError(`No book with uuid ${idArg}`);
        numericId = first;
      }

      const book = await deps.content.getBook(numericId, args.library);
      const libraryId = await deps.content.resolveLibraryId(args.library);
      let summary = formatBookSummary(book);

      const blocks: ContentBlock[] = [];
      if (args.include_cover) {
        const thumb = await deps.content.coverThumb(book.id, args.library);
        if (thumb) blocks.push({ type: "image", data: thumb.data, mimeType: thumb.mimeType });
        else summary += "\n\n(No cover image available for this book.)";
      }

      return toolOk(
        [
          { type: "text", text: fence("BOOK METADATA", summary) },
          ...blocks,
          bookResourceLink({ id: book.id, title: book.title, authors: book.authors }),
        ],
        { book, serverUrl: deps.config.serverUrl, libraryId },
      );
    } catch (err) {
      if (err instanceof CalibreHttpError && err.status === 404) {
        return toolError(`No book with id ${idArg} in the requested library`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});

/**
 * Text mirror of the full record — Desktop strips structuredContent, so formats/ISBN/tags
 * must live here too (#104). Fields go BEFORE comments: comments can be huge HTML and
 * clients may truncate the tail.
 */
export function formatBookSummary(book: Book): string {
  const dash = (v: string | undefined) => (v ? v : "—");
  const list = (v: string[]) => (v.length ? v.join(", ") : "—");
  const { isbn, ...otherIds } = book.identifiers;
  const ids = Object.entries(otherIds)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const series = book.series
    ? `${book.series}${book.seriesIndex !== undefined ? ` [${book.seriesIndex}]` : ""}`
    : undefined;
  const pubdate = isEmptyDate(book.pubdate) ? undefined : book.pubdate!.slice(0, 10);

  const lines = [
    book.title,
    `by ${book.authors.join(", ") || "unknown"}`,
    [
      `formats: ${list(book.formats.map((f) => f.toUpperCase()))}`,
      ...(book.pages !== undefined ? [`pages: ${book.pages}`] : []),
      `lang: ${list(book.languages)}`,
      ...(book.rating ? [`rating: ${book.rating}`] : []),
    ].join(" | "),
    `isbn: ${dash(isbn)} | ids: ${list(ids)}`,
    `series: ${dash(series)} | tags: ${list(book.tags)} | publisher: ${dash(book.publisher)} | pubdate: ${dash(pubdate)}`,
    `id: ${book.id} | uuid: ${book.uuid}` + (book.lastModified ? ` | last modified: ${book.lastModified}` : ""),
  ];
  return lines.join("\n") + (book.comments ? `\n\n${book.comments}` : "");
}

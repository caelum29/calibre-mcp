// calibre_get_book — full metadata for one book by db id or uuid. Returns structured
// data plus a fenced text summary and a resource_link the host can follow for cover/text.

import { z } from "zod";
import { CalibreHttpError } from "../domain/errors.js";
import { BookId } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookResourceLink } from "./resource-link.js";
import { fence, toolError, toolOk } from "./result.js";

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
    "Get full metadata (authors, ISBN, formats, comments, cover) for one book by its id or uuid.",
  inputSchema: {
    id: BookId(),
    library: z.string().optional(),
  },
  outputSchema: { book: bookSchema.optional() },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      // BookId coerces numeric strings to numbers, so a string here is a uuid.
      let numericId: number;
      if (typeof args.id === "number") {
        numericId = args.id;
      } else {
        const page = await deps.content.search({
          query: `uuid:${args.id}`,
          num: 1,
          library: args.library,
        });
        const first = page.bookIds[0];
        if (first === undefined) return toolError(`No book with uuid ${args.id}`);
        numericId = first;
      }

      const book = await deps.content.getBook(numericId, args.library);
      const authors = book.authors.join(", ") || "unknown";
      const summary = `${book.title}\nby ${authors}` + (book.comments ? `\n\n${book.comments}` : "");
      return toolOk(
        [
          { type: "text", text: fence("BOOK METADATA", summary) },
          bookResourceLink({ id: book.id, title: book.title, authors: book.authors }),
        ],
        { book },
      );
    } catch (err) {
      if (err instanceof CalibreHttpError && err.status === 404) {
        return toolError(`No book with id ${args.id} in the requested library`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});

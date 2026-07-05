// calibre_get_content — extract a book's text as a capped, fenced excerpt. The whole
// book is walkable via the returned cursor (each page resumes where the last ended).
// Extraction downloads the format file over HTTP (GUI-safe) and converts it; results
// are cached so paging doesn't reconvert. Scanned PDFs yield empty text (no OCR).

import { z } from "zod";
import { chooseExtractFormat } from "../calibre/extract.js";
import { detectChapters } from "../domain/structure/chapters.js";
import { CalibreHttpError } from "../domain/errors.js";
import { BookId, CoercedBool, CursorParam, limitParam } from "./coerce.js";
import { chunkText } from "./content-chunk.js";
import { decodeContentCursor, encodeContentCursor } from "./content-cursor.js";
import { defineTool } from "./define.js";
import { resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";

export const getContentTool = defineTool({
  name: "calibre_get_content",
  title: "Read book text",
  description:
    "Extract a book's text as a capped, fenced excerpt; pass the returned cursor to walk the whole book. Set structure=true for a chapter map with per-chapter cursors. To find text inside a book, use calibre_search scope=book.",
  inputSchema: {
    id: BookId(),
    format: z.string().optional(),
    maxChars: limitParam(40_000, 8_000),
    sentenceAware: CoercedBool().default(true),
    structure: CoercedBool().default(false),
    cursor: CursorParam,
    library: z.string().optional(),
  },
  outputSchema: {
    offset: z.number().optional(),
    count: z.number().optional(),
    totalChars: z.number().optional(),
    format: z.string().optional(),
    backend: z.string().optional(),
    hasMore: z.boolean().optional(),
    nextCursor: z.string().optional(),
    chapters: z
      .array(
        z.object({
          n: z.number(),
          heading: z.string(),
          startChar: z.number(),
          endChar: z.number(),
          approxTokens: z.number(),
          cursor: z.string(),
        }),
      )
      .optional(),
    hasToc: z.boolean().optional(),
    detector: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      const numericId = await resolveNumericId(deps, args.id, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${args.id}`);

      const book = await deps.content.getBook(numericId, args.library);
      const fmt = chooseExtractFormat(book.formats, args.format);
      if (!fmt) {
        const avail = book.formats.length ? book.formats.join(", ") : "none";
        return toolError(
          `Book ${numericId} has no extractable text format (available: ${avail}). Add an EPUB or PDF.`,
        );
      }

      const libId = await deps.content.resolveLibraryId(args.library);
      const base = deps.config.serverUrl.replace(/\/+$/, "");
      const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${numericId}/${encodeURIComponent(libId)}`;
      const cacheKey = `${numericId}:${fmt}:${book.lastModified ?? ""}`;

      let extracted;
      try {
        extracted = await deps.extractor.getText({ bookId: numericId, format: fmt, downloadUrl, cacheKey });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        if (m === "NO_PDF_BACKEND") {
          return toolError(
            "No PDF text extractor found (pdftotext / PyMuPDF / ebook-convert). Install poppler (brew install poppler) or PyMuPDF (pip install pymupdf).",
          );
        }
        if (m === "NO_EPUB_BACKEND") {
          return toolError("No ebook extractor found — Calibre's ebook-convert is required.");
        }
        if (m === "EXTRACT_TIMEOUT" || m.toLowerCase().includes("timed out")) {
          return toolError(`Text extraction timed out for book ${numericId} (${fmt}). The file may be very large.`);
        }
        if (m.includes("size limit")) {
          return toolError("Book file exceeds the 64 MB extraction limit; cannot extract.");
        }
        if (m === "EXTRACT_FAILED") {
          return toolError(`Could not extract text from book ${numericId} (${fmt}).`);
        }
        throw err;
      }

      if (extracted.text.trim().length === 0) {
        return toolError(
          `No extractable text found in book ${numericId} (${fmt}) — likely a scanned/image PDF (Calibre has no OCR).`,
        );
      }

      // structure mode: return a chapter map (with per-chapter cursors), not book text.
      // Ignores `cursor` — the map spans the whole book. 0 chapters is not an error.
      if (args.structure) {
        const struct = detectChapters(extracted.text);
        const totalChars = extracted.text.length;
        const chapters = struct.chapters.map((c) => ({
          n: c.n,
          heading: c.heading,
          startChar: c.startChar,
          endChar: c.endChar,
          approxTokens: Math.round((c.endChar - c.startChar) / 4),
          cursor: encodeContentCursor({ offset: c.startChar, id: numericId, format: fmt }),
        }));
        const head = `Book ${numericId} — ${fmt} via ${extracted.backend}, ${chapters.length} chapters (${struct.detector}), ToC ${struct.hasToc ? "yes" : "no"}`;
        const body =
          chapters.length === 0
            ? "No chapters detected — walk the book with the plain cursor (omit structure=true)."
            : `n | heading | ~tokens\n${chapters.map((c) => `${c.n} | ${c.heading} | ~${c.approxTokens}`).join("\n")}`;
        return toolOk([{ type: "text", text: `${head}\n${fence("CHAPTERS", body)}` }], {
          chapters,
          hasToc: struct.hasToc,
          detector: struct.detector,
          totalChars,
          format: fmt,
          backend: extracted.backend,
        });
      }

      // Resume only if the cursor was minted for THIS book + format (else restart at 0).
      const cur = decodeContentCursor(args.cursor);
      const offset = cur && cur.id === numericId && cur.format === fmt ? cur.offset : 0;
      const chunk = chunkText(extracted.text, {
        offset,
        maxChars: args.maxChars,
        sentenceAware: args.sentenceAware,
      });
      const nextCursor = chunk.hasMore
        ? encodeContentCursor({ offset: chunk.end, id: numericId, format: fmt })
        : undefined;

      const header = `Book ${numericId} — ${fmt} via ${extracted.backend}, chars ${chunk.start}–${chunk.end} of ${chunk.totalChars}`;
      return toolOk([{ type: "text", text: `${header}\n${fence("BOOK CONTENT", chunk.slice)}` }], {
        offset: chunk.start,
        count: chunk.slice.length,
        totalChars: chunk.totalChars,
        format: fmt,
        backend: extracted.backend,
        hasMore: chunk.hasMore,
        nextCursor,
      });
    } catch (err) {
      if (err instanceof CalibreHttpError && err.status === 404) {
        return toolError(`No book with id ${args.id} in the requested library`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});

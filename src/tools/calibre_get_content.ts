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
import { bookIdArg, resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";

export const getContentTool = defineTool({
  name: "calibre_get_content",
  title: "Read book text",
  description:
    "Extract a book's text as a capped, fenced excerpt; pass the returned nextCursor token verbatim to walk the whole book. Set structure=true for a chapter map with per-chapter cursors. To find text inside a book, use calibre_search scope=book.",
  inputSchema: {
    id: BookId().optional(),
    bookId: BookId().optional(),
    format: z.string().optional(),
    maxChars: limitParam(40_000, 8_000),
    sentenceAware: CoercedBool().default(true),
    structure: CoercedBool().default(false),
    cursor: CursorParam.describe(
      "Opaque continuation token from a previous response (nextCursor or a chapter cursor). Pass it verbatim — do not construct one.",
    ),
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
    // The fenced excerpt, mirrored here so structured-only clients (that render
    // structuredContent but drop text content blocks) still surface the book text.
    text: z.string().optional(),
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
    const idArg = bookIdArg(args);
    if (idArg === undefined) return toolError("Provide id (the book's db id or uuid).");
    try {
      const numericId = await resolveNumericId(deps, idArg, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${idArg}`);

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
        // Cursors go in the text table too — some clients drop structuredContent entirely (#26).
        const body =
          chapters.length === 0
            ? "No chapters detected — walk the book with the plain cursor (omit structure=true)."
            : `n | heading | ~tokens | cursor\n${chapters.map((c) => `${c.n} | ${c.heading} | ~${c.approxTokens} | ${c.cursor}`).join("\n")}`;
        const fencedChapters = fence("CHAPTERS", body);
        return toolOk([{ type: "text", text: `${head}\n${fencedChapters}` }], {
          chapters,
          hasToc: struct.hasToc,
          detector: struct.detector,
          totalChars,
          format: fmt,
          backend: extracted.backend,
          text: fencedChapters,
        });
      }

      // A cursor must decode AND match this book+format — anything else errors loudly.
      // Silent restart-at-0 shipped first and produced invisible pagination loops (#26).
      const cur = decodeContentCursor(args.cursor);
      if (args.cursor !== undefined && !cur) {
        return toolError(
          "Invalid cursor — pass the exact nextCursor token from the previous calibre_get_content response (it is opaque; formats like \"char:N\" are not valid), or omit cursor to start from the beginning.",
        );
      }
      if (cur && (cur.id !== numericId || cur.format !== fmt)) {
        return toolError(
          `Cursor was minted for book ${cur.id} (${cur.format}), not book ${numericId} (${fmt}) — omit cursor to start this book from the beginning.`,
        );
      }
      const offset = cur ? cur.offset : 0;
      const chunk = chunkText(extracted.text, {
        offset,
        maxChars: args.maxChars,
        sentenceAware: args.sentenceAware,
      });
      const nextCursor = chunk.hasMore
        ? encodeContentCursor({ offset: chunk.end, id: numericId, format: fmt })
        : undefined;

      const header = `Book ${numericId} — ${fmt} via ${extracted.backend}, chars ${chunk.start}–${chunk.end} of ${chunk.totalChars}`;
      // The cursor rides in the text block too — some clients drop structuredContent (#26).
      const footer = nextCursor ? `\nMore remains — continue with cursor: ${nextCursor}` : "";
      const fenced = `${fence("BOOK CONTENT", chunk.slice)}${footer}`;
      return toolOk([{ type: "text", text: `${header}\n${fenced}` }], {
        offset: chunk.start,
        count: chunk.slice.length,
        totalChars: chunk.totalChars,
        format: fmt,
        backend: extracted.backend,
        hasMore: chunk.hasMore,
        nextCursor,
        text: fenced,
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

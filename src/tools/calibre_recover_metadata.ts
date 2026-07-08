// calibre_recover_metadata — the raw-filename fix. Proposes real metadata for a book whose
// title/authors are missing or a leftover filename (e.g. "795731065", "B0CZS7H23N"). READ /
// PREVIEW ONLY: it looks up Open Library → Google Books and returns a proposal plus a
// ready-to-apply `changes` object — it NEVER writes. Apply via calibre_update_book (#11).
//
// Lookup key: existing valid ISBN → else an ISBN scraped from the book text → else the title
// (+first author) if usable. Providers are queried in order; the first with a hit wins.

import { z } from "zod";
import { isValidIsbn } from "../domain/curation/isbn.js";
import { isUsableTitle } from "../domain/enrich/filename-guess.js";
import { buildProposal } from "../domain/enrich/proposal.js";
import type { ProviderHit } from "../domain/enrich/types.js";
import { createGoogleBooks } from "../enrich/googlebooks.js";
import { createOpenLibrary } from "../enrich/openlibrary.js";
import type { Provider } from "../enrich/provider.js";
import { CalibreHttpError } from "../domain/errors.js";
import { BookId, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { scanForIsbn } from "./isbn-scan.js";
import type { IsbnScanResult } from "./isbn-scan.js";
import { bookIdArg, resolveNumericId } from "./resolve-id.js";
import { bookResourceLink } from "./resource-link.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ToolDeps } from "./types.js";

const SOURCE = z.enum(["openlibrary", "googlebooks"]);
const DEFAULT_SOURCES: Provider["name"][] = ["openlibrary", "googlebooks"];

/** Lazily construct the real providers (no network until a method is called). */
function providersFor(deps: ToolDeps, order: Provider["name"][]): Provider[] {
  const map =
    deps.providers ?? { openlibrary: createOpenLibrary(), googlebooks: createGoogleBooks() };
  return order.map((n) => map[n]).filter(Boolean);
}

export const recoverMetadataTool = defineTool({
  name: "calibre_recover_metadata",
  title: "Recover book metadata",
  description:
    "Propose real metadata for a book with a missing/raw-filename title via online provider lookup (ISBN from its identifiers or text, else title/author) on Open Library and Google Books. Preview only — returns a changes object for calibre_update_book; never writes.",
  inputSchema: {
    id: BookId().optional(),
    bookId: BookId().optional(),
    sources: jsonArray(SOURCE).optional(),
    library: z.string().optional(),
  },
  outputSchema: {
    bookId: z.number().optional(),
    lookupKey: z.string().optional(),
    source: z.string().optional(),
    confidence: z.number().optional(),
    fieldCount: z.number().optional(),
    changes: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    const idArg = bookIdArg(args);
    if (idArg === undefined) return toolError("Provide id (the book's db id or uuid).");
    try {
      const numericId = await resolveNumericId(deps, idArg, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${idArg}`);
      const book = await deps.content.getBook(numericId, args.library);

      // Pick the lookup key: existing valid ISBN → text-scraped ISBN → usable title.
      const existingIsbn = book.identifiers.isbn && isValidIsbn(book.identifiers.isbn)
        ? book.identifiers.isbn
        : undefined;
      let scan: IsbnScanResult | undefined;
      if (!existingIsbn) {
        scan = await scanForIsbn(deps, book, numericId, args.library);
        deps.log.debug("recover_metadata ISBN scan", { bookId: numericId, outcome: scan.outcome });
      }
      const isbn = existingIsbn ?? scan?.isbn;
      const author = book.authors.find((a) => a.trim() && a.trim().toLowerCase() !== "unknown");

      let lookupKey: string;
      let byIsbn: boolean;
      if (isbn) {
        lookupKey = `isbn:${isbn}`;
        byIsbn = true;
      } else if (isUsableTitle(book.title)) {
        lookupKey = `title:${book.title}${author ? ` / ${author}` : ""}`;
        byIsbn = false;
      } else {
        // No lookup key at all. Tell the user why the text scan didn't rescue us so they can act.
        const scanHint =
          scan?.outcome === "timeout"
            ? " and the text scan timed out before finding one"
            : scan?.outcome === "no-format" || scan?.outcome === "error"
              ? " and the text scan found none (no extractable text)"
              : " (in metadata or text)";
        return toolError(
          `Nothing to look up for book ${numericId}: no ISBN${scanHint} and its title ` +
            `"${book.title}" looks like a raw filename. Add an ISBN or a real title, then retry.`,
        );
      }

      const order = args.sources?.length ? args.sources : DEFAULT_SOURCES;
      const providers = providersFor(deps, order);

      let hits: ProviderHit[] = [];
      let usedSource: string | undefined;
      for (const p of providers) {
        const res = byIsbn
          ? await p.lookupByIsbn(isbn!)
          : await p.searchByTitleAuthor(book.title, author);
        if (res.length) {
          hits = res;
          usedSource = p.name;
          break;
        }
      }

      if (hits.length === 0) {
        return toolError(
          `No metadata found for ${lookupKey} on ${order.join(", ")}. ` +
            (byIsbn ? "The ISBN may be unlisted." : "Try a different title or add an ISBN."),
        );
      }

      const proposal = buildProposal(book, hits);
      const confidence = hits[0]!.confidence;

      if (proposal.fields.length === 0) {
        const text =
          `Book ${numericId} matched ${lookupKey} on ${usedSource} (confidence ${confidence.toFixed(2)}), ` +
          `but its metadata is already complete — nothing to propose.`;
        return toolOk([{ type: "text", text }], {
          bookId: numericId,
          lookupKey,
          source: usedSource,
          confidence,
          fieldCount: 0,
          changes: {},
        });
      }

      const lines = proposal.fields.map((f) => {
        const cur = f.current === undefined ? "<missing>" : JSON.stringify(f.current);
        return `  ${f.field}: ${cur} → ${JSON.stringify(f.proposed)}  [${f.source}, ${f.confidence.toFixed(2)}, ${f.reason}]`;
      });
      const body =
        `Book #${numericId} — matched ${lookupKey} on ${usedSource} (confidence ${confidence.toFixed(2)}).\n` +
        `Proposed metadata (apply with calibre_update_book id=${numericId}):\n` +
        lines.join("\n") +
        `\n\nchanges = ${JSON.stringify(proposal.changes)}`;

      return toolOk(
        [
          { type: "text", text: fence("METADATA PROPOSAL", body) },
          bookResourceLink({ id: numericId, title: book.title, authors: book.authors }),
        ],
        {
          bookId: numericId,
          lookupKey,
          source: usedSource,
          confidence,
          fieldCount: proposal.fields.length,
          changes: proposal.changes,
        },
      );
    } catch (err) {
      if (err instanceof CalibreHttpError && err.status === 404) {
        return toolError(`No book with id ${args.id} in the requested library`);
      }
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});

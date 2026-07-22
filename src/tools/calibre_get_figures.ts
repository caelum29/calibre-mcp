// calibre_get_figures — a book's Figures (captioned images, D-018): list captions
// first so the model can judge relevance cheaply, then fetch selected indexes as
// MCP image blocks. Uncaptioned images (covers, decorations, equation PNGs) stay
// hidden unless include_uncaptioned; scanned PDFs honestly report 0 (no OCR).

import { z } from "zod";
import type { FigureInventory } from "../domain/figures/inventory.js";
import { CalibreHttpError } from "../domain/errors.js";
import { log } from "../logging.js";
import { BookId, CoercedBool, CoercedInt, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { bookIdArg, resolveNumericId } from "./resolve-id.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ContentBlock, ToolDeps } from "./types.js";

/** Figures come from the source file, so only these formats work (D-018). */
const FIGURE_FORMATS = ["epub", "pdf"] as const;
const MAX_INDEXES_PER_CALL = 3;

/** EPUB-first auto-pick (same preference direction as calibre_get_content). */
function chooseFigureFormat(formats: string[], preference?: string): string | undefined {
  const have = new Set(formats.map((f) => f.toLowerCase()));
  if (preference) {
    const p = preference.toLowerCase();
    return have.has(p) ? p : undefined;
  }
  return FIGURE_FORMATS.find((f) => have.has(f));
}

export const getFiguresTool = defineTool({
  name: "calibre_get_figures",
  title: "Get book figures",
  description:
    "List a book's figures — images the text references, identified by caption (Figure 1-2 / Рис. 3.1) — with page + caption per figure, then fetch chosen ones as images via indexes (≤3 per call). Captions let you pick figures before spending image tokens.",
  inputSchema: {
    id: BookId().optional(),
    bookId: BookId().optional(),
    format: z
      .string()
      .optional()
      .describe("Source format override (epub or pdf). Default: epub if present, else pdf."),
    indexes: jsonArray(CoercedInt())
      .optional()
      .describe(
        "Figure indexes from a previous list call — returns those figures as images (≤3 per call). Omit to list. Indexes are per-format; re-list after changing format.",
      ),
    detail: z
      .enum(["standard", "high"])
      .default("standard")
      .describe("Image resolution: standard ≤1024px longest side (default), high ≤1568px."),
    include_uncaptioned: CoercedBool()
      .default(false)
      .describe("Also list/fetch images with no caption (covers, decorations, equation images)."),
    library: z.string().optional(),
  },
  // No outputSchema: with one declared the SDK REQUIRES structuredContent on every
  // result, and clients drop the content array (images!) when structuredContent is
  // present (anthropics/claude-code#54737/#45575). Fetch results must be content-only.
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    const idArg = bookIdArg(args);
    if (idArg === undefined) return toolError("Provide id (the book's db id or uuid).");
    try {
      const numericId = await resolveNumericId(deps, idArg, args.library);
      if (numericId === undefined) return toolError(`No book with id/uuid ${idArg}`);

      const book = await deps.content.getBook(numericId, args.library);
      const fmt = chooseFigureFormat(book.formats, args.format);
      if (!fmt || !FIGURE_FORMATS.includes(fmt as (typeof FIGURE_FORMATS)[number])) {
        const avail = book.formats.length ? book.formats.join(", ") : "none";
        return toolError(
          `Figures need an EPUB or PDF source; book ${numericId} has: ${avail}` +
            (args.format ? ` (requested format: ${args.format})` : "") +
            ". Omit format to auto-pick, or convert the book first.",
        );
      }

      const libId = await deps.content.resolveLibraryId(args.library);
      const base = deps.config.serverUrl.replace(/\/+$/, "");
      const downloadUrl = `${base}/get/${fmt.toUpperCase()}/${numericId}/${encodeURIComponent(libId)}`;
      const cacheKey = `${numericId}:${fmt}:${book.lastModified ?? ""}`;

      let inventory: FigureInventory;
      try {
        ({ inventory } = await deps.figures.getInventory({
          bookId: numericId,
          format: fmt,
          downloadUrl,
          cacheKey,
        }));
      } catch (err) {
        return figuresError(err, numericId, fmt);
      }

      if (args.indexes !== undefined && args.indexes.length > 0) {
        return fetchFigures(args, deps, { numericId, fmt, downloadUrl, inventory });
      }
      return listFigures(args, { numericId, fmt, inventory });
    } catch (err) {
      if (err instanceof CalibreHttpError && err.status === 404) {
        return toolError(`No book with id ${idArg} in the requested library`);
      }
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
});

interface FigureCallArgs {
  detail: "standard" | "high";
  include_uncaptioned: boolean;
  indexes?: number[];
}

interface BookCtx {
  numericId: number;
  fmt: string;
  inventory: FigureInventory;
}

function listFigures(
  args: { include_uncaptioned: boolean },
  { numericId, fmt, inventory }: BookCtx,
) {
  const visible = inventory.entries.filter((e) => e.captioned || args.include_uncaptioned);
  const { counts } = inventory;

  let note: string | undefined;
  if (inventory.scanned) {
    note =
      "This PDF looks scanned (page images, no text layer) — Calibre has no OCR, so no captions can be found. include_uncaptioned=true lists the raw page images.";
  } else if (counts.figures === 0 && counts.uncaptioned > 0 && !args.include_uncaptioned) {
    note = `No captioned figures found, but ${counts.uncaptioned} uncaptioned images exist — some publishers (e.g. Packt print editions) use unnumbered captions. Retry with include_uncaptioned=true to list them.`;
  } else if (counts.figures === 0) {
    note = "No figures found in this book.";
  }

  const head =
    `Book ${numericId} — ${counts.figures} figures in ${fmt} ` +
    `(${counts.uncaptioned} uncaptioned images hidden${args.include_uncaptioned ? " → shown" : ""}, ` +
    `${counts.pageRender} vector/page-render). Indexes are valid for format=${fmt} only. ` +
    `Fetch with indexes=[…] (≤${MAX_INDEXES_PER_CALL} per call).`;
  const rows = visible.map((e) => {
    const cap = e.caption ? e.caption.slice(0, 100) : e.captioned ? "" : "(uncaptioned)";
    const label = e.label ? ` ${e.label}` : "";
    return `${e.index} | p.${e.page} | ${e.source}${label} | ${cap}`;
  });
  const body = rows.length ? `index | page | source | caption\n${rows.join("\n")}` : "(none)";
  const fenced = fence("FIGURE LIST", body);
  const text = `${head}${note ? `\n${note}` : ""}\n${fenced}`;
  return toolOk([{ type: "text", text }], {
    format: fmt,
    counts,
    scanned: inventory.scanned,
    entries: visible.map((e) => ({
      index: e.index,
      page: e.page,
      label: e.label,
      caption: e.caption,
      source: e.source,
      width: e.width,
      height: e.height,
    })),
    note,
    text,
  });
}

async function fetchFigures(
  args: FigureCallArgs,
  deps: ToolDeps,
  { numericId, fmt, downloadUrl, inventory }: BookCtx & { downloadUrl: string },
) {
  const indexes = args.indexes ?? [];
  if (indexes.length > MAX_INDEXES_PER_CALL) {
    return toolError(
      `At most ${MAX_INDEXES_PER_CALL} figures per call (asked: ${indexes.length}) — split into multiple calls.`,
    );
  }
  const invalid = indexes.filter((i) => !inventory.entries[i]);
  if (invalid.length > 0) {
    return toolError(
      `No figure index ${invalid.join(", ")} in book ${numericId} (${fmt} has indexes 0–${inventory.entries.length - 1}). ` +
        `Indexes are per-format — re-run calibre_get_figures without indexes to list them for format=${fmt}.`,
    );
  }
  const hidden = indexes.filter((i) => !inventory.entries[i]?.captioned);
  if (hidden.length > 0 && !args.include_uncaptioned) {
    return toolError(
      `Index ${hidden.join(", ")} is an uncaptioned image — pass include_uncaptioned=true to fetch it.`,
    );
  }

  const outcome = await deps.figures.fetchFigures({
    format: fmt,
    downloadUrl,
    inventory,
    indexes,
    detail: args.detail,
  });

  const blocks: ContentBlock[] = [];
  const returned: Array<{ index: number; mimeType: string; bytes: number }> = [];
  for (const f of outcome.images) {
    const entry = inventory.entries[f.index];
    const cap = entry?.caption ? ` — ${entry.label ? `Figure ${entry.label}: ` : ""}${entry.caption}` : "";
    // mime + size go in the TEXT line too: Desktop strips structuredContent (#80).
    const kb = (f.image.bytes / 1024).toFixed(1);
    blocks.push({
      type: "text",
      text: `Figure index ${f.index} (p.${entry?.page}, ${entry?.source}, ${f.image.mimeType} ${kb} KB${cap ? "" : ", uncaptioned"})${cap}`,
    });
    blocks.push({ type: "image", data: f.image.data, mimeType: f.image.mimeType });
    returned.push({ index: f.index, mimeType: f.image.mimeType, bytes: f.image.bytes });
    log.info(
      `calibre_get_figures fetch book=${numericId} fmt=${fmt} index=${f.index} detail=${args.detail} mime=${f.image.mimeType} bytes=${f.image.bytes}`,
    );
  }
  for (const s of outcome.skipped) {
    blocks.push({ type: "text", text: `Figure index ${s.index} skipped: ${skipReason(s.reason)}` });
  }
  if (outcome.images.length > 0) {
    // First-pass confabulation is the verified failure mode (#80): models answer
    // figure questions from priors without reading the delivered pixels.
    blocks.push({
      type: "text",
      text: "Describe only what is visible in the image(s) above — examine the pixels before answering; do not fill gaps from prior knowledge of similar diagrams.",
    });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "No figures could be fetched." });

  const anyFailed = outcome.images.length === 0 && outcome.skipped.length > 0;
  const summary = `Book ${numericId} (${fmt}): returned ${outcome.images.length}/${indexes.length} figures at detail=${args.detail}.`;
  blocks.unshift({ type: "text", text: summary });
  // No structuredContent when images are present: clients drop the whole content
  // array (images included) if structuredContent coexists (anthropics/claude-code
  // #54737/#45575; #80 probe). Everything is mirrored in the text blocks anyway.
  const result =
    outcome.images.length > 0
      ? toolOk(blocks)
      : toolOk(blocks, {
          format: fmt,
          returned,
          skipped: outcome.skipped.map((s) => ({ index: s.index, reason: skipReason(s.reason) })),
          text: summary,
        });
  if (anyFailed) result.isError = true;
  return result;
}

/** Coded reasons → model-actionable prose. */
function skipReason(reason: string): string {
  switch (reason) {
    case "FIGURES_NO_POPPLER":
      return "poppler is missing (brew install poppler) — needed to extract PDF figures.";
    case "FIGURES_NO_QLMANAGE":
      return "this SVG figure needs macOS qlmanage to rasterize, which is unavailable here.";
    case "FIGURES_FETCH_FAILED":
      return "the image could not be extracted from the source file.";
    default:
      return reason;
  }
}

function figuresError(err: unknown, bookId: number, fmt: string) {
  const m = err instanceof Error ? err.message : String(err);
  switch (m) {
    case "FIGURES_NO_POPPLER":
      return toolError(
        "No poppler tools found (pdfimages/pdftotext) — install with `brew install poppler` to scan PDF figures.",
      );
    case "FIGURES_NO_UNZIP":
      return toolError("No unzip binary found — needed to scan EPUB figures.");
    case "FIGURES_FORMAT_UNSUPPORTED":
      return toolError(`Figures need an EPUB or PDF source; ${fmt} is not supported.`);
    case "FIGURES_SCAN_TIMEOUT":
      return toolError(`Figure scan timed out for book ${bookId} (${fmt}) — the file may be very large.`);
    case "FIGURES_SCAN_FAILED":
      return toolError(
        `Could not scan book ${bookId} (${fmt}) for figures — the file may be DRM-protected or corrupt.`,
      );
    default:
      return toolError(m);
  }
}

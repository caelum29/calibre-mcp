// calibre_list_categories — browse the library's Tag-Browser categories. With no field
// it lists the categories (Authors, Tags, Series, …); with a field it lists that
// category's values + book counts, optionally filtered by a regex and paginated.

import { z } from "zod";
import { matchCategory } from "../calibre/content-server.js";
import { CursorParam, limitParam } from "./coerce.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk } from "./result.js";
import { compileUserRegex } from "./user-regex.js";

// Pull a generous page when filtering client-side; categories above this are truncated.
const FILTER_FETCH_NUM = 10_000;

export const listCategoriesTool = defineTool({
  name: "calibre_list_categories",
  title: "List categories",
  description:
    "Browse library categories (Authors, Tags, Series, Languages, Publisher). No field → list the categories; with a field → its values + counts, filterable via a valueFilter regex (case-insensitive by default; a leading inline flag like `(?i)` is accepted).",
  inputSchema: {
    field: z.string().optional(),
    valueFilter: z.string().max(200).optional(),
    library: z.string().optional(),
    limit: limitParam(200, 100),
    cursor: CursorParam,
  },
  outputSchema: {
    mode: z.enum(["fields", "values"]).optional(),
    field: z.string().optional(),
    values: z.array(z.object({ name: z.string(), count: z.number().optional() })).optional(),
    total: z.number().optional(),
    offset: z.number().optional(),
    count: z.number().optional(),
    nextCursor: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    try {
      const cats = await deps.content.categories(args.library);

      // No field → list the categories themselves.
      if (!args.field) {
        const fields = cats.filter((c) => c.name).map((c) => ({ name: c.name, count: c.count }));
        const text = "Categories: " + fields.map((f) => f.name).join(", ");
        return toolOk([{ type: "text", text: fence("CATEGORY FIELDS", text) }], {
          mode: "fields",
          values: fields,
          total: fields.length,
          count: fields.length,
        });
      }

      const node = matchCategory(cats, args.field);
      if (!node) {
        const names = cats.map((c) => c.name).filter(Boolean).join(", ");
        return toolError(`Unknown category "${args.field}". Available: ${names}`);
      }

      let items: { name: string; count?: number }[];
      let total: number;
      let offset: number;
      let cursorKey: string;

      if (args.valueFilter) {
        const compiled = compileUserRegex(args.valueFilter);
        if (!compiled.regex) {
          return toolError(`Invalid valueFilter regex: ${compiled.error}`);
        }
        const re = compiled.regex;
        // Filter client-side over a large page, then paginate the matches.
        const page = await deps.content.categoryItemsByUrl(node.url, { num: FILTER_FETCH_NUM, offset: 0 });
        const filtered = page.items.filter((it) => re.test(it.name));
        cursorKey = `${node.name}::${args.valueFilter}`;
        const cur = decodeCursor(args.cursor);
        offset = cur && cur.query === cursorKey ? cur.offset : 0;
        total = filtered.length;
        items = filtered.slice(offset, offset + args.limit).map((it) => ({ name: it.name, count: it.count }));
      } else {
        cursorKey = node.name;
        const cur = decodeCursor(args.cursor);
        offset = cur && cur.query === cursorKey ? cur.offset : 0;
        const page = await deps.content.categoryItemsByUrl(node.url, { num: args.limit, offset });
        total = page.total;
        items = page.items.map((it) => ({ name: it.name, count: it.count }));
      }

      const fetched = items.length;
      const more = offset + fetched < total;
      const nextCursor = more ? encodeCursor({ offset: offset + fetched, query: cursorKey }) : undefined;
      const lines = items
        .map((it) => `${it.name}${it.count !== undefined ? ` (${it.count})` : ""}`)
        .join("\n");
      const text = `${node.name}: ${total} values, showing ${offset + 1}–${offset + fetched}\n${lines}`;

      return toolOk([{ type: "text", text: fence("CATEGORY VALUES", text) }], {
        mode: "values",
        field: node.name,
        values: items,
        total,
        offset,
        count: fetched,
        nextCursor,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
  },
});

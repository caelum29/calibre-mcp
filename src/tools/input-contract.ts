// The input side of the error contract (#590/#591). The SDK validates arguments before any handler
// runs and answers a violation with its own bare text, so the registered schema never fails: it hands
// the handler wrapper a verdict instead — a schema violation becomes `Code: invalid_input`, and a limit
// param that fell back says so. Parsing (and its -32602 coercion) and the advertised JSON Schema are
// exactly the tool's Zod shape; only the failure path moves. SDK-free: Standard Schema is structural.

import { z } from "zod";
import { limitNote, limitParamBounds } from "./coerce.js";
import { toolError } from "./result.js";
import type { ToolResult } from "./types.js";

/** What validation found about one call's arguments, beyond the parsed values. */
export interface InputVerdict {
  /** The schema violation, as `path: message` pairs; the handler must not run. */
  invalid?: string;
  /** One line per limit param that did not get the value the caller sent (#591). */
  paramNotes?: string[];
}

// parsed args object → its verdict; the SDK hands the validated value to the handler unchanged
const VERDICTS = new WeakMap<object, InputVerdict>();

/** The verdict recorded for parsed `args`, if validation found anything. */
export function inputVerdict(args: unknown): InputVerdict | undefined {
  return typeof args === "object" && args !== null ? VERDICTS.get(args) : undefined;
}

/**
 * The tool's input schema with a failure path that never fails: an invalid call validates to an
 * empty args object carrying `invalid`, so {@link refuseInvalidInput} can answer it in-contract.
 * `~standard.jsonSchema` is the Zod object's own, so tools/list advertises the same schema.
 */
export function tolerantInputSchema(shape: z.ZodRawShape) {
  const object = z.object(shape);
  const std = object["~standard"];
  const validate: typeof std.validate = (raw) => {
    const parsed = object.safeParse(raw);
    if (!parsed.success) {
      const invalid = parsed.error.issues
        .map((i) => `${i.path.length ? i.path.join(".") : "arguments"}: ${i.message}`)
        .join("; ");
      const value = {} as z.output<typeof object>;
      VERDICTS.set(value, { invalid });
      return { value };
    }
    const paramNotes = limitNotes(shape, raw, parsed.data);
    if (paramNotes.length) VERDICTS.set(parsed.data, { paramNotes });
    return { value: parsed.data };
  };
  return { "~standard": { ...std, validate } } as Pick<typeof object, "~standard">;
}

function limitNotes(shape: z.ZodRawShape, raw: unknown, parsed: Record<string, unknown>): string[] {
  const rawArgs = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const notes: string[] = [];
  for (const [name, schema] of Object.entries(shape)) {
    const bounds = limitParamBounds(schema);
    if (!bounds || parsed[name] === undefined) continue;
    const note = limitNote(name, rawArgs[name], bounds);
    if (note) notes.push(note);
  }
  return notes;
}

const INVALID_INPUT_HINT = "fix the named argument to match the tool's input schema, then call again";

/** The in-contract error for a call whose arguments failed the schema, or undefined to run it. */
export function refuseInvalidInput(toolName: string, args: unknown): ToolResult | undefined {
  const invalid = inputVerdict(args)?.invalid;
  if (invalid === undefined) return undefined;
  return toolError("invalid_input", `Invalid arguments for ${toolName} — ${invalid}`, { hint: INVALID_INPUT_HINT });
}

/** Does this input shape have a limit param, so its results may carry `paramNotes`? */
export function hasLimitParam(shape: z.ZodRawShape): boolean {
  return Object.values(shape).some((s) => limitParamBounds(s) !== undefined);
}

/** The outputSchema field mirroring the fallback lines (#591), for tools with a limit param. */
export const PARAM_NOTES_OUTPUT = {
  paramNotes: z
    .array(z.string())
    .optional()
    .describe("A line per limit param that fell back to its default or max instead of the value sent"),
};

/** Add the call's fallback lines to the text (both clients read it) and to structuredContent. */
export function withParamNotes(args: unknown, result: ToolResult): ToolResult {
  const notes = inputVerdict(args)?.paramNotes;
  if (!notes?.length) return result;
  return {
    ...result,
    content: [...result.content, { type: "text", text: notes.join("\n") }],
    structuredContent: { ...result.structuredContent, paramNotes: notes },
  };
}

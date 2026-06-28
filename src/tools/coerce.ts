// The -32602 hardening layer (DESIGN §3). Buggy clients forward tool args with ZERO
// type coercion, so stringified numbers/arrays/objects reach us as strings. These Zod
// helpers coerce BEFORE validation and are deliberately TOLERANT — bad input degrades
// to a sane value instead of throwing a -32602 back at the model.

import { z } from "zod";

/** JSON.parse a string arg if it looks like JSON; otherwise pass through unchanged. */
function parseIfString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // let the inner schema produce a meaningful (non -32602) error
  }
}

/** Coerced integer (`"42"` → 42). */
export const CoercedInt = (): z.ZodType<number> => z.coerce.number().int();

/** Coerced number (`"4.5"` → 4.5). */
export const CoercedNumber = (): z.ZodType<number> => z.coerce.number();

/**
 * Book id as either a coerced integer (db id) or a non-empty string (uuid). Numeric
 * strings become numbers; anything non-numeric stays a string for uuid resolution.
 */
export const BookId = (): z.ZodType<number | string> =>
  z.union([z.coerce.number().int(), z.string().min(1)]);

/** Array arg that may arrive as a JSON string (`'["a","b"]'` → ["a","b"]). */
export function jsonArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(parseIfString, z.array(item));
}

/** Object arg that may arrive as a JSON string. */
export function jsonObject<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess(parseIfString, z.object(shape));
}

/** Open-keyed record arg that may arrive as a JSON string (`'{"a":"b"}'` → {a:"b"}). */
export function jsonRecord<V extends z.ZodTypeAny>(value: V) {
  return z.preprocess(parseIfString, z.record(z.string(), value));
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

/**
 * SAFE boolean coercion. NEVER use z.coerce.boolean() — it treats the string "false"
 * as true (CLAUDE.md). Here "false"/"0"/"no"/"" → false explicitly.
 */
export const CoercedBool = (): z.ZodType<boolean> =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (TRUTHY.has(s)) return true;
      if (FALSY.has(s)) return false;
    }
    return v; // unrecognized → let z.boolean() reject
  }, z.boolean());

/** Page-size param: coerce → int → clamp to [1, max]; default `def` when omitted/garbage. */
export function limitParam(max: number, def: number) {
  return z
    .preprocess((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(max, Math.max(1, Math.trunc(n)));
    }, z.number().int())
    .default(def);
}

/** Opaque pagination cursor — a raw string we mint and decode ourselves (see cursor.ts). */
export const CursorParam = z.string().optional();

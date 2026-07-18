// Compile a model/user-supplied regex. Callers habitually reach for PCRE/Python
// inline flags like `(?i)`, which JS RegExp rejects with "Invalid group" — we strip
// a leading inline-flag group and fold it into the RegExp flags argument instead.

/** Inline flags JS can express as RegExp flags. `x` (extended) has no JS equivalent. */
const SUPPORTED_INLINE_FLAGS = "imsu";

const LEADING_INLINE_FLAGS = /^\(\?([a-zA-Z]+)\)/;

export interface CompileRegexResult {
  regex?: RegExp;
  error?: string;
}

/**
 * Compile a user-supplied pattern, accepting leading PCRE-style inline flags.
 *
 * @param pattern raw pattern, e.g. `(?i)o.?reilly|packt`
 * @param defaultFlags flags always applied (matching is case-insensitive by default)
 */
export function compileUserRegex(pattern: string, defaultFlags = "i"): CompileRegexResult {
  let body = pattern;
  const flags = new Set(defaultFlags);

  // Consume any run of leading `(?flags)` groups.
  for (;;) {
    const m = LEADING_INLINE_FLAGS.exec(body);
    if (!m?.[1]) break;
    const inline = m[1];
    for (const f of inline) {
      if (!SUPPORTED_INLINE_FLAGS.includes(f)) {
        return { error: `unsupported inline flag "(?${inline})" — JS regex supports ${SUPPORTED_INLINE_FLAGS.split("").join(", ")}` };
      }
      flags.add(f);
    }
    body = body.slice(m[0].length);
  }

  try {
    return { regex: new RegExp(body, [...flags].join("")) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
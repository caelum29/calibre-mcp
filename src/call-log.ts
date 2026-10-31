// Per-tool-call log record (#247): wraps a handler so every call ends with one
// `tool call` line (durationMs, isError, errorCode, args summary) and every line logged during
// the call carries the same `call` id. SDK-free — server.ts applies it at registration.

import { randomBytes } from "node:crypto";
import { capArray, capString, type Logger } from "./logging.js";

const ARG_STRING_MAX = 120;
const ARG_ARRAY_MAX = 10;
const ERROR_TEXT_MAX = 300;

/**
 * Content-free view of tool args: numbers/booleans as-is, short strings verbatim (ids, queries,
 * modes), longer strings as their length only — those are free text (a `comments` edit, a
 * description) that a log must not carry. Arrays keep the first few primitives, nested
 * objects shrink to their key names.
 */
export function summarizeArgs(args: unknown): Record<string, unknown> | undefined {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    out[k] = summarizeValue(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function summarizeValue(v: unknown): unknown {
  if (typeof v === "string") return v.length > ARG_STRING_MAX ? `[text, ${v.length} chars]` : v;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    return capArray(v, ARG_ARRAY_MAX, (x) => (x !== null && typeof x === "object" ? "{…}" : summarizeValue(x)));
  }
  return { keys: Object.keys(v) };
}

/**
 * calibredb argv for a log line: flags and short tokens verbatim, long tokens (a free-text
 * query, a metadata value) as their length only — same rule as the tool-args summary, so an
 * inner `calibredb failed` line can't leak what the closing `tool call` record redacted.
 */
export function summarizeArgv(argv: readonly string[]): unknown[] {
  return argv.map((a) => summarizeValue(a));
}

/**
 * Scrub a subprocess's output of the argv values `summarizeArgv` redacted — calibredb echoes
 * the query in its errors ("Failed to parse search query: <query>"), which would otherwise
 * put the redacted text right back into the same log line.
 */
export function redactArgvEchoes(text: string, argv: readonly string[]): string {
  let out = text;
  for (const a of argv) {
    if (a.length > ARG_STRING_MAX) out = out.split(a).join(`[text, ${a.length} chars]`);
  }
  return out;
}

/** Short random id; unique enough to correlate one call's lines within a day's file. */
export function newCallId(): string {
  return randomBytes(4).toString("hex");
}

interface ResultLike {
  isError?: boolean;
  structuredContent?: unknown;
  content?: ReadonlyArray<{ type: string; text?: string }>;
}

/** What identifies one tool call in the log. */
export interface CallLogOptions {
  tool: string;
  args: unknown;
  /** JSON-RPC request id — joins our record with the client's own MCP log. */
  rpcId?: string | number;
  /** W3C `traceparent` from the request's _meta — logged as traceId/parentSpanId (#249). */
  traceparent?: string;
  now?: () => number;
}

/** Run one tool call inside a log context and close it with the `tool call` record. */
export async function withCallLog<R extends ResultLike>(
  log: Logger,
  opts: CallLogOptions,
  run: () => Promise<R>,
): Promise<R> {
  const { tool, args } = opts;
  const now = opts.now ?? (() => performance.now());
  const call = newCallId();
  return log.withContext({ tool, call }, async () => {
    const t0 = now();
    let result: R | undefined;
    try {
      result = await run();
      return result;
    } finally {
      const isError = result?.isError === true;
      const errorCode = isError ? stringField(result?.structuredContent, "errorCode") : undefined;
      const hint = isError ? stringField(result?.structuredContent, "hint") : undefined;
      const meta = {
        durationMs: Math.round(now() - t0),
        ...(opts.rpcId === undefined ? {} : { rpcId: opts.rpcId }),
        ...parseTraceparent(opts.traceparent),
        isError,
        ...(errorCode ? { errorCode } : {}),
        ...(hint ? { hint } : {}),
        // The steer text the model saw — what an agent needs to explain the failure.
        ...(isError ? { error: errorTextOf(result) } : {}),
        ...(result === undefined ? { threw: true } : {}),
        args: summarizeArgs(args),
      };
      // An isError result is the model's to handle — warn, not error; ping's ring keeps
      // only the server-side failures logged at error level.
      if (isError || result === undefined) log.warn("tool call", meta);
      else log.info("tool call", meta);
    }
  });
}

function errorTextOf(r: ResultLike | undefined): string | undefined {
  const text = r?.content?.find((b) => b.type === "text")?.text;
  return text === undefined ? undefined : capString(text, ERROR_TEXT_MAX);
}

function stringField(sc: unknown, key: "errorCode" | "hint"): string | undefined {
  if (sc === null || typeof sc !== "object" || !(key in sc)) return undefined;
  const v = (sc as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

// version-traceId-parentId-flags; all-zero ids are invalid per W3C Trace Context.
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/;

/** traceId + parentSpanId from a W3C traceparent; nothing for a missing or malformed one. */
export function parseTraceparent(tp: string | undefined): { traceId?: string; parentSpanId?: string } {
  const m = tp === undefined ? null : TRACEPARENT.exec(tp.trim().toLowerCase());
  if (!m || /^0+$/.test(m[1]!) || /^0+$/.test(m[2]!)) return {};
  return { traceId: m[1], parentSpanId: m[2] };
}

// Per-tool-call log record (#247): wraps a handler so every call ends with one
// `tool call` line (ms, isError, errorCode, args summary) and every line logged during the
// call carries the same `call` id. SDK-free — server.ts applies it at registration.

import { randomBytes } from "node:crypto";
import type { Logger } from "./logging.js";

const ARG_STRING_MAX = 120;
const ARG_ARRAY_MAX = 10;

/**
 * Short, content-free view of tool args: numbers/booleans as-is, strings capped (queries are
 * useful, long free text is not), arrays as the first few primitives + count, nested
 * objects reduced to their key names. Never carries book text — tool args don't contain it,
 * and the caps stop a long `comments` edit from bloating the line.
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
  if (typeof v === "string") return v.length > ARG_STRING_MAX ? `${v.slice(0, ARG_STRING_MAX)}…(${v.length} chars)` : v;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    const head = v
      .slice(0, ARG_ARRAY_MAX)
      .map((x) => (x !== null && typeof x === "object" ? "{…}" : summarizeValue(x)));
    return v.length > ARG_ARRAY_MAX ? [...head, `…(${v.length} total)`] : head;
  }
  return { keys: Object.keys(v) };
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

export interface CallLogOptions {
  tool: string;
  args: unknown;
  /** JSON-RPC request id — joins our record with the client's own MCP log. */
  rpcId?: string | number;
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
      const errorCode = isError ? errorCodeOf(result?.structuredContent) : undefined;
      const meta = {
        durationMs: Math.round(now() - t0),
        ...(opts.rpcId === undefined ? {} : { rpcId: opts.rpcId }),
        isError,
        ...(errorCode ? { errorCode } : {}),
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
  return text === undefined ? undefined : text.slice(0, 300);
}

function errorCodeOf(sc: unknown): string | undefined {
  if (sc === null || typeof sc !== "object") return undefined;
  const code = (sc as { errorCode?: unknown }).errorCode;
  return typeof code === "string" ? code : undefined;
}

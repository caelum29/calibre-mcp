// stderr-only logger. stdout is reserved for the JSON-RPC stream on stdio —
// a single console.log here would corrupt the protocol (DESIGN §7).

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: unknown): void {
  const line = meta === undefined ? msg : `${msg} ${safeJson(meta)}`;
  // Always stderr, never stdout.
  process.stderr.write(`[calibre-mcp] ${level.toUpperCase()} ${line}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
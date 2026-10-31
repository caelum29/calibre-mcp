// Structured JSONL logger whose only readers are agents (#247): one self-contained JSON
// object per line, stable keys, bounded size, every line of a tool call tagged with the same
// `call` id. Sinks: stderr (always — stdout is the JSON-RPC stream) + an optional daily file.

import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ERROR_CODES, SERVER_FAULT_CODES } from "./domain/error-codes.js";

export type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One log line. Key order is fixed so agents can rely on `ts lvl msg` coming first. */
export interface LogRecord {
  ts: string;
  lvl: Level;
  msg: string;
  pid: number;
  client?: string;
  tool?: string;
  call?: string;
  meta?: unknown;
}

/** The four level methods — all that handlers and services need (and what tests fake). */
export interface LogSink {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** Per-call context carried through async work, so deep code needn't thread it by hand. */
export interface LogContext {
  tool: string;
  call: string;
}

/** Level + file-sink settings applied by the process entry points. */
export interface LoggingOptions {
  /** Minimum level emitted to every sink (CALIBRE_MCP_LOG_LEVEL). */
  level?: Level;
  /** Directory for daily JSONL files; null/undefined = no file sink. */
  dir?: string | null;
}

/** Injectable I/O so tests control stderr and the clock. */
export interface LoggerIo {
  stderr?: (s: string) => void;
  now?: () => Date;
}

/** The process logger: level methods plus configuration and diagnostics. */
export interface Logger extends LogSink {
  /** Set level + file sink. Safe to call again (e.g. the reindex script after the server). */
  configure(opts: LoggingOptions): void;
  /** Record the MCP client name (from initialize.clientInfo) on every later line. */
  setClient(name: string | undefined): void;
  /** Run `fn` with every log line inside it tagged {tool, call}. */
  withContext<T>(c: LogContext, fn: () => T): T;
  /** Last error-level records, oldest first (for calibre_ping self-diagnosis). */
  recentErrors(): LogRecord[];
  /** Today's log file, or null when the file sink is off. */
  currentFile(): string | null;
}

const FILE_PREFIX = "calibre-mcp-";
const FILE_RE = new RegExp(`^${FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`);
/** Daily files kept, today included. */
export const RETENTION_DAYS = 7;
export const RECENT_ERRORS_MAX = 20;
const STRING_MAX = 500;
const ARRAY_MAX = 20;
const DEPTH_MAX = 4;
const STACK_FRAMES = 6;
const DAY_MS = 86_400_000;

/** Parse CALIBRE_MCP_LOG_LEVEL tolerantly; anything unknown falls back to info. */
export function parseLevel(v: string | undefined): Level {
  const t = v?.trim().toLowerCase();
  return t === "debug" || t === "info" || t === "warn" || t === "error" ? t : "info";
}

// One truncation marker format everywhere, so agents can grep a single pattern.
/** Cut `s` to `max` chars with a `…(+N chars)` tail. */
export function capString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

/** Keep the first `max` items (mapped) and append a `…(+N items)` marker when cut. */
export function capArray<T>(a: readonly T[], max: number, map: (x: T) => unknown): unknown[] {
  const head = a.slice(0, max).map(map);
  return a.length > max ? [...head, `…(+${a.length - max} items)`] : head;
}

/**
 * Bound a value for a log line: long strings and arrays capped, Errors flattened to
 * {name, message, stack (first frames)} — JSON.stringify(Error) is `{}`. Agents read logs
 * through a context window, so one runaway field must not eat it.
 */
export function boundValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return capString(redactHome(value), STRING_MAX);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: boundValue(value.message, depth + 1),
      ...(value.stack ? { stack: trimStack(value.stack) } : {}),
    };
  }
  if (depth >= DEPTH_MAX) return "[depth limit]";
  if (Array.isArray(value)) return capArray(value, ARRAY_MAX, (v) => boundValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = k === "stack" && typeof v === "string" ? trimStack(v) : boundValue(v, depth + 1);
  }
  return out;
}

const HOME = homedir();

// The user's home path is PII-ish and pure noise for diagnosis — `~` says the same.
function redactHome(s: string): string {
  return HOME.length > 1 && s.includes(HOME) ? s.split(HOME).join("~") : s;
}

// Frames past the first few are node internals — noise for diagnosis.
function trimStack(stack: string): string {
  const lines = redactHome(stack).split("\n");
  const kept = lines.slice(0, STACK_FRAMES + 1).map((l) => l.trim());
  return lines.length > kept.length ? `${kept.join(" | ")} | …` : kept.join(" | ");
}

function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Path of the daily file for `d` inside `dir`. */
export function logFilePath(dir: string, d: Date = new Date()): string {
  return path.join(dir, `${FILE_PREFIX}${dayStamp(d)}.jsonl`);
}

/**
 * Delete daily files older than the retention window (today + RETENTION_DAYS-1 earlier days
 * survive). Per-file errors are swallowed: several server processes share the dir and may
 * race to delete the same file — losing that race must not disable anyone's sink.
 */
function pruneOldFiles(dir: string, today: Date): void {
  const cutoff = dayStamp(new Date(today.getTime() - (RETENTION_DAYS - 1) * DAY_MS));
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const day = FILE_RE.exec(f)?.[1];
    if (day === undefined || day >= cutoff) continue;
    try {
      unlinkSync(path.join(dir, f));
    } catch {
      // already gone (another process won) or not deletable — not our problem
    }
  }
}

// Written next to the log files so an agent that lands in the dir learns the schema there.
const README = `# calibre-mcp logs (for agents)

One JSON object per line, daily files \`${FILE_PREFIX}YYYY-MM-DD.jsonl\` (UTC), the last ${RETENTION_DAYS} days kept.
Every server process (Claude Desktop, Claude Code, \`pnpm reindex\`) appends here; tell them apart by \`pid\`/\`client\`.

Keys (fixed order): ts (ISO UTC), lvl (debug|info|warn|error), msg (stable event text — grep it),
pid, client (MCP clientInfo.name), tool + call (set on every line emitted inside a tool call;
\`call\` correlates them), meta (event fields; Errors as {name,message,stack}).
Truncation is always marked: strings \`…(+N chars)\` (cap ${STRING_MAX}), arrays \`…(+N items)\`.

One \`msg:"tool call"\` line closes every tool call: meta = {durationMs, rpcId (JSON-RPC id — joins the client's MCP log),
traceId? + parentSpanId? (from the client's W3C traceparent in _meta), isError, errorCode?, hint? (generic next step),
error? (the steer text the model got), threw?, args}.
errorCode is one of: ${ERROR_CODES.join(", ")}.
args is a summary: numbers/booleans as-is, short strings verbatim, long free text as its length only, objects as key names.
isError results log at warn (the model fixes them by changing its call) — except server faults, which log at error:
errorCode ${SERVER_FAULT_CODES.join(", ")}. Every error-level line (those faults, \`tool threw\`,
inner failures such as \`calibredb failed\`) is what calibre_ping.recentErrors shows, so one fault may appear twice there
(the inner line with its details, then the closing \`tool call\` line with errorCode + hint).
The home dir is written as \`~\`. Lines may contain book titles, ids and search queries — never book text.

Recipes:
- errors today:            jq -c 'select(.lvl=="error")' ${FILE_PREFIX}$(date -u +%F).jsonl
- one call's full story:   jq -c 'select(.call=="<id>")' ${FILE_PREFIX}*.jsonl
- slow or failed calls:    jq -c 'select(.msg=="tool call" and (.meta.isError or .meta.durationMs>10000))' ${FILE_PREFIX}*.jsonl
- failures by code:        jq -r 'select(.msg=="tool call" and .meta.isError) | .meta.errorCode' ${FILE_PREFIX}*.jsonl | sort | uniq -c
- per-tool error counts:   jq -r 'select(.lvl=="error") | .tool // "-"' ${FILE_PREFIX}*.jsonl | sort | uniq -c

The last ${RECENT_ERRORS_MAX} errors of the running process are in calibre_ping (recentErrors) without file access.

OpenTelemetry names (best-effort — the OTel MCP semconv is still Development status):
| ours | OTel |
|---|---|
| ts | timestamp |
| lvl | severity_text |
| msg | body / event.name |
| tool | gen_ai.tool.name |
| meta.rpcId | jsonrpc.request.id |
| meta.durationMs | mcp.server.operation.duration (ms here, s in OTel) |
| meta.errorCode | error.type (OTel: tool_error on any isError result; ours is finer) |
| meta.traceId / meta.parentSpanId | trace_id / parent span_id |
| client | client / MCP clientInfo.name |
`;

/** Build a logger; the module exports one shared `log` built from this. */
export function createLogger(io: LoggerIo = {}): Logger {
  const writeStderr = io.stderr ?? ((s: string) => void process.stderr.write(s));
  const now = io.now ?? (() => new Date());
  const ctx = new AsyncLocalStorage<LogContext>();
  const recent: LogRecord[] = [];
  let minRank = LEVEL_RANK.info;
  let dir: string | null = null;
  let fileDay = "";
  let client: string | undefined;
  let fileBroken = false;

  function fileWrite(line: string, at: Date): void {
    if (!dir || fileBroken) return;
    try {
      // Long-lived servers (Desktop stays up for weeks) prune on each day rollover, not just at boot.
      const day = dayStamp(at);
      if (day !== fileDay) {
        fileDay = day;
        pruneOldFiles(dir, at);
      }
      appendFileSync(logFilePath(dir, at), line);
    } catch (err) {
      // Logging must never fail a tool call: drop the file sink, warn once on stderr.
      fileBroken = true;
      writeStderr(
        `[calibre-mcp] ${JSON.stringify({ lvl: "warn", msg: "log file sink disabled", meta: boundValue(err) })}\n`,
      );
    }
  }

  function emit(lvl: Level, msg: string, meta?: unknown): void {
    if (LEVEL_RANK[lvl] < minRank) return;
    const at = now();
    const c = ctx.getStore();
    const rec: LogRecord = {
      ts: at.toISOString(),
      lvl,
      msg,
      pid: process.pid,
      ...(client ? { client } : {}),
      ...(c ? { tool: c.tool, call: c.call } : {}),
      ...(meta === undefined ? {} : { meta: boundValue(meta) }),
    };
    let json: string;
    try {
      json = JSON.stringify(rec);
    } catch {
      json = JSON.stringify({ ...rec, meta: "[unserializable]" });
    }
    // Prefix keeps our lines greppable inside host logs (Desktop main.log mixes every server).
    writeStderr(`[calibre-mcp] ${json}\n`);
    fileWrite(`${json}\n`, at);
    if (lvl === "error") {
      recent.push(rec);
      if (recent.length > RECENT_ERRORS_MAX) recent.shift();
    }
  }

  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),

    configure(opts) {
      minRank = LEVEL_RANK[opts.level ?? "info"];
      dir = null;
      fileDay = "";
      fileBroken = false;
      if (!opts.dir) return;
      try {
        mkdirSync(opts.dir, { recursive: true });
        writeFileSync(path.join(opts.dir, "README.md"), README); // rewritten each start: tracks the running version
        dir = opts.dir;
      } catch (err) {
        emit("warn", "log file sink unavailable", { dir: opts.dir, err });
      }
    },

    setClient(name) {
      client = name || undefined;
    },

    withContext(c, fn) {
      return ctx.run(c, fn);
    },

    recentErrors() {
      return [...recent];
    },

    currentFile() {
      return dir && !fileBroken ? logFilePath(dir, now()) : null;
    },
  };
}

/** Process-wide logger. Unconfigured = info level, stderr only (tests, catalog generator). */
export const log: Logger = createLogger();

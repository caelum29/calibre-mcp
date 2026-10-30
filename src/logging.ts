// Structured JSONL logger whose only readers are agents (#247): one self-contained JSON
// object per line, stable keys, bounded size, every line of a tool call tagged with the same
// `call` id. Sinks: stderr (always — stdout is the JSON-RPC stream) + an optional daily file.

import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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

export interface LoggingOptions {
  /** Minimum level emitted to every sink (CALIBRE_MCP_LOG_LEVEL). */
  level?: Level;
  /** Directory for daily JSONL files; null/undefined = no file sink. */
  dir?: string | null;
  /** Days of daily files to keep (older ones are pruned at configure time). */
  retentionDays?: number;
}

const FILE_PREFIX = "calibre-mcp-";
const RECENT_ERRORS_MAX = 20;
const STRING_MAX = 500;
const ARRAY_MAX = 20;
const DEPTH_MAX = 4;
const STACK_FRAMES = 6;

/** Parse CALIBRE_MCP_LOG_LEVEL tolerantly; anything unknown falls back to info. */
export function parseLevel(v: string | undefined): Level {
  const t = v?.trim().toLowerCase();
  return t === "debug" || t === "info" || t === "warn" || t === "error" ? t : "info";
}

/**
 * Bound a value for a log line: long strings cut with a "+N chars" tail, arrays capped,
 * Errors flattened to {name, message, stack (first frames)} — JSON.stringify(Error) is `{}`.
 * Agents read logs through a context window, so one runaway field must not eat it.
 */
export function boundValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const v = redactHome(value);
    return v.length > STRING_MAX ? `${v.slice(0, STRING_MAX)}…(+${v.length - STRING_MAX} chars)` : v;
  }
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
  if (Array.isArray(value)) {
    const head = value.slice(0, ARRAY_MAX).map((v) => boundValue(v, depth + 1));
    return value.length > ARRAY_MAX ? [...head, `…(+${value.length - ARRAY_MAX} items)`] : head;
  }
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

// Written next to the log files so an agent that lands in the dir learns the schema there.
const README = `# calibre-mcp logs (for agents)

One JSON object per line, daily files \`calibre-mcp-YYYY-MM-DD.jsonl\` (UTC), 7-day retention.
Every server process (Claude Desktop, Claude Code, \`pnpm reindex\`) appends here; tell them apart by \`pid\`/\`client\`.

Keys (fixed order): ts (ISO UTC), lvl (debug|info|warn|error), msg (stable event text — grep it),
pid, client (MCP clientInfo.name), tool + call (set on every line emitted inside a tool call;
\`call\` correlates them), meta (event fields; strings capped at ${STRING_MAX} chars, Errors as {name,message,stack}).

One \`msg:"tool call"\` line closes every tool call: meta = {durationMs, rpcId (JSON-RPC id — joins the client's MCP log),
isError, errorCode?, error? (the steer text the model got), threw?, args (summary; strings capped, never book text)}.
isError results log at warn (the model handles them); server-side failures log at error.
The home dir is written as \`~\`. Lines may contain book titles, ids and search queries.

Recipes:
- errors today:            jq -c 'select(.lvl=="error")' calibre-mcp-$(date -u +%F).jsonl
- one call's full story:   jq -c 'select(.call=="<id>")' calibre-mcp-*.jsonl
- slow or failed calls:    jq -c 'select(.msg=="tool call" and (.meta.isError or .meta.durationMs>10000))' calibre-mcp-*.jsonl
- per-tool error counts:   jq -r 'select(.lvl=="error") | .tool // "-"' calibre-mcp-*.jsonl | sort | uniq -c

The same last ${RECENT_ERRORS_MAX} errors are in calibre_ping (recentErrors) without file access.
`;

/** Logger instance; the module exports one shared `log` built from this. */
export function createLogger(io: { stderr?: (s: string) => void; now?: () => Date } = {}) {
  const writeStderr = io.stderr ?? ((s: string) => void process.stderr.write(s));
  const now = io.now ?? (() => new Date());
  const ctx = new AsyncLocalStorage<LogContext>();
  const recent: LogRecord[] = [];
  let minRank = LEVEL_RANK.info;
  let dir: string | null = null;
  let client: string | undefined;
  let fileBroken = false;

  function fileWrite(line: string, at: Date): void {
    if (!dir || fileBroken) return;
    try {
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

  function prune(d: string, retentionDays: number): void {
    const cutoff = dayStamp(new Date(now().getTime() - retentionDays * 86_400_000));
    for (const f of readdirSync(d)) {
      const m = /^calibre-mcp-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1]! < cutoff) unlinkSync(path.join(d, f));
    }
  }

  return {
    debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
    info: (msg: string, meta?: unknown) => emit("info", msg, meta),
    warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
    error: (msg: string, meta?: unknown) => emit("error", msg, meta),

    /** Set level + file sink. Safe to call again (e.g. the reindex script after the server). */
    configure(opts: LoggingOptions): void {
      minRank = LEVEL_RANK[opts.level ?? "info"];
      dir = null;
      fileBroken = false;
      if (!opts.dir) return;
      try {
        mkdirSync(opts.dir, { recursive: true });
        const readme = path.join(opts.dir, "README.md");
        writeFileSync(readme, README); // rewritten each start so it tracks the running version
        prune(opts.dir, opts.retentionDays ?? 7);
        dir = opts.dir;
      } catch (err) {
        emit("warn", "log file sink unavailable", { dir: opts.dir, err });
      }
    },

    /** Record the MCP client name (from initialize.clientInfo) on every later line. */
    setClient(name: string | undefined): void {
      client = name || undefined;
    },

    /** Run `fn` with every log line inside it tagged {tool, call}. */
    withContext<T>(c: LogContext, fn: () => T): T {
      return ctx.run(c, fn);
    },

    /** Last error-level records, oldest first (for calibre_ping self-diagnosis). */
    recentErrors(): LogRecord[] {
      return [...recent];
    },

    /** Today's log file, or null when the file sink is off. */
    currentFile(): string | null {
      return dir && !fileBroken ? logFilePath(dir, now()) : null;
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Process-wide logger. Unconfigured = info level, stderr only (tests, catalog generator). */
export const log: Logger = createLogger();

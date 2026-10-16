// Graceful shutdown for the stdio entry point. A stdio MCP server's lifetime is its
// client's: when the client closes our stdin (window closed, extension disabled) or
// signals us, we must exit — and take any running calibredb / ebook-convert process
// groups with us. Those are spawned detached (spawn.ts), so without this they outlive
// the server and keep holding the library write lock.

import { killAllChildren } from "./calibre/spawn.js";
import { log } from "./logging.js";

export interface ShutdownDeps {
  /** Close the MCP server/transport. Errors are logged and ignored. */
  close: () => Promise<void>;
  /** Process exit; injectable so tests can observe it instead of dying. */
  exit: (code: number) => void;
  /** Kill tracked child process groups (defaults to spawn.ts' registry). */
  killChildren?: () => number;
  /** Upper bound on how long close() may take before we exit anyway. */
  closeTimeoutMs?: number;
}

/**
 * Build an idempotent shutdown function: the first call kills child process groups,
 * closes the server (bounded by `closeTimeoutMs`) and exits 0; later calls return the
 * same promise. Children are killed FIRST and synchronously, so even a hung close()
 * cannot leave an orphaned worker behind.
 */
export function createShutdown(deps: ShutdownDeps): (reason: string) => Promise<void> {
  const killChildren = deps.killChildren ?? killAllChildren;
  const closeTimeoutMs = deps.closeTimeoutMs ?? 2_000;
  let pending: Promise<void> | undefined;

  return (reason: string) => {
    pending ??= (async () => {
      const killed = killChildren();
      log.info("shutting down", { reason, killedProcessGroups: killed });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, closeTimeoutMs);
        timer.unref();
      });
      try {
        await Promise.race([deps.close(), timeout]);
      } catch (err) {
        log.warn("server close failed during shutdown", {
          msg: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearTimeout(timer);
      }
      deps.exit(0);
    })();
    return pending;
  };
}

/**
 * Wire `shutdown` to the events that end a stdio server's life: SIGINT, SIGTERM,
 * and stdin reaching EOF or closing (the client went away).
 */
export function installShutdownHandlers(
  shutdown: (reason: string) => Promise<void>,
  stdin: NodeJS.ReadableStream = process.stdin,
): void {
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  stdin.once("end", () => void shutdown("stdin-end"));
  stdin.once("close", () => void shutdown("stdin-close"));
}

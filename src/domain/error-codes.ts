// Closed set of tool-error codes (#249). Every toolError carries one, so the `tool call` log
// record (and any agent reading it) groups failures by code instead of by free text. SDK-free.
// OTel MCP semconv sets error.type=tool_error on isError results; our code is the finer value.

import {
  CalibreBusyError,
  CalibreCliError,
  CalibreHttpError,
  CalibreNotFoundError,
  DeadlineExceededError,
  FiguresError,
  FtsError,
  OperationCancelledError,
} from "./errors.js";
import { CONNECTION_STDERR, DROPPED_MID_REQUEST_STDERR, WRITE_REFUSED_STDERR } from "./calibredb-stderr.js";

/** Every code a tool error may carry. Adding one = update the log README table too. */
export const ERROR_CODES = [
  "invalid_input",
  "not_found",
  "path_not_allowed",
  "write_refused",
  "write_failed",
  "write_unverified",
  "calibre_unreachable",
  "calibre_busy",
  "calibre_error",
  "timeout",
  "cancelled",
  "fts_unavailable",
  "index_missing",
  "index_incompatible",
  "index_build_failed",
  "dependency_missing",
  "extraction_failed",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// The server or its environment is broken — the user must fix something outside the chat. These
// isError results log at error, so they reach calibre_ping.recentErrors (#325); the rest are
// requests the model fixes by changing its call (or self-clearing, like busy) and log at warn.
/** Codes whose isError results reach calibre_ping.recentErrors (listed in the log README). */
export const SERVER_FAULT_CODES: readonly ErrorCode[] = [
  "write_refused",
  "write_failed",
  "write_unverified",
  "calibre_unreachable",
  "calibre_error",
  "timeout",
  "index_build_failed",
  "dependency_missing",
  "extraction_failed",
  "internal",
];
const SERVER_FAULTS: ReadonlySet<string> = new Set(SERVER_FAULT_CODES);

/** True when `code` is one of the server-fault codes that calibre_ping.recentErrors must show. */
export function isServerFault(code: string | undefined): boolean {
  return code !== undefined && SERVER_FAULTS.has(code);
}

// Adapter-layer errors (calibre/spawn.ts) matched by name — domain must not import adapters.
const SPAWN_CODES: Record<string, ErrorCode> = {
  SpawnTimeoutError: "timeout",
  SpawnAbortedError: "cancelled",
};

/** Map a thrown error onto the closed set; anything unrecognised is `internal`. */
export function errorCodeFor(err: unknown): ErrorCode {
  if (err instanceof OperationCancelledError) return "cancelled";
  if (err instanceof CalibreBusyError) return "calibre_busy";
  if (err instanceof DeadlineExceededError) return "timeout";
  if (err instanceof FtsError) return err.code === "FTS_DISABLED" ? "fts_unavailable" : "invalid_input";
  if (err instanceof FiguresError) return figuresCode(err);
  if (err instanceof CalibreHttpError) return httpCode(err);
  // Subclasses first: a missing binary and a timeout are both CalibreCliErrors.
  if (err instanceof CalibreNotFoundError) return "dependency_missing";
  if (err instanceof CalibreCliError) return cliCode(err);
  if (err instanceof Error) return SPAWN_CODES[err.name] ?? "internal";
  return "internal";
}

// calibredb's stderr says more than the class: a refusal, a drop that may have committed, or
// a server that never answered (patterns shared with app/write-policy.ts).
function cliCode(err: CalibreCliError): ErrorCode {
  if (err.name === "CalibreCliTimeoutError") return "timeout";
  const stderr = err.stderr ?? "";
  if (WRITE_REFUSED_STDERR.test(stderr)) return "write_refused";
  if (DROPPED_MID_REQUEST_STDERR.test(stderr)) return "write_unverified";
  if (CONNECTION_STDERR.test(stderr)) return "calibre_unreachable";
  return "calibre_error";
}

function httpCode(err: CalibreHttpError): ErrorCode {
  if (err.name === "CalibreHttpTimeoutError") return "timeout";
  if (err.status === 0) return "calibre_unreachable"; // transport failure, no HTTP reply
  if (err.status === 404) return "not_found";
  // Any other 4xx is the request's fault (bad query or params) — the model fixes it, so it must
  // not land in calibre_ping.recentErrors (#325). 401/403 stay faults: we send no credentials,
  // so only a Content Server setting change fixes them.
  if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403) return "invalid_input";
  return "calibre_error";
}

function figuresCode(err: FiguresError): ErrorCode {
  switch (err.code) {
    case "NO_POPPLER":
    case "NO_UNZIP":
    case "NO_QLMANAGE":
      return "dependency_missing";
    case "FORMAT_UNSUPPORTED":
      return "invalid_input";
    case "SCAN_TIMEOUT":
      return "timeout";
    default:
      return "extraction_failed";
  }
}

// The generic next step per code, for the log record when the call site gives no sharper one.
// The model already got the full steer in the message; this is what the file log and
// calibre_ping.recentErrors show next to the code.
const DEFAULT_HINTS: Partial<Record<ErrorCode, string>> = {
  calibre_unreachable: "start it in Calibre (Connect/share → Start Content server) or set CALIBRE_MCP_SERVER_URL",
  calibre_busy: "retry in a few seconds — calibre_ping shows when the library is free",
  write_refused: "restart the Content Server with --enable-local-write (README: Enabling writes)",
  write_unverified: "re-read the book with calibre_get_book before retrying",
  path_not_allowed: "add the folder to CALIBRE_MCP_ADD_ROOTS",
  index_missing: "run calibre_build_index first",
  index_incompatible: "rebuild with calibre_build_index { force: true }",
  dependency_missing: "install the tool the error names, then retry",
  fts_unavailable: "enable full-text indexing in Calibre, or use calibre_search mode=meta",
  timeout: "retry, or narrow the request",
};

/** The default hint for a code, if it has one. */
export function defaultHint(code: ErrorCode): string | undefined {
  return DEFAULT_HINTS[code];
}

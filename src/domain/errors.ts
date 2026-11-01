// SDK-free error types raised by the infrastructure layer. Messages are kept generic
// (no local filesystem paths) so they can surface to the LLM without leaking the host
// layout (DESIGN §3); full detail is logged to stderr at the throw site.

/** A non-2xx response (or transport failure) from the Calibre Content Server. */
export class CalibreHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "CalibreHttpError";
  }
}

/**
 * The Content Server did not answer within the request timeout. Distinct subclass so the
 * busy breaker can tell "Calibre is stalled" apart from "server down" or a non-2xx reply.
 */
export class CalibreHttpTimeoutError extends CalibreHttpError {
  constructor(url: string) {
    super(0, url, "Content Server request timed out");
    this.name = "CalibreHttpTimeoutError";
  }
}

/**
 * Fail-fast refusal while a library is flagged busy after a timeout: Calibre keeps running a
 * request after its client gives up (no cancellation), so piling more work onto it only
 * lengthens the stall. Nothing was sent to Calibre. Deliberately NOT a CalibreCliError /
 * CalibreHttpError subclass, so app/write-policy.ts (timeout verify, transient retry) never treats it as its own.
 */
export class CalibreBusyError extends Error {
  constructor(
    readonly libraryId: string,
    readonly retryInMs: number,
    /** The window ended and another call is checking whether Calibre answers again. */
    readonly probing = false,
  ) {
    super(
      `Calibre is still finishing a previous long request on library "${libraryId}" (probably a ` +
        `full-text search — Calibre can't cancel one once started), so this call was not sent to ` +
        `Calibre. ` +
        (probing
          ? `Another call is checking whether it answers again; retry shortly (that check can take up to ~30 s).`
          : `Retry in ~${Math.max(1, Math.ceil(retryInMs / 1000))} s.`),
    );
    this.name = "CalibreBusyError";
  }
}

/** One tool call's shared time budget ran out before the next Calibre sub-call could start. */
export class DeadlineExceededError extends Error {
  constructor(readonly budgetMs: number) {
    super(`The call's ${Math.round(budgetMs / 1000)} s time budget ran out.`);
    this.name = "DeadlineExceededError";
  }
}

/** Why the Content Server refused a full-text search. */
export type FtsErrorCode = "FTS_DISABLED" | "FTS_QUERY_INVALID";

/**
 * A full-text search refusal with a typed {@link FtsErrorCode}: HTTP 428 = FTS is not enabled
 * on the library, HTTP 422 = SQLite FTS5 couldn't parse the query (user input, #251).
 */
export class FtsError extends Error {
  constructor(
    readonly code: FtsErrorCode,
    readonly libraryId: string,
  ) {
    super(code);
    this.name = "FtsError";
  }
}

/** A non-zero exit (or spawn failure) from a calibredb subprocess. */
export class CalibreCliError extends Error {
  constructor(
    readonly code: number | null,
    message: string,
    /** Raw stderr for caller-side classification (write-refused, FTS-not-ready); never
     *  surfaced to the model verbatim — it can contain local paths. */
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "CalibreCliError";
  }
}

/**
 * calibredb hit the subprocess timeout and its process group was killed. Routed writes
 * commit server-side BEFORE the calibredb client replies, so a timeout is AMBIGUOUS —
 * the write may already be applied. Distinct subclass so write tools verify against a
 * re-read instead of reporting a committed write as failed (issue #33).
 */
export class CalibreCliTimeoutError extends CalibreCliError {
  constructor(message: string) {
    super(null, message);
    this.name = "CalibreCliTimeoutError";
  }
}

/**
 * The calibredb binary itself is missing (spawn ENOENT). Distinct subclass so tool
 * handlers surface the install hint instead of misclassifying it (e.g. as FTS-not-ready).
 * The message deliberately names the probed path — it's the user's own config, and
 * "install Calibre or set CALIBRE_MCP_CALIBREDB_PATH" is the whole point of the error.
 */
export class CalibreNotFoundError extends CalibreCliError {
  constructor(message: string) {
    super(null, message);
    this.name = "CalibreNotFoundError";
  }
}

/**
 * The caller cancelled the operation (MCP notifications/cancelled, or the client went away)
 * and any subprocess or download was stopped. Deliberately NOT a CalibreCliError/HttpError
 * subclass, so callers that classify those don't misreport a cancellation as e.g. "FTS not
 * ready" or "server unreachable".
 */
export class OperationCancelledError extends Error {
  constructor(message = "The operation was cancelled.") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

/** Why a figure scan or fetch failed; the tool maps each code to model-facing prose. */
export type FiguresErrorCode =
  | "NO_POPPLER"
  | "NO_UNZIP"
  | "NO_QLMANAGE"
  | "FORMAT_UNSUPPORTED"
  | "SCAN_TIMEOUT"
  | "SCAN_FAILED"
  | "FETCH_FAILED";

/**
 * A figure scan/fetch failure with a machine-readable {@link FiguresErrorCode}. The message is
 * `FIGURES_<code>` (generic, path-free) so logs and any unmapped surface stay stable.
 */
export class FiguresError extends Error {
  constructor(readonly code: FiguresErrorCode) {
    super(`FIGURES_${code}`);
    this.name = "FiguresError";
  }
}

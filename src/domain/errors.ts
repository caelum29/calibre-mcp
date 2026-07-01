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

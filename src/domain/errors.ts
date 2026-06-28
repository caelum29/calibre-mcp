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

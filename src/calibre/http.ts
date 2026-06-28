// Minimal JSON-over-HTTP helper for the Content Server. Uses Node 24's global fetch
// (no dependency) with an AbortController timeout. Errors are normalized to
// CalibreHttpError with a generic message; the full URL/cause goes to stderr only.

import { CalibreHttpError } from "../domain/errors.js";
import { log } from "../logging.js";

export interface HttpOptions {
  /** Per-call timeout in ms. Defaults to 30s (matches the calibredb subprocess budget). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * GET `url` and parse JSON as `T`. Throws {@link CalibreHttpError} on timeout,
 * transport failure, non-2xx, or invalid JSON — never leaks host paths in the message.
 */
export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  // Honor a caller-supplied signal too (e.g. request cancellation).
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.error("content-server non-2xx", { url, status: res.status });
      throw new CalibreHttpError(res.status, url, `Content Server returned HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof CalibreHttpError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    const message = aborted
      ? "Content Server request timed out"
      : "Cannot reach Calibre Content Server";
    log.error("content-server request failed", {
      url,
      aborted,
      cause: err instanceof Error ? err.message : String(err),
    });
    throw new CalibreHttpError(0, url, message);
  } finally {
    clearTimeout(timeout);
  }
}

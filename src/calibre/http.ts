// Minimal JSON-over-HTTP helper for the Content Server. Uses Node 24's global fetch
// (no dependency) with an AbortController timeout. Errors are normalized to
// CalibreHttpError with a generic message; the full URL/cause goes to stderr only.

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
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

export interface DownloadOptions {
  /** Per-download timeout in ms. Defaults to 120s (book files can be large). */
  timeoutMs?: number;
  /** Hard byte ceiling; the download aborts if exceeded. Defaults to 64 MiB. */
  maxBytes?: number;
  signal?: AbortSignal;
}

/**
 * Stream a GET response body to `destPath` with a hard byte cap. Aborts on overflow
 * (declared Content-Length or actual streamed bytes) and removes any partial file.
 * Throws {@link CalibreHttpError}; never leaks host paths in the message.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<{ bytes: number }> {
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });

  let bytes = 0;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.error("download non-2xx", { url, status: res.status });
      throw new CalibreHttpError(res.status, url, `Content Server returned HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new CalibreHttpError(res.status, url, "Book file exceeds the size limit");
    }
    if (!res.body) throw new CalibreHttpError(0, url, "Empty response body");

    // Count bytes as they stream; abort the pipeline the moment we cross the cap.
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          cb(new CalibreHttpError(0, url, "Book file exceeds the size limit"));
          return;
        }
        cb(null, chunk);
      },
    });
    const source = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
    await pipeline(source, counter, createWriteStream(destPath));
    return { bytes };
  } catch (err) {
    await unlink(destPath).catch(() => {}); // best-effort: drop the partial file
    if (err instanceof CalibreHttpError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    log.error("download failed", {
      url,
      aborted,
      cause: err instanceof Error ? err.message : String(err),
    });
    throw new CalibreHttpError(0, url, aborted ? "Download timed out" : "Download failed");
  } finally {
    clearTimeout(timeout);
  }
}

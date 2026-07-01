// Generic JSON-over-HTTP helper for external metadata providers. Deliberately NEUTRAL —
// unlike calibre/http.ts (which is branded to the Content Server and throws CalibreHttpError),
// this stays provider-agnostic so a failure is just a plain Error the provider catches and
// degrades from. Node 24 global fetch + an AbortController timeout, no dependency.

export interface FetchJsonOptions {
  /** Per-call timeout in ms (external APIs can be slow). Defaults to 10s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Injectable seam so provider clients can be unit-tested offline. */
export type FetchJson = <T>(url: string, opts?: FetchJsonOptions) => Promise<T>;

/** GET `url` and parse JSON as `T`. Throws a plain Error on timeout / non-2xx / bad JSON. */
export const fetchJson: FetchJson = async <T>(url: string, opts: FetchJsonOptions = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

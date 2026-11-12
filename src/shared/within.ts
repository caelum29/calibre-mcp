// A hard cap for best-effort reads: a Content Server request whose own timeout may not fire in time
// (DNS, a stuck socket) must never hold up the call that only wanted it as a nicety.

/** Resolves `fallback` if `p` has not settled by `ms`; the timer never outlives the race. */
export async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

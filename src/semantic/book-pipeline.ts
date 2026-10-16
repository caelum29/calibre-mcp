// Book-level build pipeline (#99): N workers run the slow, write-free half of indexing
// (download → extract → chunk → embed) concurrently, while ONE serialized writer commits
// finished books — SQLite stays single-writer however many books are in flight.

/** One book's result, in the order the caller passed the ids (not completion order). */
export type BookOutcome<P> =
  | { bookId: number; ok: true; prepared: P; worker: number; ms: number }
  | { bookId: number; ok: false; stage: "prepare" | "commit"; error: unknown; worker: number; ms: number };

export interface BookPipelineHooks<P> {
  /** Write-free per-book work; runs on up to `concurrency` books at once. */
  prepare(bookId: number, worker: number): Promise<P>;
  /** Persist one prepared book. Serialized: never overlaps another commit. */
  commit(bookId: number, prepared: P): void | Promise<void>;
  /**
   * Called once per book (success or failure) inside the writer's turn, right after its
   * commit — so progress appends never interleave and only ever record durable state.
   * A throw here is logged by the caller's own hook, never propagated into the run.
   */
  onSettled?(outcome: BookOutcome<P>): void | Promise<void>;
}

/** FIFO single-flight chain — the lone writer every worker hands its finished book to. */
class SerialWriter {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    // A failed commit must not poison the chain for the books queued behind it.
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Run `prepare` on up to `concurrency` books at once and `commit` each through a single
 * serialized writer. A book's failure (in either stage) is recorded in its outcome and
 * never stops the run. Each worker waits for its own commit before taking the next book,
 * so at most `concurrency` prepared books (vectors and all) are held in memory.
 */
export async function runBookPipeline<P>(
  bookIds: readonly number[],
  concurrency: number,
  hooks: BookPipelineHooks<P>,
): Promise<BookOutcome<P>[]> {
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, bookIds.length));
  const outcomes = Array.from<BookOutcome<P>>({ length: bookIds.length });
  const writer = new SerialWriter();
  let next = 0;

  const settle = async (i: number, outcome: BookOutcome<P>): Promise<void> => {
    outcomes[i] = outcome;
    try {
      await hooks.onSettled?.(outcome);
    } catch {
      // Telemetry/progress must never kill the run — the book's own outcome already stands.
    }
  };

  const worker = async (w: number): Promise<void> => {
    while (next < bookIds.length) {
      const i = next++;
      const bookId = bookIds[i]!;
      const t0 = Date.now();
      let prepared: P;
      try {
        prepared = await hooks.prepare(bookId, w);
      } catch (error) {
        await writer.run(() => settle(i, { bookId, ok: false, stage: "prepare", error, worker: w, ms: Date.now() - t0 }));
        continue;
      }
      await writer.run(async () => {
        try {
          await hooks.commit(bookId, prepared);
        } catch (error) {
          await settle(i, { bookId, ok: false, stage: "commit", error, worker: w, ms: Date.now() - t0 });
          return;
        }
        await settle(i, { bookId, ok: true, prepared, worker: w, ms: Date.now() - t0 });
      });
    }
  };

  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
  return outcomes;
}

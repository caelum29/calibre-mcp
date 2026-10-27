// FIFO single-flight queue for CPU-bound model inference (#156). Concurrent ONNX forwards on
// one CPU don't run faster in parallel — they interleave, so N parallel searches all finish
// late together and every one of them blows the client request timeout. Serializing makes
// them finish one by one in arrival order; an optional depth cap lets a caller refuse work
// that would only wait past the timeout (the reranker degrades instead of queueing forever).

/** Coded rejection when the queue is at its waiting cap — callers map it to a degrade path. */
export const QUEUE_BUSY = "INFERENCE_BUSY";

export class InferenceQueue {
  // Tail of the FIFO chain; each task starts only after the previous one settles.
  #tail: Promise<unknown> = Promise.resolve();
  // Queued + running; the head task counts from enqueue (it starts on a later microtask).
  #pending = 0;

  /**
   * @param maxWaiting Tasks allowed to wait behind the running one; past it, `run` rejects
   *   with QUEUE_BUSY instead of enqueueing. Infinity = never refuse.
   */
  constructor(private readonly maxWaiting = Number.POSITIVE_INFINITY) {}

  /** Tasks queued or running right now. */
  get depth(): number {
    return this.#pending;
  }

  /** Run `task` after every previously enqueued task settles (FIFO, one at a time). */
  run<T>(task: () => Promise<T>): Promise<T> {
    // #pending - 1 tasks already wait behind the running one; refuse once that is at the cap.
    if (this.#pending > this.maxWaiting) {
      return Promise.reject(new Error(QUEUE_BUSY));
    }
    this.#pending++;
    const result = this.#tail.then(async () => {
      try {
        return await task();
      } finally {
        this.#pending--;
      }
    });
    // A failed task must not poison the chain for the tasks behind it.
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

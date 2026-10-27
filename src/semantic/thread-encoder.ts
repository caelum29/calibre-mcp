// A BookEncoder backed by one worker thread with its own embedder (#99). Bulk re-index runs
// one per pipeline worker so chunking + tokenizing + inference spread over cores, while the
// main thread keeps I/O and the single SQLite writer. Each thread loads its own model copy.

import { Worker } from "node:worker_threads";
import type { Config } from "../config.js";
import type { BookEncoder, EncodeJob, EncodeResult } from "./book-encoder.js";
import type { EncodeReply, EncodeRequest } from "./encode-worker.js";

interface Pending {
  resolve: (r: EncodeResult | undefined) => void;
  reject: (e: Error) => void;
}

export class ThreadEncoder implements BookEncoder {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 0;
  #dead?: Error;

  constructor(config: Config) {
    // The compiled sibling (.js) in dist; under tsx the loader maps it to the .ts source.
    this.#worker = new Worker(new URL("./encode-worker.js", import.meta.url), { workerData: config });
    this.#worker.on("message", (reply: EncodeReply) => {
      const p = this.#pending.get(reply.id);
      if (!p) return;
      this.#pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(new Error(reply.message));
    });
    // A crashed thread fails its in-flight books (the pipeline isolates them) and every later one.
    const die = (err: Error): void => {
      this.#dead = err;
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    };
    this.#worker.on("error", die);
    this.#worker.on("exit", (code) => die(new Error(`encode worker exited (code ${code})`)));
  }

  /** Load this thread's model (first-run download lands here). */
  async warmup(): Promise<void> {
    await this.#call({ id: this.#nextId++, warmup: true });
  }

  async encode(job: EncodeJob): Promise<EncodeResult> {
    const result = await this.#call({ id: this.#nextId++, job });
    if (!result) throw new Error("encode worker returned no result");
    return result;
  }

  /** Stop the thread; in-flight calls reject. */
  async close(): Promise<void> {
    await this.#worker.terminate();
  }

  #call(req: EncodeRequest): Promise<EncodeResult | undefined> {
    if (this.#dead) return Promise.reject(this.#dead);
    return new Promise((resolve, reject) => {
      this.#pending.set(req.id, { resolve, reject });
      this.#worker.postMessage(req);
    });
  }
}

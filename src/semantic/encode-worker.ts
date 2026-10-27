// Worker-thread entry for ThreadEncoder (#99): owns its own embedder (ONNX session +
// tokenizer) and runs the in-thread encoder off the main thread. Logs go to stderr via the
// shared logger; nothing here touches stdout or the index.

import { parentPort, workerData } from "node:worker_threads";
import type { Config } from "../config.js";
import { inThreadEncoder, type EncodeJob, type EncodeResult } from "./book-encoder.js";
import { TransformersEmbedder } from "./embedder.js";

export type EncodeRequest = { id: number; job: EncodeJob } | { id: number; warmup: true };
export type EncodeReply = { id: number; ok: true; result?: EncodeResult } | { id: number; ok: false; message: string };

const port = parentPort;
if (!port) throw new Error("encode-worker must run as a worker thread");

const embedder = new TransformersEmbedder(workerData as Config);
const encoder = inThreadEncoder(embedder);

port.on("message", (req: EncodeRequest) => {
  void handle(req).then((reply) => {
    // Hand the vector buffers over instead of copying them (~1.5 KB per chunk adds up).
    const transfer =
      reply.ok && reply.result
        ? [
            ...new Set(
              [...(reply.result.vectors ?? []), ...(reply.result.captionVectors ?? [])].map(
                (v) => v.buffer as ArrayBuffer,
              ),
            ),
          ]
        : [];
    port.postMessage(reply, transfer);
  });
});

async function handle(req: EncodeRequest): Promise<EncodeReply> {
  try {
    if ("warmup" in req) {
      await embedder.warmup();
      return { id: req.id, ok: true };
    }
    return { id: req.id, ok: true, result: await encoder.encode(req.job) };
  } catch (err) {
    // Coded messages (EMBEDDER_UNAVAILABLE, …) cross the thread boundary unchanged.
    return { id: req.id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

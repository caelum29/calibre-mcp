// #719 (#715 gap): the encode worker hands the metadata vector's buffer over with the reply
// instead of copying it, like the chunk and caption vectors.
import { describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => {
  const handlers: Array<(req: unknown) => void> = [];
  return {
    handlers,
    posted: [] as Array<{ reply: unknown; transfer: ArrayBuffer[] }>,
    on(_event: string, fn: (req: unknown) => void) {
      handlers.push(fn);
    },
    postMessage(reply: unknown, transfer: ArrayBuffer[]) {
      this.posted.push({ reply, transfer });
    },
  };
});

vi.mock("node:worker_threads", () => ({ parentPort: port, workerData: {} }));
vi.mock("../../src/semantic/embedder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/semantic/embedder.js")>()),
  TransformersEmbedder: class {
    async embedPassages(texts: string[]) {
      return texts.map(() => Float32Array.from([1, 0, 0]));
    }
    async warmup() {}
    countTokens(s: string) {
      return s.length;
    }
  },
}));

describe("encode worker transfer list (#715)", () => {
  it("transfers the metadata vector's buffer for a metadata-only job", async () => {
    await import("../../src/semantic/encode-worker.js");
    expect(port.handlers).toHaveLength(1);
    port.handlers[0]!({
      id: 7,
      job: {
        text: "",
        ctx: "",
        outline: [],
        captions: [],
        metadataText: "Title. Author.",
        keywordOnly: false,
        tokenBudgeted: false,
      },
    });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    const { reply, transfer } = port.posted[0]!;
    const result = (reply as { ok: boolean; result: { metadataVector: Float32Array } }).result;
    expect(result.metadataVector).toEqual(Float32Array.from([1, 0, 0]));
    expect(transfer).toEqual([result.metadataVector.buffer]);
  });
});

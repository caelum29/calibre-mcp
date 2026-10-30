// Live check that the EmbeddingGemma 2 candidates (#139) run through the real embedder path —
// GATED behind RUN_GEMMA2_TESTS (separate from RUN_MODEL_TESTS: ~334 MB one-time download).
//   RUN_GEMMA2_TESTS=1 pnpm vitest run test/semantic/embedder-gemma2.integration.test.ts

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TransformersEmbedder } from "../../src/semantic/embedder.js";
import { CANDIDATES } from "../../src/semantic/model.js";
import { dot } from "../../src/semantic/vector.js";

const RUN = process.env.RUN_GEMMA2_TESTS === "1";
const spec = vi.hoisted(() => ({ key: "gemma2-768" as "gemma2-768" | "gemma2-256" }));

// The embedder reads ACTIVE_MODEL at call time — swap it per test instead of editing model.ts.
vi.mock("../../src/semantic/model.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/semantic/model.js")>();
  return {
    ...mod,
    get ACTIVE_MODEL() {
      return mod.CANDIDATES[spec.key];
    },
  };
});

describe.skipIf(!RUN)("TransformersEmbedder — EmbeddingGemma 2 candidates (live model)", () => {
  const cfg = loadConfig();

  it.each(["gemma2-768", "gemma2-256"] as const)(
    "%s: unit-norm vectors at the spec dim, card example ranks Mars first",
    async (key) => {
      spec.key = key;
      const embedder = new TransformersEmbedder(cfg);
      // Model card "Text search" example.
      const q = await embedder.embedQuery("Which planet is known as the Red Planet?");
      const docs = await embedder.embedPassages([
        "Venus is often called Earth's twin because of its similar size and proximity.",
        "Mars, known for its reddish appearance, is often referred to as the Red Planet.",
        "Jupiter, the largest planet in our solar system, has a prominent red spot.",
        "Saturn, famous for its rings, is sometimes mistaken for the Red Planet.",
      ]);
      expect(q.length).toBe(CANDIDATES[key].dim);
      expect(dot(q, q)).toBeCloseTo(1, 3);
      const scores = docs.map((d) => dot(q, d));
      expect(scores.indexOf(Math.max(...scores))).toBe(1);
    },
    600_000,
  );

  it("works cross-lingually (RU query finds RU passage over unrelated EN)", async () => {
    spec.key = "gemma2-768";
    const embedder = new TransformersEmbedder(cfg);
    const q = await embedder.embedQuery("книга о программировании");
    const [ru, en] = await embedder.embedPassages([
      "учебник по языку программирования и алгоритмам",
      "a recipe for chocolate chip cookies",
    ]);
    expect(dot(q, ru!)).toBeGreaterThan(dot(q, en!));
  }, 600_000);

  it("text-only load never fetches the vision/audio encoders", () => {
    const onnxDir = path.join(cfg.indexDir, "models", CANDIDATES["gemma2-768"].id, "onnx");
    const files = readdirSync(onnxDir);
    expect(files.some((f) => f.startsWith("model_quantized"))).toBe(true);
    expect(files.filter((f) => /^(vision|audio)_encoder/.test(f))).toEqual([]);
  });
});

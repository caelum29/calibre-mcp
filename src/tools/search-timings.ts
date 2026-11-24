// Debug-only latency breakdown for calibre_semantic_search: wraps the handler's ports in timers
// so each stage (query embedding, vector/keyword halves, rerank, Calibre round trips) is measured
// without touching the retrieval pipeline. Active only at CALIBRE_MCP_LOG_LEVEL=debug, so evals
// and perf triage can read latency off the result instead of the log file.

import type { SemanticDeps } from "./calibre_semantic_search.js";

/** Stage → summed wall time; a stage that never ran is absent. */
export type StageKey = "embedMs" | "vectorMs" | "keywordMs" | "rerankMs" | "calibreMs";

/** Rounded per-stage wall times (ms) of one call, plus the handler's total. */
export type SearchTimings = Partial<Record<StageKey, number>> & { totalMs: number };

// index methods per half: the vector half runs brute-force cosine, the keyword half FTS5
const INDEX_STAGES: Record<string, StageKey> = {
  searchLibrary: "vectorMs",
  searchBook: "vectorMs",
  searchFigures: "vectorMs",
  searchLibraryFts: "keywordMs",
  searchBookFts: "keywordMs",
  searchFiguresFts: "keywordMs",
};

/** Accumulates stage times for one call; `wrap` returns deps whose ports report into it. */
export class TimingRecorder {
  private readonly t0 = performance.now();
  private readonly stages: Partial<Record<StageKey, number>> = {};

  /** Deps with timed ports. Untimed members pass through bound to their original object. */
  wrap(deps: SemanticDeps): SemanticDeps {
    return {
      ...deps,
      embedder: this.timed(deps.embedder, (name) => (name === "embedQuery" ? "embedMs" : undefined)),
      index: this.timed(deps.index, (name) => INDEX_STAGES[name]),
      // every Content Server / calibredb call counts: id resolution, bundles, live-hit check
      content: this.timed(deps.content, () => "calibreMs"),
      calibre: this.timed(deps.calibre, () => "calibreMs"),
      ...(deps.reranker
        ? { reranker: this.timed(deps.reranker, (name) => (name === "rerank" ? "rerankMs" : undefined)) }
        : {}),
    };
  }

  /** The breakdown so far, in ms (rounded), with totalMs measured from construction. */
  snapshot(): SearchTimings {
    const out: SearchTimings = { totalMs: Math.round(performance.now() - this.t0) };
    for (const [k, v] of Object.entries(this.stages) as Array<[StageKey, number]>) out[k] = Math.round(v);
    return out;
  }

  private add(stage: StageKey, ms: number): void {
    this.stages[stage] = (this.stages[stage] ?? 0) + ms;
  }

  /** Proxy that times the methods `stageOf` names (sync or async, success or failure). */
  private timed<T extends object>(target: T, stageOf: (name: string) => StageKey | undefined): T {
    return new Proxy(target, {
      get: (obj, prop) => {
        const value: unknown = Reflect.get(obj, prop, obj);
        if (typeof value !== "function") return value;
        const stage = typeof prop === "string" ? stageOf(prop) : undefined;
        // bind to the real object so private fields and `this`-reliant methods keep working
        if (!stage) {
          const bound: unknown = value.bind(obj);
          return bound;
        }
        return (...callArgs: unknown[]) => {
          const start = performance.now();
          const stop = () => this.add(stage, performance.now() - start);
          try {
            const result: unknown = value.apply(obj, callArgs);
            // oxlint-disable-next-line @nkzw/no-instanceof -- only native promises from the wrapped port get .finally
            if (result instanceof Promise) return result.finally(stop);
            stop();
            return result;
          } catch (err) {
            stop();
            throw err;
          }
        };
      },
    });
  }
}

/** One header line: stages in pipeline order, then the total. */
export function timingsLine(t: SearchTimings): string {
  const order: Array<[StageKey | "totalMs", string]> = [
    ["embedMs", "embed"],
    ["vectorMs", "vector"],
    ["keywordMs", "keyword"],
    ["rerankMs", "rerank"],
    ["calibreMs", "calibre"],
    ["totalMs", "total"],
  ];
  const parts = order.filter(([k]) => t[k] !== undefined).map(([k, label]) => `${label} ${t[k]} ms`);
  return `Timings (debug): ${parts.join(" · ")}`;
}

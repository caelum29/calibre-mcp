// defineTool preserves a tool module's precise Zod-inferred arg type at authoring time,
// then erases it to AnyToolDescriptor for the registry. The single `args as …` cast is
// the only place the seam is crossed — and it's sound because the SDK validates the same
// inputSchema before the handler is ever called. Kept separate so tool modules don't
// import the registry (avoids an import cycle).

import type { z } from "zod";
import type { BaseDeps as BaseDepsDefault, ToolDeps } from "./deps.js";
import type { DefinedTool, ToolDescriptor } from "./types.js";

/**
 * Declare a tool with its precise Zod-inferred arg type, erased to a registry-compatible
 * descriptor. `D` (the deps slice the handler reads, #272) must be satisfiable by the full ToolDeps
 * — checked here, so a handler can never be registered asking for a dep the server doesn't build.
 */
export function defineTool<Shape extends z.ZodRawShape, D = BaseDepsDefault>(
  d: ToolDescriptor<Shape, D> & (ToolDeps extends D ? unknown : never),
): DefinedTool<D> {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    inputSchema: d.inputSchema,
    outputSchema: d.outputSchema,
    annotations: d.annotations,
    write: d.write,
    localWrite: d.localWrite,
    handler: (args, deps: D, ctx) => d.handler(args as z.infer<z.ZodObject<Shape>>, deps, ctx),
  };
}

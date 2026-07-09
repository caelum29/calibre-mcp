// defineTool preserves a tool module's precise Zod-inferred arg type at authoring time,
// then erases it to AnyToolDescriptor for the registry. The single `args as …` cast is
// the only place the seam is crossed — and it's sound because the SDK validates the same
// inputSchema before the handler is ever called. Kept separate so tool modules don't
// import the registry (avoids an import cycle).

import type { z } from "zod";
import type { AnyToolDescriptor, ToolDescriptor } from "./types.js";

export function defineTool<Shape extends z.ZodRawShape>(
  d: ToolDescriptor<Shape>,
): AnyToolDescriptor {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    inputSchema: d.inputSchema,
    outputSchema: d.outputSchema,
    annotations: d.annotations,
    write: d.write,
    localWrite: d.localWrite,
    handler: (args, deps) => d.handler(args as z.infer<z.ZodObject<Shape>>, deps),
  };
}

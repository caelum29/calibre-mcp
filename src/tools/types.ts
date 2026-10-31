// SDK-free contracts at the registration seam. These structurally mirror the SDK's
// CallToolResult / ToolAnnotations so tool handlers never import the MCP SDK — kept
// hand-written, not re-exported from @modelcontextprotocol/core (#121; Clean Architecture —
// only server.ts crosses the seam, DESIGN §7).

import type { z } from "zod";
import type { BaseDeps, ToolDeps } from "./deps.js";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ResourceLinkBlock {
  type: "resource_link";
  uri: string;
  name: string; // the SDK requires `name` on a resource_link
  title?: string;
  description?: string;
  mimeType?: string;
}

/** Structural match of the SDK ImageContent (base64 payload, no data: prefix). */
export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextBlock | ResourceLinkBlock | ImageBlock;

/** Structural match of the SDK CallToolResult — handlers return this, server.ts forwards it. */
export interface ToolResult {
  content: ContentBlock[]; // always non-empty (DESIGN §2)
  structuredContent?: Record<string, unknown>; // carries app-level nextCursor
  /**
   * Result-level metadata. Spec-compliant MCP Apps hosts forward it to the widget in the
   * tool-result notification (`calibreBoard` payload, issue #22); every other client ignores it.
   */
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

/** Local mirror of the SDK ToolAnnotations to keep tools/ free of SDK imports. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Per-call request context — platform types only, so handlers stay SDK-free. server.ts
 * builds it from the SDK's request extra: `signal` fires when the client cancels the call
 * (notifications/cancelled) or the connection closes; `progress` is present only when the
 * client asked for progress (sent a progressToken). Handlers thread `signal` into
 * subprocesses/fetches and may call `progress` freely — it is throttled and never throws.
 */
export interface ToolContext {
  signal: AbortSignal;
  /** Report progress: `progress` must increase between calls (e.g. books done). */
  progress?: (progress: number, message: string, total?: number) => void;
}

/**
 * A plain, SDK-free tool definition. server.ts maps each onto registerTool and calls
 * `.disable()` on `write` tools when the write gate is off (DESIGN §4).
 */
/**
 * Authoring-time tool shape. `D` is the deps slice the handler reads (#272): BaseDeps by default,
 * or a `DepsWithIndex<…>` for index consumers. Any D the full ToolDeps satisfies is accepted.
 */
export interface ToolDescriptor<Shape extends z.ZodRawShape = z.ZodRawShape, D = BaseDeps> {
  /** Template-literal enforces the `calibre_` namespace (DESIGN §2). */
  name: `calibre_${string}`;
  title: string;
  description: string; // ≤~256 chars, routing-policy prose (DESIGN §2/§9.1)
  inputSchema: Shape;
  outputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** When true, the server disables the tool unless writes are enabled. */
  write?: boolean;
  /**
   * Writes only to the server's own semantic-index dir, NOT the user's library — so it is
   * intentionally NOT gated by the library write flag despite `readOnlyHint: false`. This
   * marker makes that "index-write ≠ library-write" carve-out explicit for anyone auditing
   * "every readOnlyHint:false tool must be write-gated" (currently just calibre_build_index).
   */
  localWrite?: boolean;
  /** `ctx` is always supplied by server.ts; optional so direct (test) calls can omit it. */
  handler: (args: z.infer<z.ZodObject<Shape>>, deps: D, ctx?: ToolContext) => Promise<ToolResult>;
}

/**
 * Erased descriptor for the heterogeneous registry array. The handler takes `unknown`
 * (function-param contravariance forbids storing specific-arg handlers together);
 * defineTool bridges the precise authoring type to this with a single contained cast.
 */
export interface AnyToolDescriptor {
  name: `calibre_${string}`;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  write?: boolean;
  /** See ToolDescriptor.localWrite — index-dir write, not library write; not gate-controlled. */
  localWrite?: boolean;
  handler: (args: unknown, deps: ToolDeps, ctx?: ToolContext) => Promise<ToolResult>;
}

/**
 * A defined tool: registry-compatible (ToolDeps is assignable to D), while direct calls — tests —
 * see the narrow D, so their fakes supply only the deps the handler reads (#272).
 */
export type DefinedTool<D> = Omit<AnyToolDescriptor, "handler"> & {
  handler: (args: unknown, deps: D, ctx?: ToolContext) => Promise<ToolResult>;
};

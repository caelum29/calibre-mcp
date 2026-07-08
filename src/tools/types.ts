// SDK-free contracts at the registration seam. These structurally mirror the SDK's
// CallToolResult / ToolAnnotations so tool handlers never import @modelcontextprotocol/sdk
// (Clean Architecture — only server.ts crosses the seam, DESIGN §7).

import type { z } from "zod";
import type { Config } from "../config.js";
import type { CalibreClient } from "../calibre/client.js";
import type { ContentServerClient } from "../calibre/content-server.js";
import type { Extractor } from "../calibre/extract.js";
import type { Embedder } from "../semantic/embedder.js";
import type { Reranker } from "../semantic/reranker.js";
import type { IndexStore } from "../semantic/store.js";
import type { Provider } from "../enrich/provider.js";
import type { log } from "../logging.js";

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

export type ContentBlock = TextBlock | ResourceLinkBlock;

/** Structural match of the SDK CallToolResult — handlers return this, server.ts forwards it. */
export interface ToolResult {
  content: ContentBlock[]; // always non-empty (DESIGN §2)
  structuredContent?: Record<string, unknown>; // carries app-level nextCursor
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

/** Injected per-call dependencies. Handlers receive these; they never construct them. */
export interface ToolDeps {
  config: Config;
  content: ContentServerClient; // HTTP /ajax reads (preferred)
  calibre: CalibreClient; // subprocess: writes + fts
  extractor: Extractor; // book-text extraction (download + convert + cache)
  embedder: Embedder; // semantic query/passage embedding (transformers.js, lazy)
  /**
   * Cross-encoder rerank stage (lazy, optional model). Absent = reranking not wired
   * (tests/eval "off" runs) → search silently keeps the fused order; present but failing
   * (model missing/unreachable) → search degrades with an advisory note (D-011).
   */
  reranker?: Reranker;
  index: IndexStore; // SQLite BLOB vector index (node:sqlite, lazy)
  /** External metadata providers for recovery. Defaulted in-handler; injectable for tests. */
  providers?: Record<Provider["name"], Provider>;
  log: typeof log;
}

/**
 * A plain, SDK-free tool definition. server.ts maps each onto registerTool and calls
 * `.disable()` on `write` tools when the write gate is off (DESIGN §4).
 */
export interface ToolDescriptor<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Template-literal enforces the `calibre_` namespace (DESIGN §2). */
  name: `calibre_${string}`;
  title: string;
  description: string; // ≤~256 chars, routing-policy prose (DESIGN §2/§9.1)
  inputSchema: Shape;
  outputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** When true, the server disables the tool unless writes are enabled. */
  write?: boolean;
  handler: (args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps) => Promise<ToolResult>;
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
  handler: (args: unknown, deps: ToolDeps) => Promise<ToolResult>;
}

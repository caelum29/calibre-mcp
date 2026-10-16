// Client-compatibility rewrites applied to what the server puts on the wire. Shared by the
// stdio transport (run-stdio.ts) and the tool-catalog generator (scripts/gen-tool-catalog.mjs),
// so docs/tool-catalog.json is exactly what clients receive. SDK-free on purpose: it works on
// plain JSON values, so the generator can run it on a tools/list result from any client.

// Claude Desktop 1.24012.x rejects a tools/call CLIENT-SIDE (pre-dispatch) for any tool
// whose outputSchema contains the `$schema` meta-key — which zod-to-json-schema (inside
// the SDK) always emits. Stripping the key is semantics-free (it's pure metadata), so we
// do it unconditionally on outgoing tools/list results until the client is fixed.
// Bisection + upstream report: docs/dev/bug-reports/2026-07-22-…-except-ping.md, #79933.

/**
 * Remove `$schema` from every tool's outputSchema in a tools/list result (`{ tools: [...] }`),
 * in place. Anything that is not a tools/list result is left untouched.
 */
export function stripOutputSchemaDollarSchema(result: unknown): void {
  if (!result || typeof result !== "object") return;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools as Array<Record<string, unknown>>) {
    const out = tool?.outputSchema;
    if (out && typeof out === "object" && "$schema" in out) {
      delete (out as Record<string, unknown>).$schema;
    }
  }
}

/** Apply {@link stripOutputSchemaDollarSchema} to an outgoing JSON-RPC message's `result`. */
export function stripDollarSchema<T extends object>(msg: T): T {
  if ("result" in msg) stripOutputSchemaDollarSchema((msg as { result?: unknown }).result);
  return msg;
}

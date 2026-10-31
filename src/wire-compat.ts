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
  for (const tool of toolsOf(result)) {
    const out = tool?.outputSchema;
    if (out && typeof out === "object" && "$schema" in out) {
      delete (out as Record<string, unknown>).$schema;
    }
  }
}

// SDK v2 flips every inputSchema's declared dialect from draft-07 to 2020-12 (#270). Our
// -32602 history with Desktop/Cowork makes an unverified dialect change too risky, so the
// wire stays draft-07 until a live check in Desktop, Cowork and Code accepts 2020-12.
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

/**
 * Pin a declared `$schema` on every tool's inputSchema root to draft-07, in place. A schema
 * that declares no dialect is left alone (no new key on the wire); nested keys are untouched.
 */
export function pinInputSchemaDraft07(result: unknown): void {
  for (const tool of toolsOf(result)) {
    const input = tool?.inputSchema;
    if (input && typeof input === "object" && "$schema" in input) {
      (input as Record<string, unknown>).$schema = DRAFT_07;
    }
  }
}

/** Every wire rewrite for a tools/list result: output `$schema` stripped, input dialect pinned. */
export function applyToolsListCompat(result: unknown): void {
  stripOutputSchemaDollarSchema(result);
  pinInputSchemaDraft07(result);
}

/** Apply {@link applyToolsListCompat} to an outgoing JSON-RPC message's `result`. */
export function stripDollarSchema<T extends object>(msg: T): T {
  if ("result" in msg) applyToolsListCompat((msg as { result?: unknown }).result);
  return msg;
}

/** The `tools` array of a tools/list result, or none for any other value. */
function toolsOf(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const tools = (result as { tools?: unknown }).tools;
  return Array.isArray(tools) ? (tools as Array<Record<string, unknown>>) : [];
}

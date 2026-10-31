// Client-compatibility contract for the advertised tool schemas — the WIRE form (after
// wire-compat.ts), which is what Claude Desktop, Copilot, Gemini & co. actually parse.
// Runs against both the live server (src/) and the committed docs/tool-catalog.json, so a
// regression fails here even before `pnpm catalog:check` notices the catalog drifted.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import draft07MetaSchema from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { allTools } from "../../src/tools/registry.js";
import { applyToolsListCompat, DRAFT_07 } from "../../src/wire-compat.js";

type JsonSchema = Record<string, unknown>;
interface WireTool {
  name: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
}

const env = {
  CALIBRE_MCP_ENABLE_WRITE: "1",
  CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
  CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
  CALIBRE_MCP_INDEX_DIR: ":memory:",
};

async function liveTools(): Promise<WireTool[]> {
  const server = buildServer({ env, probes: false });
  const client = new Client({ name: "schema-compat", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    const result = await client.listTools();
    applyToolsListCompat(result);
    return result.tools as WireTool[];
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function committedTools(): WireTool[] {
  const raw = readFileSync(new URL("../../docs/tool-catalog.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { tools: WireTool[] }).tools;
}

const isObject = (v: unknown): v is JsonSchema => typeof v === "object" && v !== null && !Array.isArray(v);

/** Walk a JSON Schema and report client-incompatible constructs. */
function compatProblems(schema: unknown, where: string, kind: "input" | "output", out: string[]): void {
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => compatProblems(s, `${where}[${i}]`, kind, out));
    return;
  }
  if (!isObject(schema)) return;
  if (kind === "output" && "$schema" in schema) {
    out.push(`${where}: $schema in an output schema (Claude Desktop rejects the call)`);
  }
  // #270: the input dialect stays draft-07 on the wire until clients are checked live on 2020-12
  if (kind === "input" && "$schema" in schema && schema.$schema !== DRAFT_07) {
    out.push(`${where}: $schema ${String(schema.$schema)} in an input schema (wire is pinned to draft-07)`);
  }
  const type = schema.type;
  const isArray = type === "array" || (Array.isArray(type) && type.includes("array"));
  if (isArray && !("items" in schema) && !("prefixItems" in schema)) {
    out.push(`${where}: array without items (rejected by Copilot)`);
  }
  if (kind === "input" && typeof schema.const === "boolean") {
    out.push(`${where}: boolean const in an input schema (rejected by Gemini)`);
  }
  for (const [key, value] of Object.entries(schema)) compatProblems(value, `${where}.${key}`, kind, out);
}

function validate(tools: WireTool[]): string[] {
  // Input schemas declare `$schema: draft-07` (as the SDK's zod conversion emits them), so
  // the draft-07 meta-schema is registered too: each schema is checked against the dialect
  // it declares (2020-12 when it declares none, the MCP default), then compiled by Ajv2020.
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addMetaSchema(draft07MetaSchema);
  const problems: string[] = [];
  for (const t of tools) {
    for (const [key, kind] of [
      ["inputSchema", "input"],
      ["outputSchema", "output"],
    ] as const) {
      const schema = t[key];
      if (schema === undefined) continue;
      if (!ajv.validateSchema(schema)) problems.push(`${t.name}.${key}: ${ajv.errorsText(ajv.errors)}`);
      try {
        ajv.compile(schema);
      } catch (err) {
        problems.push(`${t.name}.${key}: does not compile — ${(err as Error).message}`);
      }
      if (schema.type !== "object") problems.push(`${t.name}.${key}: root type must be "object"`);
      compatProblems(schema, `${t.name}.${key}`, kind, problems);
    }
  }
  return problems;
}

describe("advertised tool schemas", () => {
  let live: WireTool[];
  beforeAll(async () => {
    live = await liveTools();
  });

  it("live server: every schema is valid JSON Schema 2020-12 and client-compatible", () => {
    expect(validate(live)).toEqual([]);
  });

  it("committed catalog: every schema is valid JSON Schema 2020-12 and client-compatible", () => {
    expect(validate(committedTools())).toEqual([]);
  });

  it("advertises exactly the registry's tools", () => {
    const expected = allTools.map((t) => t.name).sort();
    expect(live.map((t) => t.name).sort()).toEqual(expected);
    expect(committedTools().map((t) => t.name)).toEqual(expected);
  });

  it("the walker catches each incompatibility it claims to", () => {
    const problems: string[] = [];
    compatProblems({ $schema: "x", type: "object", properties: { a: { type: "array" } } }, "o", "output", problems);
    compatProblems({ type: "object", properties: { b: { const: true } } }, "i", "input", problems);
    compatProblems({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" }, "d", "input", problems);
    expect(problems).toHaveLength(4);
  });
});

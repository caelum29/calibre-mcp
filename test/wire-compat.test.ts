import { describe, it, expect } from "vitest";
import { stripDollarSchema, stripOutputSchemaDollarSchema } from "../src/wire-compat.js";

describe("stripDollarSchema", () => {
  it("removes $schema from tools/list output schemas only", () => {
    const msg = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        tools: [
          {
            name: "a",
            inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
            outputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
          },
          { name: "b", inputSchema: { type: "object" } },
        ],
      },
    };
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.outputSchema).toEqual({ type: "object" });
    expect(msg.result.tools[0]?.inputSchema).toHaveProperty("$schema");
    expect(msg.result.tools[1]).toEqual({ name: "b", inputSchema: { type: "object" } });
  });

  it("leaves non-tools/list messages alone", () => {
    const notification = { jsonrpc: "2.0" as const, method: "notifications/progress", params: { $schema: "x" } };
    expect(stripDollarSchema(notification)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { $schema: "x" },
    });
    expect(() => stripOutputSchemaDollarSchema(null)).not.toThrow();
    expect(() => stripOutputSchemaDollarSchema({ tools: "nope" })).not.toThrow();
  });
});

// #270: SDK v2 flips every inputSchema.$schema to 2020-12; the wire stays draft-07 until a
// live Desktop/Cowork/Code check accepts the new dialect.
describe("inputSchema dialect pin (#270)", () => {
  const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
  const listResult = (inputSchema: Record<string, unknown>) => ({
    jsonrpc: "2.0" as const,
    id: 7,
    result: { tools: [{ name: "calibre_search", inputSchema }] },
  });

  it("should_rewrite_a_2020_12_input_schema_to_draft_07", () => {
    const msg = listResult({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.inputSchema).toEqual({
      $schema: DRAFT_07,
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
  });

  it("should_rewrite_any_other_declared_dialect_to_draft_07", () => {
    const msg = listResult({ $schema: "https://json-schema.org/draft/2019-09/schema", type: "object" });
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.inputSchema).toEqual({ $schema: DRAFT_07, type: "object" });
  });

  it("should_leave_a_draft_07_input_schema_unchanged", () => {
    const msg = listResult({ $schema: DRAFT_07, type: "object" });
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.inputSchema).toEqual({ $schema: DRAFT_07, type: "object" });
  });

  it("should_not_add_a_dialect_to_an_input_schema_that_declares_none", () => {
    const msg = listResult({ type: "object" });
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.inputSchema).toEqual({ type: "object" });
  });

  it("should_only_pin_the_root_not_a_nested_property_named_$schema", () => {
    const nested = { type: "object", properties: { $schema: { type: "string" } } };
    const msg = listResult({ $schema: "https://json-schema.org/draft/2020-12/schema", ...nested });
    stripDollarSchema(msg);
    expect(msg.result.tools[0]?.inputSchema).toEqual({ $schema: DRAFT_07, ...nested });
  });
});

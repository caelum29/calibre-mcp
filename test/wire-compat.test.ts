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

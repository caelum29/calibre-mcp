// Log meta is always an object (#680): a bare string broke `jq .meta.<key>` over the daily files.

import { describe, expect, it } from "vitest";
import { createLogger, type LogRecord } from "../src/logging.js";

describe("log meta is an object (#680)", () => {
  it("should_wrap_a_bare_string_meta_into_an_object", () => {
    const lines: string[] = [];
    const logger = createLogger({ stderr: (s) => void lines.push(s) });
    logger.info("widget-probe", "ctx origin=x");
    const rec = JSON.parse(lines[0]!.replace(/^\[calibre-mcp\] /, "")) as LogRecord;
    expect(rec.meta).toEqual({ value: "ctx origin=x" });
  });
});

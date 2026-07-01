import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

describe("VERSION", () => {
  it("single-sources the version from package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});

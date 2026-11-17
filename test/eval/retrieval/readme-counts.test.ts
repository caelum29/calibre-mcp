// Pins the golden-set counts that test/eval/README.md states against queries.json, so the next
// baseline re-freeze can't leave the README stale (#677).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.join(HERE, "..", "README.md"), "utf8");
const queries = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as {
  heldOut?: boolean;
}[];

describe("test/eval/README.md golden-set counts", () => {
  it("states the query count of queries.json in the intro and the Layout section", () => {
    const n = queries.length;
    expect(README).toContain(`runs ${n} labeled golden queries`);
    expect(README).toContain(`\`queries.json\` — ${n} golden queries`);
  });

  it("states the held-out count of queries.json", () => {
    const held = queries.filter((q) => q.heldOut === true).length;
    expect(README).toContain(`${held} fixture queries carry \`"heldOut": true\``);
  });
});

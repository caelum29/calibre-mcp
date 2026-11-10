// #416: `run.ts` is import-only; `run-cli.ts` is the one place that calls main(), with no entry
// detection — so an empty/unresolvable argv[1] can never make `pnpm eval --gate` exit 0 silently.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Import `entry` in a fresh node with argv[1] blanked (the fail-open scenario), flags after it. */
async function importWithBlankArgv1(entry: string, ...flags: string[]) {
  const code = `process.argv = [process.argv[0], "", ...${JSON.stringify(flags)}]; await import(${JSON.stringify(path.join(ROOT, entry))});`;
  return exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: ROOT,
    timeout: 20_000,
  }).then(
    (r) => ({ code: 0, stderr: r.stderr }),
    (e: { code?: number; stderr?: string }) => ({ code: e.code, stderr: e.stderr ?? "" }),
  );
}
const evalLines = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[eval]"));

describe("eval entry split (#416)", () => {
  it("run-cli.ts runs main() even when argv[1] is blank (--gate --live fails loudly, exit 1)", async () => {
    const r = await importWithBlankArgv1("test/eval/retrieval/run-cli.ts", "--gate", "--live");
    expect({ code: r.code, eval: evalLines(r.stderr) }).toEqual({
      code: 1,
      eval: ["[eval] FAILED: --gate is fixture-only: the live diff is a triage artifact, never a gate (#85)."],
    });
  }, 30_000);

  it("importing run.ts starts nothing, whatever the flags", async () => {
    const r = await importWithBlankArgv1("test/eval/retrieval/run.ts", "--gate", "--live");
    expect({ code: r.code, eval: evalLines(r.stderr) }).toEqual({ code: 0, eval: [] });
  }, 30_000);

  it("run.ts has no entry detection and no top-level main() call", () => {
    const src = readFileSync(path.join(ROOT, "test/eval/retrieval/run.ts"), "utf8");
    expect(src).not.toContain("isCliEntry");
    expect(src).not.toMatch(/^main\(\)/m);
  });

  it("the `eval` script points at run-cli.ts", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.eval).toBe("node --import tsx test/eval/retrieval/run-cli.ts");
  });
});

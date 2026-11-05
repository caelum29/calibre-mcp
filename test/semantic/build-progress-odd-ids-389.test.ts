// #389 §Build-progress (from #381): ids that contain the hash separator `~`, contain `--`, or are
// only dots each get one exact, pinned log name; no two of them share a file, and none leaves the
// index dir (a "." or ".." id is a name component after the prefix, never a path segment).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultProgressPath } from "../../src/semantic/build-progress.js";

const DIR = "/idx";
const file = (id: string, flagsOnly = false): string => defaultProgressPath(DIR, id, flagsOnly);

// [id, full-log name, flags-log name]; hashes are sha256(raw id).slice(0, 8), written out by hand.
const CASES: [id: string, full: string, flags: string][] = [
  // `~` is outside the sanitiser's alphabet → "_" + hash of the RAW id, so it can't pose as a hashed name
  ["a~b", "progress-a_b~941528e5.jsonl", "flags-progress-a_b~941528e5.jsonl"],
  ["~", "progress-_~7ace431c.jsonl", "flags-progress-_~7ace431c.jsonl"],
  ["a~b~c", "progress-a_b_c~68fb746c.jsonl", "flags-progress-a_b_c~68fb746c.jsonl"],
  // `-` and `.` are kept: these ids keep their plain names
  ["a--b", "progress-a--b.jsonl", "flags-progress-a--b.jsonl"],
  ["--", "progress---.jsonl", "flags-progress---.jsonl"],
  [".", "progress-..jsonl", "flags-progress-..jsonl"],
  ["..", "progress-...jsonl", "flags-progress-...jsonl"],
  ["...", "progress-....jsonl", "flags-progress-....jsonl"],
  // neighbours they must stay apart from
  ["a_b", "progress-a_b.jsonl", "flags-progress-a_b.jsonl"],
  ["a-b", "progress-a-b.jsonl", "flags-progress-a-b.jsonl"],
  ["a_b~941528e5", "progress-a_b_941528e5~1a0bfec0.jsonl", "flags-progress-a_b_941528e5~1a0bfec0.jsonl"],
];

describe("progress log names for `~`, `--` and dot-only ids (#389 §Build-progress)", () => {
  for (const [id, full, flags] of CASES) {
    it(`should_name_${JSON.stringify(id)}_exactly`, () => {
      expect([file(id), file(id, true)]).toEqual([path.join(DIR, full), path.join(DIR, flags)]);
    });
  }

  it("should_never_map_two_ids_to_one_file", () => {
    for (const flagsOnly of [false, true]) {
      const names = CASES.map(([id]) => file(id, flagsOnly));
      expect(new Set(names).size).toBe(CASES.length);
    }
  });

  it("should_keep_every_log_directly_inside_the_index_dir", () => {
    const files = CASES.flatMap(([id]) => [file(id), file(id, true)]);
    const outside = files.filter((f) => !path.resolve(f).startsWith(path.resolve(DIR) + path.sep));
    expect([outside, new Set(files.map((f) => path.dirname(f)))]).toEqual([[], new Set([DIR])]);
  });
});

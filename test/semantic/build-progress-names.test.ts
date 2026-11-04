// #370 §Build-progress (from #368): a hashed log name uses a separator the sanitiser never
// emits, so no plain id can equal another id's hashed name; ids too long for a 255-byte file
// name are truncated (on a code-point boundary) + hashed instead of failing with ENAMETOOLONG.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProgress, defaultProgressPath, resumeProgress } from "../../src/semantic/build-progress.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "progress-names-"));
  dirs.push(d);
  return d;
};

const name = (id: string, flagsOnly = false): string => path.basename(defaultProgressPath("/idx", id, flagsOnly));
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("progress log names: hashed names can't collide with plain ids (#370)", () => {
  it("should_give_a_b_6783a31e_and_a_colon_b_different_files", () => {
    // sha256("a:b") starts 6783a31e — the plain id "a_b-6783a31e" used to be exactly a:b's hashed name
    expect(name("a_b-6783a31e")).not.toBe(name("a:b"));
    expect(name("a_b-6783a31e", true)).not.toBe(name("a:b", true));
  });

  it("should_keep_plain_ids_on_their_exact_current_file_name", () => {
    expect(name("Programming_Books")).toBe("progress-Programming_Books.jsonl");
    expect(name("Reaserch_Books", true)).toBe("flags-progress-Reaserch_Books.jsonl");
    expect(name("a_b-6783a31e")).toBe("progress-a_b-6783a31e.jsonl");
    expect(name("Книги")).toBe("progress-Книги.jsonl");
  });

  it("should_mark_a_hashed_name_with_a_character_outside_the_sanitised_alphabet", () => {
    expect(name("a:b")).toBe("progress-a_b~6783a31e.jsonl");
  });
});

describe("progress log names: ids too long for one file name (#370)", () => {
  it("should_keep_an_id_whose_full_file_name_is_exactly_255_bytes", () => {
    const id = "x".repeat(255 - bytes("progress-") - bytes(".jsonl"));
    expect(name(id)).toBe(`progress-${id}.jsonl`);
    expect(bytes(name(id))).toBe(255);
  });

  it("should_truncate_and_hash_one_byte_over_the_limit", () => {
    const id = "x".repeat(256 - bytes("progress-") - bytes(".jsonl"));
    const n = name(id);
    expect(bytes(n)).toBeLessThanOrEqual(255);
    expect(n).toMatch(/^progress-x+~[0-9a-f]{8}\.jsonl$/);
  });

  it("should_count_the_longer_flags_prefix_against_the_limit", () => {
    const id = "y".repeat(255 - bytes("progress-") - bytes(".jsonl")); // fits the full log, not the flags log
    expect(name(id)).toBe(`progress-${id}.jsonl`);
    expect(bytes(name(id, true))).toBeLessThanOrEqual(255);
    expect(name(id, true)).toMatch(/^flags-progress-y+~[0-9a-f]{8}\.jsonl$/);
  });

  const long: [label: string, id: string][] = [
    ["ascii", "L".repeat(400)],
    ["cyrillic (2-byte)", "Книга".repeat(60)],
    ["emoji (sanitised to _)", "📚".repeat(100)],
    ["astral letter (4-byte, surrogate pairs)", "𝐀".repeat(100)],
    ["sanitised", "a:b/".repeat(100)],
  ];
  for (const [label, id] of long) {
    it(`should_fit_a_long_${label.split(" ")[0]}_id_in_255_bytes_on_a_whole_character`, () => {
      for (const flags of [false, true]) {
        const n = name(id, flags);
        expect(bytes(n)).toBeLessThanOrEqual(255);
        expect(n.isWellFormed()).toBe(true); // no split surrogate pair
        expect(n).toMatch(/~[0-9a-f]{8}\.jsonl$/);
      }
    });
  }

  it("should_keep_two_long_ids_with_the_same_prefix_apart", () => {
    const base = "Shared".repeat(60);
    expect(name(`${base}A`)).not.toBe(name(`${base}B`));
  });

  it("should_write_and_resume_a_log_for_a_400_character_id_instead_of_ENAMETOOLONG", () => {
    // ASCII: over 255 on every file system (APFS counts characters, ext4 bytes)
    const dir = scratch();
    const file = defaultProgressPath(dir, "L".repeat(400), false);
    appendProgress(file, { bookId: 7, ok: true });
    expect([...resumeProgress(file)]).toEqual([7]);
  });
});

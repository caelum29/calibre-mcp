// openReadOnlyIndex (#651): a read-only handle on an index file for dev tooling (the keyword
// planner's measurement script), so scripts never open their own DatabaseSync (#272).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnlyIndex } from "../../src/semantic/store/schema.js";

describe("openReadOnlyIndex", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "open-ro-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the file, refuses writes and leaves it byte-identical", () => {
    const file = join(dir, "L.sqlite");
    const w = new DatabaseSync(file);
    w.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (7)");
    w.close();
    const before = readFileSync(file);
    const db = openReadOnlyIndex(file);
    expect(db.prepare("SELECT x FROM t").get()).toEqual({ x: 7 });
    expect(() => db.exec("INSERT INTO t VALUES (8)")).toThrow(/readonly/);
    db.close();
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("never creates a missing file", () => {
    expect(() => openReadOnlyIndex(join(dir, "missing.sqlite"))).toThrow(/unable to open/);
  });
});

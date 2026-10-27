// Book-level build pipeline (#99): workers prepare concurrently, one writer commits
// serially; a failing book is isolated; progress resumes order-independently.

import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBookPipeline } from "../../src/semantic/book-pipeline.js";
import { appendProgress, readCompletedIds, resumeProgress } from "../../src/semantic/build-progress.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runBookPipeline", () => {
  it("prepares books concurrently but never overlaps two commits", async () => {
    let preparing = 0;
    let maxPreparing = 0;
    let committing = 0;
    let maxCommitting = 0;
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    await runBookPipeline(ids, 3, {
      prepare: async (id) => {
        preparing++;
        maxPreparing = Math.max(maxPreparing, preparing);
        await sleep(5 + (id % 3) * 4);
        preparing--;
        return id;
      },
      // An async commit makes overlap observable — a sync one could never interleave anyway.
      commit: async () => {
        committing++;
        maxCommitting = Math.max(maxCommitting, committing);
        await sleep(3);
        committing--;
      },
    });
    expect(maxPreparing).toBe(3);
    expect(maxCommitting).toBe(1);
  });

  it("commits in completion order but returns outcomes in input order", async () => {
    const committed: number[] = [];
    // Book 1 is the slowest: with 3 workers it finishes last.
    const delays: Record<number, number> = { 1: 40, 2: 5, 3: 15 };
    const outcomes = await runBookPipeline([1, 2, 3], 3, {
      prepare: async (id) => {
        await sleep(delays[id]!);
        return `p${id}`;
      },
      commit: (id) => {
        committed.push(id);
      },
    });
    expect(committed).toEqual([2, 3, 1]);
    expect(outcomes.map((o) => o.bookId)).toEqual([1, 2, 3]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(outcomes.map((o) => (o.ok ? o.prepared : null))).toEqual(["p1", "p2", "p3"]);
  });

  it("isolates failures: a prepare throw and a commit throw don't stop the other books", async () => {
    const store = new Map<number, string>();
    const outcomes = await runBookPipeline([1, 2, 3, 4, 5], 2, {
      prepare: async (id) => {
        await sleep(2);
        if (id === 2) throw new Error("EXTRACT_TIMEOUT");
        return `book-${id}`;
      },
      commit: (id, p) => {
        if (id === 4) throw new Error("disk I/O error");
        store.set(id, p);
      },
    });
    expect([...store.keys()].sort()).toEqual([1, 3, 5]);
    const failed = outcomes.filter((o) => !o.ok);
    expect(failed.map((o) => [o.bookId, !o.ok && o.stage])).toEqual([
      [2, "prepare"],
      [4, "commit"],
    ]);
  });

  it("a throwing onSettled hook never fails the run", async () => {
    const outcomes = await runBookPipeline([1, 2, 3], 2, {
      prepare: async (id) => id,
      commit: () => {},
      onSettled: () => {
        throw new Error("progress disk full");
      },
    });
    expect(outcomes.every((o) => o.ok)).toBe(true);
  });

  it("onSettled runs after the commit, inside the writer's turn (progress = durable state)", async () => {
    const events: string[] = [];
    await runBookPipeline([1, 2, 3, 4], 4, {
      prepare: async (id) => {
        await sleep(10 - id * 2);
        return id;
      },
      commit: async (id) => {
        events.push(`commit ${id}`);
        await sleep(2);
      },
      onSettled: (o) => {
        events.push(`settled ${o.bookId}`);
      },
    });
    // Strict alternation: no other commit sneaks between a book's commit and its progress line.
    for (let i = 0; i < events.length; i += 2) {
      const id = events[i]!.split(" ")[1];
      expect(events[i]).toBe(`commit ${id}`);
      expect(events[i + 1]).toBe(`settled ${id}`);
    }
  });

  it("concurrency is clamped to [1, books] (0/NaN → 1, never more workers than books)", async () => {
    let maxActive = 0;
    let active = 0;
    const hooks = {
      prepare: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(2);
        active--;
      },
      commit: () => {},
    };
    await runBookPipeline([1, 2, 3], 0, hooks);
    expect(maxActive).toBe(1);
    maxActive = 0;
    await runBookPipeline([1, 2], 16, hooks);
    expect(maxActive).toBe(2);
    expect(await runBookPipeline([], 3, hooks)).toEqual([]);
  });
});

describe("build progress (resume)", () => {
  const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), "bp-")), "progress.jsonl");

  it("resumes after a partial concurrent run: only unfinished books re-run, each committed once", async () => {
    const file = tmp();
    const ids = [10, 11, 12, 13, 14, 15];
    const commits = new Map<number, number>();
    const hooks = (abortAfter: number) => {
      let settled = 0;
      return {
        prepare: async (id: number) => {
          await sleep((id * 7) % 5);
          // Simulate the process dying: books past the cutoff never finish this run.
          if (settled >= abortAfter) throw new Error("killed");
          return id;
        },
        commit: (id: number) => {
          commits.set(id, (commits.get(id) ?? 0) + 1);
        },
        onSettled: (o: { bookId: number; ok: boolean }) => {
          if (!o.ok) return; // a killed process writes nothing for its in-flight books
          settled++;
          appendProgress(file, { bookId: o.bookId, ok: true });
        },
      };
    };

    await runBookPipeline(ids, 3, hooks(3));
    const firstRun = readCompletedIds(file);
    expect(firstRun.size).toBeGreaterThanOrEqual(3);
    expect(firstRun.size).toBeLessThan(ids.length);

    // A torn final line (crash mid-append) must not break resume.
    appendFileSync(file, '{"bookId": 99, "o');
    const resumed = resumeProgress(file);
    const remaining = ids.filter((id) => !resumed.has(id));
    await runBookPipeline(remaining, 3, hooks(Infinity));

    expect(readCompletedIds(file)).toEqual(new Set(ids));
    for (const id of ids) expect(commits.get(id)).toBe(1);
  });

  it("the last record for a book wins (a later failure un-completes it)", () => {
    const file = tmp();
    writeFileSync(file, "");
    appendProgress(file, { bookId: 1, ok: true });
    appendProgress(file, { bookId: 2, ok: false, error: "x" });
    appendProgress(file, { bookId: 1, ok: false, error: "forced rebuild failed" });
    appendProgress(file, { bookId: 2, ok: true });
    expect(readCompletedIds(file)).toEqual(new Set([2]));
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(4);
  });

  it("a missing progress file means nothing is done yet", () => {
    expect(readCompletedIds(path.join(tmpdir(), "does-not-exist-99.jsonl")).size).toBe(0);
  });
});

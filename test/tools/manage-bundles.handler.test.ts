import { describe, it, expect, vi } from "vitest";
import {
  buildSavedSearchArgs,
  manageBundlesTool,
  mergeBundles,
  parseSavedSearches,
} from "../../src/tools/calibre_manage_bundles.js";
import { CalibreHttpError } from "../../src/domain/errors.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/types.js";

const LIST_STDOUT = [
  "Integration status: False",
  "Name: rust",
  "Search string: tag:rust",
  "",
  "Name: -outdated",
  "Search string: tag:outdated",
  "",
].join("\n");

interface Stubs {
  calibredb?: (args: readonly string[], opts?: unknown) => Promise<{ stdout: string; stderr: string }>;
  virtualLibraries?: () => Promise<Record<string, string>>;
  search?: (p: { query: string }) => Promise<{ total: number }>;
}

function deps(stubs: Stubs = {}): ToolDeps {
  const content = {
    resolveLibraryId: async (name?: string): Promise<string> => name ?? "Programming_Books",
    virtualLibraries: stubs.virtualLibraries ?? (async () => ({ Fiction: "tag:fiction" })),
    search: stubs.search ?? (async () => ({ total: 7 })),
  };
  return {
    config: loadConfig({}),
    content: content as unknown as ToolDeps["content"],
    calibre: {
      calibredb: stubs.calibredb ?? (async () => ({ stdout: LIST_STDOUT, stderr: "" })),
    } as unknown as ToolDeps["calibre"],
    extractor: {} as unknown as ToolDeps["extractor"],
    figures: {} as unknown as ToolDeps["figures"],
    embedder: {} as ToolDeps["embedder"],
    index: {} as ToolDeps["index"],
    log,
  };
}

describe("parseSavedSearches", () => {
  it("parses Name/Search string pairs and tolerates CLI noise", () => {
    expect(parseSavedSearches(LIST_STDOUT)).toEqual([
      { name: "rust", expression: "tag:rust" },
      { name: "-outdated", expression: "tag:outdated" },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseSavedSearches("Integration status: False\n")).toEqual([]);
  });
});

describe("mergeBundles", () => {
  it("marks virtual libraries read-only and flags exclusion markers", () => {
    const merged = mergeBundles(
      [
        { name: "rust", expression: "tag:rust" },
        { name: "-noise", expression: "tag:noise" },
      ],
      { Fiction: "tag:fiction" },
    );
    expect(merged).toEqual([
      {
        name: "rust",
        expression: "tag:rust",
        kind: "saved_search",
        read_only: false,
        is_exclusion_marker: false,
      },
      {
        name: "-noise",
        expression: "tag:noise",
        kind: "saved_search",
        read_only: false,
        is_exclusion_marker: true,
      },
      {
        name: "Fiction",
        expression: "tag:fiction",
        kind: "virtual_library",
        read_only: true,
        is_exclusion_marker: false,
      },
    ]);
  });
});

describe("buildSavedSearchArgs", () => {
  it("puts `--` before the name so leading-dash markers survive", () => {
    expect(buildSavedSearchArgs("add", "-outdated", "tag:outdated")).toEqual([
      "saved_searches",
      "add",
      "--",
      "-outdated",
      "tag:outdated",
    ]);
    expect(buildSavedSearchArgs("remove", "-outdated")).toEqual([
      "saved_searches",
      "remove",
      "--",
      "-outdated",
    ]);
  });

  it("keeps every option ahead of `--` once the client prepends --with-library", () => {
    // Probed on 9.11: an option after `--` is read as a positional, calibredb falls back to
    // the local DB and dies on the GUI lock. The client prefixes --with-library, so the
    // composed argv must still have no option at or after the separator.
    const argv = ["--with-library", "http://localhost:8080/#Lib", ...buildSavedSearchArgs("add", "-p", "format:EPUB")];
    const sep = argv.indexOf("--");
    expect(argv.indexOf("--with-library")).toBeLessThan(sep);
    expect(argv.slice(sep + 1).some((a) => a.startsWith("--"))).toBe(false);
  });
});

describe("calibre_manage_bundles handler", () => {
  it("lists saved searches merged with virtual libraries in the text content", async () => {
    const r = await manageBundlesTool.handler({ action: "list", confirm: false }, deps());
    expect(r.isError).toBeFalsy();
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("rust");
    expect(text).toContain("exclusion marker");
    expect(text).toContain("virtual library, read-only");
    expect((r.structuredContent?.bundles as unknown[]).length).toBe(3);
  });

  it("still lists saved searches when the virtual-library read fails", async () => {
    const r = await manageBundlesTool.handler(
      { action: "list", confirm: false },
      deps({
        virtualLibraries: async () => {
          throw new CalibreHttpError(0, "u", "Cannot reach Calibre Content Server");
        },
      }),
    );
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent?.bundles as unknown[]).length).toBe(2);
  });

  it("previews a create with the match count and writes nothing", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    const r = await manageBundlesTool.handler(
      { action: "create", name: "kafka", expression: "tag:kafka", confirm: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.applied).toBe(false);
    expect(r.structuredContent?.matches).toBe(7);
    expect(r.content[0].type === "text" && r.content[0].text).toContain("Matches 7 book(s)");
    // Only the list read — no add.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(["saved_searches", "list"]);
  });

  it("hedges on a zero match count (an unknown field also returns 0)", async () => {
    const r = await manageBundlesTool.handler(
      { action: "create", name: "kafka", expression: "tagz:kafka", confirm: false },
      deps({ search: async () => ({ total: 0 }) }),
    );
    const text = r.content[0].type === "text" ? r.content[0].text : "";
    expect(text).toContain("unknown field");
  });

  it("maps a 500-with-empty-body preview to an invalid-expression error", async () => {
    const r = await manageBundlesTool.handler(
      { action: "create", name: "kafka", expression: "tag:(", confirm: false },
      deps({
        search: async () => {
          throw new CalibreHttpError(500, "u", "Content Server returned HTTP 500");
        },
      }),
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].type === "text" && r.content[0].text).toContain("invalid syntax");
  });

  it("creates via `saved_searches add` when confirmed and reports created_as", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    const r = await manageBundlesTool.handler(
      { action: "create", name: "-noise", expression: "tag:noise", confirm: true },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith(
      ["saved_searches", "add", "--", "-noise", "tag:noise"],
      expect.objectContaining({ library: "Programming_Books" }),
    );
    expect(r.structuredContent?.created_as).toBe("saved_search");
    expect(r.content[0].type === "text" && r.content[0].text).toContain("created_as: saved_search");
  });

  it("updates by removing then adding", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    await manageBundlesTool.handler(
      { action: "update", name: "rust", expression: "tag:rust or title:rust", confirm: true },
      deps({ calibredb: spy }),
    );
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      ["saved_searches", "list"],
      ["saved_searches", "remove", "--", "rust"],
      ["saved_searches", "add", "--", "rust", "tag:rust or title:rust"],
    ]);
  });

  it("restores the old expression when the add half of an update fails", async () => {
    // remove succeeds, the new add fails, the rollback add succeeds.
    const calls: string[][] = [];
    const calibredb = vi.fn(async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[1] === "add" && args[4] === "tag:broken") throw new Error("calibredb command failed");
      return { stdout: LIST_STDOUT, stderr: "" };
    });
    const r = await manageBundlesTool.handler(
      { action: "update", name: "rust", expression: "tag:broken", confirm: true },
      deps({ calibredb }),
    );
    expect(r.isError).toBe(true);
    const text = r.content[0].type === "text" ? r.content[0].text : "";
    expect(text).toContain("was restored");
    expect(text).toContain("tag:rust");
    // The last call re-adds the ORIGINAL expression.
    expect(calls.at(-1)).toEqual(["saved_searches", "add", "--", "rust", "tag:rust"]);
  });

  it("reports the bundle as missing (with its old expression) when the rollback also fails", async () => {
    const calibredb = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "add") throw new Error("calibredb command failed");
      return { stdout: LIST_STDOUT, stderr: "" };
    });
    const r = await manageBundlesTool.handler(
      { action: "update", name: "rust", expression: "tag:broken", confirm: true },
      deps({ calibredb }),
    );
    expect(r.isError).toBe(true);
    const text = r.content[0].type === "text" ? r.content[0].text : "";
    expect(text).toContain("no longer exists");
    expect(text).toContain("action=create");
    expect(text).toContain("tag:rust"); // the old expression, so it can be recreated
  });

  it("refuses to create a bundle that already exists", async () => {
    const r = await manageBundlesTool.handler(
      { action: "create", name: "rust", expression: "tag:rust", confirm: true },
      deps(),
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].type === "text" && r.content[0].text).toContain("action=update");
  });

  it("errors on deleting a nonexistent bundle and lists the available names", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    const r = await manageBundlesTool.handler(
      { action: "delete", name: "nope", confirm: true },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    const text = r.content[0].type === "text" ? r.content[0].text : "";
    expect(text).toContain("rust");
    expect(text).toContain("-outdated");
    expect(spy).toHaveBeenCalledTimes(1); // list only
  });

  it("refuses to delete a virtual library and points at the Calibre GUI", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    const r = await manageBundlesTool.handler(
      { action: "delete", name: "Fiction", confirm: true },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].type === "text" && r.content[0].text).toContain("Calibre GUI");
    expect(spy).toHaveBeenCalledTimes(1); // list only
  });

  it("dry-runs a delete without confirm", async () => {
    const spy = vi.fn(async () => ({ stdout: LIST_STDOUT, stderr: "" }));
    const r = await manageBundlesTool.handler(
      { action: "delete", name: "rust", confirm: false },
      deps({ calibredb: spy }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.applied).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("requires a name for non-list actions", async () => {
    const r = await manageBundlesTool.handler({ action: "delete", confirm: true }, deps());
    expect(r.isError).toBe(true);
  });
});

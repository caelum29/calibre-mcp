// Write gate per call (#435, D-028): with CALIBRE_MCP_ENABLE_WRITE off, write tools that have a
// call that writes nothing stay listed (announced read-only) and only their Write calls are
// refused with write_disabled; tools with no such call stay hidden. With the gate on, nothing changes.

import { filterErrorText } from "../../src/tools/writes-remedy.js";
import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { allTools, assertWriteClassification } from "../../src/tools/registry.js";
import type { AnyToolDescriptor } from "../../src/tools/types.js";
import { ERROR_CODES, defaultHint, isServerFault } from "../../src/domain/error-codes.js";
import { invalidateBundleCache, resolveFilter } from "../../src/app/bundles.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { BaseDeps } from "../../src/tools/deps.js";

const LISTED_WRITE_TOOLS = [
  "calibre_extract_isbn",
  "calibre_bulk_update",
  "calibre_remove_book",
  "calibre_merge_books",
  "calibre_manage_bundles",
];
const HIDDEN_WRITE_TOOLS = ["calibre_update_book", "calibre_add_book"];

// The Write call per tool (the issue's table); stringified booleans as Cowork sends them included.
const WRITE_CALLS: Array<[string, Record<string, unknown>]> = [
  ["calibre_extract_isbn", { id: 1, apply: true }],
  ["calibre_bulk_update", { ids: [1], changes: { publisher: "Acme" }, preview: false }],
  ["calibre_remove_book", { ids: [1], confirm: true }],
  ["calibre_remove_book", { ids: [1], confirm: "true" }],
  ["calibre_merge_books", { targetId: 1, sourceIds: [2], confirm: true }],
  ["calibre_manage_bundles", { action: "create", name: "Rust", expression: "tags:Rust", confirm: true }],
  ["calibre_manage_bundles", { action: "update", name: "Rust", expression: "tags:Go", confirm: true }],
  ["calibre_manage_bundles", { action: "delete", name: "Rust", confirm: true }],
];

// Calls that write nothing: the gate must let them reach the handler.
const PREVIEW_CALLS: Array<[string, Record<string, unknown>]> = [
  ["calibre_extract_isbn", { id: 1 }],
  ["calibre_bulk_update", { ids: [1], changes: { publisher: "Acme" } }],
  ["calibre_remove_book", { ids: [1] }],
  ["calibre_remove_book", { ids: [1], confirm: "false" }],
  ["calibre_merge_books", { targetId: 1, sourceIds: [2] }],
  ["calibre_manage_bundles", { action: "list" }],
  ["calibre_manage_bundles", { action: "create", name: "Rust", expression: "tags:Rust" }],
  ["calibre_manage_bundles", { action: "delete", name: "Rust", confirm: false }],
];

async function connect(writeEnabled: boolean): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer({
    probes: false,
    env: {
      ...(writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
      // Nothing listens here and no calibredb exists: a call that reaches Calibre fails differently.
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_CALIBREDB_PATH: "/nonexistent/calibredb-435",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "write-gate-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

async function listTools(writeEnabled: boolean) {
  const { client, close } = await connect(writeEnabled);
  try {
    return (await client.listTools()).tools;
  } finally {
    await close();
  }
}

async function call(writeEnabled: boolean, name: string, args: Record<string, unknown>) {
  const { client, close } = await connect(writeEnabled);
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? "").join("\n");
    const code = (r.structuredContent as { errorCode?: string } | undefined)?.errorCode;
    return { isError: r.isError === true, text, code };
  } finally {
    await close();
  }
}

describe("write gate per call (#435)", () => {
  describe("gate off", () => {
    it("should_list_the_five_previewable_write_tools", async () => {
      const names = (await listTools(false)).map((t) => t.name);
      expect(LISTED_WRITE_TOOLS.filter((n) => names.includes(n))).toEqual(LISTED_WRITE_TOOLS);
    });

    it("should_hide_update_book_and_add_book", async () => {
      const names = (await listTools(false)).map((t) => t.name);
      expect(HIDDEN_WRITE_TOOLS.filter((n) => names.includes(n))).toEqual([]);
    });

    it("should_announce_the_listed_write_tools_as_read_only_without_destructiveHint", async () => {
      const tools = await listTools(false);
      const ann = LISTED_WRITE_TOOLS.map((n) => {
        const a = tools.find((t) => t.name === n)?.annotations ?? {};
        return { n, readOnlyHint: a.readOnlyHint, destructiveHint: a.destructiveHint };
      });
      expect(ann).toEqual(LISTED_WRITE_TOOLS.map((n) => ({ n, readOnlyHint: true, destructiveHint: undefined })));
    });

    it.each(WRITE_CALLS)("should_refuse_the_write_call_of_%s_with_write_disabled", async (name, args) => {
      const r = await call(false, name, args);
      expect(r).toMatchObject({ isError: true, code: "write_disabled" });
      expect(r.text).toContain("Code: write_disabled");
      expect(r.text).toContain("CALIBRE_MCP_ENABLE_WRITE=1");
      expect(r.text).toContain("Enable writes");
    });

    it.each(PREVIEW_CALLS)("should_let_the_preview_call_of_%s_reach_its_handler", async (name, args) => {
      const r = await call(false, name, args);
      expect(r.code).not.toBe("write_disabled");
      expect(r.text).not.toContain("write_disabled");
    });
  });

  describe("gate on", () => {
    it("should_list_every_write_tool", async () => {
      const names = (await listTools(true)).map((t) => t.name);
      const all = [...LISTED_WRITE_TOOLS, ...HIDDEN_WRITE_TOOLS];
      expect(all.filter((n) => names.includes(n))).toEqual(all);
    });

    it("should_announce_the_declared_annotations_unchanged", async () => {
      const tools = await listTools(true);
      const announced = LISTED_WRITE_TOOLS.map((n) => tools.find((t) => t.name === n)?.annotations);
      const declared = LISTED_WRITE_TOOLS.map((n) => allTools.find((t) => t.name === n)?.annotations);
      expect(announced).toEqual(declared);
    });

    it("should_not_refuse_a_write_call_with_write_disabled", async () => {
      const r = await call(true, "calibre_remove_book", { ids: [1], confirm: true });
      expect(r.code).not.toBe("write_disabled");
    });
  });
});

describe("write_disabled error code (#435)", () => {
  it("should_be_in_the_closed_error_code_set", () => {
    expect(ERROR_CODES).toContain("write_disabled");
  });

  it("should_name_the_mcp_side_gate_in_its_default_hint", () => {
    const hint = defaultHint("write_disabled" as never) ?? "";
    expect(hint).toContain("CALIBRE_MCP_ENABLE_WRITE=1");
    expect(hint).toContain("Enable writes");
  });

  it("should_keep_write_refused_on_the_calibre_side_remedy", () => {
    expect(defaultHint("write_refused")).not.toContain("CALIBRE_MCP_ENABLE_WRITE");
  });

  it("should_not_be_a_server_fault", () => {
    expect(isServerFault("write_disabled")).toBe(false);
  });
});

describe("assertWriteClassification write-call predicate (#435)", () => {
  it("should_require_a_write_call_declaration_from_every_write_tool", () => {
    const undeclared = {
      name: "calibre_rogue_writer",
      annotations: { readOnlyHint: false },
      write: true,
    } as unknown as AnyToolDescriptor;
    expect(() => assertWriteClassification([undeclared])).toThrow(/calibre_rogue_writer/);
  });

  it("should_declare_a_predicate_on_exactly_the_five_listed_write_tools", () => {
    const withPredicate = allTools.filter((t) => typeof t.writeCall === "function").map((t) => t.name);
    expect(withPredicate).toEqual(LISTED_WRITE_TOOLS);
  });
});

// The Unknown-bundle steer must not name a step the session cannot take (#435 last comment).
describe("Unknown bundle steer follows the write gate (#435)", () => {
  const SAVED = 'Integration status: False\nName: Rust\nSearch string: tags:"=Rust"\n';
  function depsFor(writeEnabled: boolean): BaseDeps {
    return {
      config: loadConfig(writeEnabled ? { CALIBRE_MCP_ENABLE_WRITE: "1" } : {}),
      content: { resolveLibraryId: async () => "Lib435", virtualLibraries: async () => ({}) },
      calibre: { calibredb: async () => ({ stdout: SAVED, stderr: "" }) },
      log,
    } as unknown as BaseDeps;
  }
  async function unknownBundleError(writeEnabled: boolean): Promise<string> {
    invalidateBundleCache();
    const out = await resolveFilter(depsFor(writeEnabled), { filter: "Golang", autoExclude: false });
    // the use case returns the fact; the tool layer words the steer (#518)
    return out.ok ? "" : filterErrorText(out, writeEnabled);
  }

  it("should_point_at_list_and_say_writes_are_needed_to_create_when_the_gate_is_off", async () => {
    const error = await unknownBundleError(false);
    expect(error).toContain('Unknown bundle "Golang". Available bundles: Rust.');
    expect(error).toContain('calibre_manage_bundles { action: "list" }');
    expect(error).toContain("CALIBRE_MCP_ENABLE_WRITE");
    expect(error).not.toContain('Create one with calibre_manage_bundles { action: "create" }');
  });

  it("should_keep_the_create_hint_when_the_gate_is_on", async () => {
    const error = await unknownBundleError(true);
    expect(error).toContain('Create one with calibre_manage_bundles { action: "create" }.');
  });
});

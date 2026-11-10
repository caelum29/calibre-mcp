// #432: book resource links carry the library ID — calibre://book/{libId}/{id} — so a link
// emitted from library A reads library A, never the default library. The legacy
// calibre://book/{id} form is dropped. Resources throw (protocol error), tools return.

import { afterEach, describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../../src/server.js";
import { bookResourceUri } from "../../src/shared/book-uri.js";
import { bookResourceLink } from "../../src/tools/resource-link.js";
import { readBookResource } from "../../src/resources/book.js";
import { searchTool } from "../../src/tools/calibre_search.js";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import type { ToolDeps } from "../../src/tools/deps.js";

const LIBRARY_MAP = { My_Books: "My Books", Other_Books: "Other Books" };

// Fake Content Server: library-info + one book; records every requested path.
function stubServer(): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const path = new URL(String(input)).pathname;
      seen.push(path);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === "/ajax/library-info") return json({ library_map: LIBRARY_MAP, default_library: "My_Books" });
      const m = /^\/ajax\/book\/(\d+)\/([^/]+)$/.exec(path);
      if (m) return json({ application_id: Number(m[1]), title: `Book ${m[1]} of ${m[2]}`, authors: ["A"] });
      return new Response("nope", { status: 404 });
    }),
  );
  return seen;
}

async function connect() {
  const server = buildServer({
    probes: false,
    env: {
      CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9",
      CALIBRE_MCP_CALIBREDB_PATH: "calibredb",
      CALIBRE_MCP_INDEX_DIR: ":memory:",
    },
  });
  const client = new Client({ name: "book-resource-test", version: "0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  return { client, close: () => Promise.allSettled([client.close(), server.close()]) };
}

afterEach(() => vi.unstubAllGlobals());

describe("book resource URI carries the library id (#432)", () => {
  it("should_build_the_uri_with_the_lib_id_segment", () => {
    expect(bookResourceUri(7, "My_Books")).toBe("calibre://book/My_Books/7");
  });

  it("should_emit_the_lib_id_in_a_resource_link", () => {
    const link = bookResourceLink({ id: 658, title: "T", authors: [] }, "Other_Books");
    expect(link.uri).toBe("calibre://book/Other_Books/658");
  });

  it("should_read_the_book_from_the_library_named_in_the_uri", async () => {
    const getBook = vi.fn(async () => ({ id: 42, title: "T" }) as never);
    const r = await readBookResource({ getBook }, 42, "Other_Books");
    expect(getBook).toHaveBeenCalledWith(42, "Other_Books");
    expect(r.uri).toBe("calibre://book/Other_Books/42");
  });
});

describe("calibre_search emits links for the library it searched (#432)", () => {
  const deps = (resolved: string): ToolDeps =>
    ({
      config: loadConfig({}),
      content: {
        resolveLibraryId: async () => resolved,
        search: async () => ({ bookIds: [42], total: 1, num: 1, offset: 0, sort: "title", libraryId: resolved }),
        booksByIds: async () => new Map([[42, { id: 42, title: "Plato", authors: ["P"] }]]),
      },
      calibre: {},
      log,
    }) as unknown as ToolDeps;
  const linkUris = (r: { content: { type: string; uri?: string }[] }) =>
    r.content.filter((b) => b.type === "resource_link").map((b) => b.uri);

  it("should_link_into_the_requested_non_default_library", async () => {
    const r = await searchTool.handler(
      { query: "Plato", mode: "meta", scope: "library", library: "Other_Books", limit: 20 },
      deps("Other_Books"),
    );
    expect(linkUris(r)).toEqual(["calibre://book/Other_Books/42"]);
  });

  it("should_name_the_default_library_explicitly_when_none_was_passed", async () => {
    const r = await searchTool.handler({ query: "Plato", mode: "meta", scope: "library", limit: 20 }, deps("My_Books"));
    expect(linkUris(r)).toEqual(["calibre://book/My_Books/42"]);
  });
});

describe("resources/read over the real server (#432)", () => {
  it("should_fetch_from_the_library_in_the_uri", async () => {
    const seen = stubServer();
    const { client, close } = await connect();
    try {
      const r = await client.readResource({ uri: "calibre://book/Other_Books/42" });
      expect(seen).toContain("/ajax/book/42/Other_Books");
      expect(JSON.stringify(r.contents)).toContain("Book 42 of Other_Books");
    } finally {
      await close();
    }
  });

  it("should_throw_naming_the_known_libraries_for_an_unknown_lib_id", async () => {
    stubServer();
    const { client, close } = await connect();
    try {
      await expect(client.readResource({ uri: "calibre://book/Nope/42" })).rejects.toThrow(/Other_Books/);
    } finally {
      await close();
    }
  });

  it("should_no_longer_resolve_the_legacy_one_segment_uri", async () => {
    const seen = stubServer();
    const { client, close } = await connect();
    try {
      await expect(client.readResource({ uri: "calibre://book/42" })).rejects.toThrow();
      expect(seen.filter((p) => p.startsWith("/ajax/book/"))).toEqual([]);
    } finally {
      await close();
    }
  });
});

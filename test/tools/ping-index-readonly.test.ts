// calibre_ping never opens an index file for writing (#318 → #325 review): every SQLite handle
// ping opens on a library's index is read-only — on a healthy index and on a damaged one whose
// meta is valid but whose tables are missing (a writable open would create the schema there).

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../../src/semantic/model.js";
import { SqliteIndexStore } from "../../src/semantic/store/index.js";
import type { ToolDeps } from "../../src/tools/deps.js";
import type { ToolResult } from "../../src/tools/types.js";
import { type PingDeps, pingTool as ping } from "../../src/tools/calibre_ping.js";

const { opens } = vi.hoisted(() => ({ opens: [] as Array<{ file: string; readOnly: boolean }> }));

// Record every connection opened, with its mode; behaviour is the real node:sqlite.
vi.mock("node:sqlite", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:sqlite")>();
  class RecordingDatabaseSync extends real.DatabaseSync {
    constructor(file: string, opts?: { readOnly?: boolean }) {
      super(file, opts ?? {});
      opens.push({ file: String(file), readOnly: opts?.readOnly === true });
    }
  }
  return { ...real, DatabaseSync: RecordingDatabaseSync };
});

const LIB = "Programming_Books";
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  opens.splice(0);
});

function tempIndexDir(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ping-ro-"));
  dirs.push(dir);
  return { dir, file: path.join(dir, `${LIB}.sqlite`) };
}

function deps(indexDir: string): PingDeps {
  const config = loadConfig({ CALIBRE_MCP_SERVER_URL: "http://127.0.0.1:9", CALIBRE_MCP_INDEX_DIR: indexDir });
  return {
    config,
    content: {
      resolveLibraryId: async () => LIB,
      libraryInfo: async () => ({ libraryMap: { [LIB]: "Programming Books" }, defaultLibrary: LIB }),
      search: async () => ({ total: 10 }),
    } as unknown as ToolDeps["content"],
    calibre: { listLibraries: async () => "" } as unknown as ToolDeps["calibre"],
    extractor: {} as ToolDeps["extractor"],
    figures: {} as ToolDeps["figures"],
    embedder: { loadState: () => "not-attempted" } as unknown as ToolDeps["embedder"],
    index: new SqliteIndexStore(config),
    log,
  };
}

const indexLine = (r: ToolResult): string | undefined =>
  r.content
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n")
    .split("\n")
    .find((l) => l.startsWith("Index:"));

const opensOf = (file: string) => opens.filter((o) => o.file === file);

describe("calibre_ping opens index files read-only (#325 review)", () => {
  it("should_report_a_damaged_index_with_valid_meta_as_unreadable_without_creating_its_schema", async () => {
    const { dir, file } = tempIndexDir();
    const seed = new DatabaseSync(file);
    seed.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)");
    seed.exec(
      `INSERT INTO meta VALUES ('model_id', '${MODEL_ID}'), ('dim', '${EMBED_DIM}'), ('index_version', '${INDEX_VERSION}')`,
    );
    seed.close();
    const bytes = readFileSync(file);
    opens.splice(0);

    const r = await ping.handler({}, deps(dir));

    expect({
      line: indexLine(r),
      unchanged: readFileSync(file).equals(bytes),
      files: readdirSync(dir),
      writableOpens: opensOf(file).filter((o) => !o.readOnly).length,
    }).toEqual({
      line: "Index: Programming Books: index unreadable",
      unchanged: true,
      files: [`${LIB}.sqlite`],
      writableOpens: 0,
    });
  });

  it("should_read_a_healthy_index_only_through_read_only_handles", async () => {
    const { dir, file } = tempIndexDir();
    const writer = new SqliteIndexStore(loadConfig({ CALIBRE_MCP_INDEX_DIR: dir }));
    writer.replaceBook(LIB, { bookId: 1, title: "Rust", authors: [] }, [{ body: "kw", charStart: 0, charEnd: 2 }]);
    writer.close();
    opens.splice(0);

    const r = await ping.handler({}, deps(dir));

    expect({
      line: indexLine(r),
      opened: opensOf(file).length > 0,
      writableOpens: opensOf(file).filter((o) => !o.readOnly).length,
    }).toEqual({
      line: "Index: Programming Books: 1/10 indexed (1 without embeddings)",
      opened: true,
      writableOpens: 0,
    });
  });
});

// Schema, migrations and meta of the per-library index db — and its ONE connection owner
// (#272): every concern module reaches SQLite through IndexConnections, so busy_timeout/WAL,
// the additive migrations and the INDEX_VERSION guard apply to every handle. The read-only
// meta peek (calibre_ping, #304) never creates a file or takes a write lock.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Config } from "../../config.js";
import type { LogSink } from "../../logging.js";
import { EMBED_DIM, INDEX_VERSION, MODEL_ID } from "../model.js";
import { type Row, WEIGHTED_BM25 } from "./shared.js";
import type { IndexMeta } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS books (
  book_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  last_modified TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL,
  embedded_chunks INTEGER
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_stem TEXT NOT NULL DEFAULT '',
  book_meta TEXT NOT NULL DEFAULT '',
  front_matter INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
  book_id INTEGER NOT NULL,
  vector BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings(book_id);

-- Keyword half: FTS5 external-content index over chunks. body_stem holds EN+RU pre-stemmed
-- text (recall); body holds raw text (exact/identifier matches); book_meta holds the stemmed
-- title+authors of the chunk's book so a query naming a book matches its chunks (weighted low
-- via ${WEIGHTED_BM25} — it helps, never dominates prose). book_meta is per-book-constant
-- repeated per chunk — accepted FTS bloat; external-content tables can't join at trigger time,
-- and the column name must match chunks' (FTS5 resolves content-table columns BY NAME).
-- tokenchars keep code tokens (e.g. c++, __init__, api.v2) intact. Kept in sync with chunks
-- via the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  body_stem, body, book_meta,
  content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, body_stem, body, book_meta) VALUES (new.id, new.body_stem, new.body, new.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body, book_meta) VALUES('delete', old.id, old.body_stem, old.body, old.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, body_stem, body, book_meta) VALUES('delete', old.id, old.body_stem, old.body, old.book_meta);
  INSERT INTO chunk_fts(rowid, body_stem, body, book_meta) VALUES (new.id, new.body_stem, new.body, new.book_meta);
END;

-- Figures (D-018 Phase B / #86): caption embeddings + the figure↔chunk join key.
-- char_offset indexes into the SAME marker-injected text the chunks were cut from, so
-- "the chunk containing this figure" is a pure range lookup — no extra bookkeeping.
-- Additive: CREATE IF NOT EXISTS runs on every open, so pre-figures dbs gain the empty
-- tables without an INDEX_VERSION bump (books fill them when re-indexed — the atomic
-- re-index is a separate step). vector is inline (nullable), not a side table: figure
-- counts are ~2 orders below chunk counts, the split isn't worth a join.
CREATE TABLE IF NOT EXISTS figures (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  fig_index INTEGER NOT NULL,
  page INTEGER NOT NULL,
  caption TEXT NOT NULL,
  caption_stem TEXT NOT NULL DEFAULT '',
  book_meta TEXT NOT NULL DEFAULT '',
  char_offset INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  source TEXT,
  width INTEGER,
  height INTEGER,
  vector BLOB
);
CREATE INDEX IF NOT EXISTS idx_figures_book ON figures(book_id);
CREATE VIRTUAL TABLE IF NOT EXISTS figure_fts USING fts5(
  caption_stem, caption, book_meta,
  content='figures', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);
CREATE TRIGGER IF NOT EXISTS figures_ai AFTER INSERT ON figures BEGIN
  INSERT INTO figure_fts(rowid, caption_stem, caption, book_meta) VALUES (new.id, new.caption_stem, new.caption, new.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS figures_ad AFTER DELETE ON figures BEGIN
  INSERT INTO figure_fts(figure_fts, rowid, caption_stem, caption, book_meta) VALUES('delete', old.id, old.caption_stem, old.caption, old.book_meta);
END;
CREATE TRIGGER IF NOT EXISTS figures_au AFTER UPDATE ON figures BEGIN
  INSERT INTO figure_fts(figure_fts, rowid, caption_stem, caption, book_meta) VALUES('delete', old.id, old.caption_stem, old.caption, old.book_meta);
  INSERT INTO figure_fts(rowid, caption_stem, caption, book_meta) VALUES (new.id, new.caption_stem, new.caption, new.book_meta);
END;
`;

/** Lazily opened per-library db handles: the single owner of every SQLite connection. */
export class IndexConnections {
  #dbs = new Map<string, DatabaseSync>();

  constructor(
    private readonly cfg: Config,
    private readonly log: LogSink,
  ) {}

  /** Cheap, side-effect-free check for an existing index (no db file is created). */
  has(libraryId: string): boolean {
    if (this.#dbs.has(libraryId)) return true;
    if (this.cfg.indexDir === ":memory:") return false;
    return existsSync(this.#file(libraryId));
  }

  /** The persisted meta, read WITHOUT the compatibility guard; never creates a db file. */
  peekMeta(libraryId: string): IndexMeta | undefined {
    if (!this.has(libraryId)) return undefined;
    // An already-open db passed #ensureMeta; otherwise peek read-only so a stale index is
    // described instead of refused (and nothing is migrated or written).
    const open = this.#dbs.get(libraryId);
    let db: DatabaseSync | undefined;
    try {
      db = open ?? new DatabaseSync(this.#file(libraryId), { readOnly: true });
      // Read-only can't switch journal mode, but must still wait out a concurrent writer (#196).
      if (!open) db.exec(`PRAGMA busy_timeout = ${this.cfg.indexBusyTimeoutMs}`);
      const kv = new Map<string, string>();
      for (const r of db.prepare("SELECT key, value FROM meta").all() as Row[]) {
        kv.set(String(r.key), String(r.value));
      }
      const indexVersion = Number(kv.get("index_version"));
      const dim = Number(kv.get("dim"));
      const modelId = kv.get("model_id");
      if (!modelId || !Number.isInteger(indexVersion) || !Number.isInteger(dim)) return undefined;
      const createdAt = kv.get("created_at");
      return { modelId, dim, indexVersion, ...(createdAt ? { createdAt } : {}) };
    } catch {
      return undefined; // no meta table / not a sqlite file — "no index" for provenance purposes
    } finally {
      if (!open) db?.close();
    }
  }

  /** Checkpoint and close every open db (a self-contained .sqlite to copy/move). */
  close(): void {
    for (const db of this.#dbs.values()) {
      // Fold the -wal side file back into the .sqlite so it is a self-contained file to copy/move.
      // Best-effort: another process reading the index can keep the checkpoint from completing.
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        /* checkpoint is an optimization; closing still succeeds */
      }
      db.close();
    }
    this.#dbs.clear();
  }

  /** Lazily open (and validate) the per-library db — the one place a writable handle is made. */
  db(libraryId: string): DatabaseSync {
    let db = this.#dbs.get(libraryId);
    if (db) return db;
    const file = this.#file(libraryId);
    if (file !== ":memory:") mkdirSync(this.cfg.indexDir, { recursive: true });
    db = new DatabaseSync(file);
    // Another server process (Desktop + Claude Code) may hold the same file (#196): wait on its
    // lock instead of failing at once, and use WAL so readers never block the writer. WAL is
    // persistent in the file; ":memory:" silently stays in "memory" mode.
    db.exec(`PRAGMA busy_timeout = ${this.cfg.indexBusyTimeoutMs}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    this.#migrate(db);
    this.#ensureMeta(db);
    this.#dbs.set(libraryId, db);
    return db;
  }

  /**
   * Additive, idempotent migrations for dbs created before a column existed. Deliberately NOT
   * an INDEX_VERSION bump: DEFAULT 0 = pre-flag behavior, so a full-library rebuild isn't
   * forced — books pick the flag up when re-indexed.
   */
  #migrate(db: DatabaseSync): void {
    const cols = db.prepare("PRAGMA table_info(chunks)").all() as Row[];
    if (!cols.some((c) => c.name === "front_matter")) {
      db.exec("ALTER TABLE chunks ADD COLUMN front_matter INTEGER NOT NULL DEFAULT 0");
      this.log.info("index migrated: chunks.front_matter added");
    }
    // #197: per-book embedded-chunk count, so freshness can tell keyword-only from embedded
    // entries. NULL (legacy rows) = unknown → readers count the embeddings table instead.
    const bookCols = db.prepare("PRAGMA table_info(books)").all() as Row[];
    if (!bookCols.some((c) => c.name === "embedded_chunks")) {
      db.exec("ALTER TABLE books ADD COLUMN embedded_chunks INTEGER");
      this.log.info("index migrated: books.embedded_chunks added");
    }
  }

  /** Write index metadata on a fresh db; refuse to use one built by a different model/version. */
  #ensureMeta(db: DatabaseSync): void {
    const existing = new Map<string, string>();
    for (const r of db.prepare("SELECT key, value FROM meta").all() as Row[]) {
      existing.set(String(r.key), String(r.value));
    }
    const want: Record<string, string> = {
      model_id: MODEL_ID,
      dim: String(EMBED_DIM),
      index_version: String(INDEX_VERSION),
    };
    if (existing.size === 0) {
      const ins = db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)");
      for (const [k, v] of Object.entries(want)) ins.run(k, v);
      db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)").run("created_at", new Date().toISOString());
      return;
    }
    for (const [k, v] of Object.entries(want)) {
      if (existing.get(k) !== v) {
        throw new Error(
          `INDEX_INCOMPATIBLE: index built with ${k}=${existing.get(k)} but this server uses ${v}. ` +
            `Delete the index and rebuild (calibre_build_index force=true).`,
        );
      }
    }
  }

  /** Db path for a library (no fs side effects). ":memory:" when the index dir is in-memory. */
  #file(libraryId: string): string {
    if (this.cfg.indexDir === ":memory:") return ":memory:";
    // Sanitize the library id into a safe filename component.
    const safe = libraryId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
    return path.join(this.cfg.indexDir, `${safe}.sqlite`);
  }
}

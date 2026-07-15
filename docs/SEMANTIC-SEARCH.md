# SEMANTIC-SEARCH.md — Calibre MCP semantic search design

> Source of record for the embedding/extraction/chunking/retrieval pipeline.
> Derived from first-party-verified research (2026-06-28). Supersedes the model
> lock note in `docs/TOOLS.md` #5. See "Open items" for things to confirm at
> implementation time.

## 0. Scope

Semantic search spans two surfaces via a `scope: library | book` param (no extra
tools): across the whole library OR within one book. Same index, same pipeline;
`scope=book` just filters to one `book_id`.

Target corpus: ~801 mostly-technical PDF/EPUB books, EN + RU, ~240k chunks
worst-case. Node v24, macOS Apple Silicon, stdio. transformers.js = CPU-only
(`onnxruntime-node`; no Metal/WebGPU — that path is browser-only).

## 1. Embedding model — `multilingual-e5-small` (was: MiniLM)

**Decision:** lock to `Xenova/multilingual-e5-small` (q8), 384-dim, 512-token.
Replaces `paraphrase-multilingual-MiniLM-L12-v2`. HIGH confidence.

Why the swap is strictly-better and near-free:
- Same 384-dim → storage + brute-force compute unchanged.
- Same q8 ONNX size (~118 MB) and ~118M params → same download/RAM/throughput.
- 128 → **512 token window** (decisive: MiniLM truncates most technical
  paragraphs at 128 tokens, silently).
- Verified Russian retrieval (ruMTEB 56.4, Mr.TyDi 64.4) vs MiniLM having no
  retrieval benchmark at all (it is a paraphrase/STS model, not retrieval-tuned).

**Mandatory usage (from the model card):**
- Prefix every input: `"query: "` on search text, `"passage: "` on stored chunks.
  For symmetric similarity use `"query: "` on both sides. Card states perf
  degrades without prefixes. Bake into the embed wrapper so it can't be skipped.
- Pooling = mask-weighted mean. Normalize L2 at write time (cosine = dot).

**Documented escape hatches (NOT v1):**
- `gte-multilingual-base` — 768-dim, 8192 ctx, no prefixes. Take if the 512 cap
  bites. Costs 2× storage (~737 MB), ~2.7× query compute, ~2-3× slower index.
- `bge-m3` — verified best RU retriever (RU-Retrieval 74.8, MIRACL 0.678) but
  570 MB model, ~983 MB vectors, external-weights ONNX, 8-20h CPU reindex.
  Reserve as a "max-quality offline-index" tier.

Indexing: ~1-2h full 240k-chunk index for e5-small on CPU; parallelize across
worker threads (one ORT session each). Measure on the real box before locking.

## 2. Extraction

### Decision tree

```
INGEST(file)
├─ EPUB / MOBI / AZW3 / structured
│    └─ @lingo-reader/epub-parser → spine-ordered XHTML → strip → chunks{spine_index, href}
│       (fallback: ebook-convert … --txt-output-formatting=markdown)
│
└─ PDF
     │  PyMuPDF subprocess: pymupdf4llm.to_markdown(page_chunks=True)
     │    → per-page markdown + metadata.page (citation anchor)
     │  + roll-your-own recurring-(text,y) header/footer strip on get_text("blocks")
     │  + `margins` band for cheap running-head/foot suppression
     │
     ├─ page returns text (born-digital — common case) → chunk, attach {book_id, page}  [NO OCR]
     └─ image-only / zero-text (len(text)<~15, image ≥~90% area)
          └─ scanned → ocrmypdf -l rus+eng --skip-text → re-extract
```

### Key points
- **PDF → PyMuPDF, not `ebook-convert`.** Calibre manual: "PDF is a really,
  really bad format… decent to unusable" (it shells poppler `pdftohtml`: no
  layout/columns/in-page location). PyMuPDF gives clean markdown + per-page
  numbers (Calibre FTS is book-level only — page-level location is the win).
- **`ebook-convert` IS a fine EPUB fallback** (`--txt-output-formatting=markdown`).
- **Process boundary:** PyMuPDF + mupdf.js are both AGPL. Use **PyMuPDF as a
  Python subprocess** (execFile array, JSON over stdout) → AGPL stays in a
  separate program, same posture as shelling `calibredb`. **mupdf.js WASM is
  off the table** — in-process linking propagates AGPL despite zero native deps.
  Permissive pure-JS fallback when no Python on host: `unpdf` (MIT) /
  `pdfjs-dist` (Apache) — degraded, no markdown/OCR.
- **OCR gated, the exception:** detect zero-text/image-only pages, then
  `ocrmypdf -l rus+eng --skip-text`. Born-digital skips OCR (OCR degrades vs
  embedded glyphs). RU needs Tesseract `rus` traineddata.
- **EPUB lib:** `@lingo-reader/epub-parser` (MIT, Node-native, maintained) —
  spine-ordered XHTML + chapter titles; location = `{spine_index, href}`.

## 3. Chunking + tokenization

- **Token-count with the model's own tokenizer**, never chars:
  `AutoTokenizer.from_pretrained("Xenova/multilingual-e5-small")` (loads only
  tokenizer.json, cheap). RU GOTCHA: Cyrillic tokenizes ~1.5-2× denser than
  Latin (~2-2.5 chars/tok vs ~4) → a char-based size overflows RU past 512 and
  truncates the tail of every Russian chunk. Token length fn is mandatory.
- **Two-stage splitter** (libs `MarkdownHeaderTextSplitter` /
  `semantic-text-splitter` are Python-only — not on npm):
  1. Own markdown-header split (regex / mdast) → sections + heading-path metadata.
  2. LangChain JS `RecursiveCharacterTextSplitter` with a transformers.js
     `lengthFunction` (it's awaited → async ok) for token budget + overlap.
- **Defaults:** body ~460-480 tokens, ~60-token (13%) **token-based** overlap,
  separators `["\n## ","\n### ","\n\n","\n",". "," ",""]`.
- **Recover char offsets yourself** (running `indexOf`); most splitters drop
  them and LangChain's `loc.lines` is wrong under a token length fn.
- **Chunk payload:** `{book_id, heading_path, page (PDF) | spine_index (EPUB),
  char_start, char_end, token_count}` → powers `scope=book` + citations.
- **Deterministic context-prepend ($0, v1):** embed
  `[{book_title} › {author} › {heading_path}]\n{chunk}`. Captures most of
  Anthropic Contextual Retrieval's benefit without the LLM cost.
- **Contextual Retrieval (LLM): defer.** Whole-book re-read per chunk ≈ 45M
  cache-read tok/book → ~$1-1.5k to index the corpus. Revisit chapter-scoped only.
- **Late chunking: not feasible** (needs 8k-context embedder + token-level output).

## 4. Retrieval + storage

- **Vector half:** pure-JS flat `Float32Array` brute force as the
  dependency-free default — 368 MB, ~150-250 ms/query single-threaded
  (pre-normalized → cosine = dot). Behind a `VectorIndex` interface so
  **`sqlite-vec` is an opt-in fast path** (~5-10× faster but native extension +
  macOS quarantine risk for npx/MCPB; also brute-force only — its ANN is alpha).
- **Keyword half:** SQLite FTS5 external-content + BM25 (`ORDER BY rank`).
  Note FTS5 `bm25()` returns NEGATIVE scores (best = most negative) — don't ABS.
- **RU keyword GOTCHA → Node-side pre-stemming.** FTS5 `porter` is English-only;
  `unicode61` does zero stemming (книга/книги/книгу don't match); `trigram`
  bloats ~18×; better-sqlite3 can't bind a custom C tokenizer. So: pre-stem in
  Node before INSERT — per-token script detect (Cyrillic vs Latin don't
  overlap) → Snowball `russian`/`english`, leave code/identifiers raw,
  normalize ё→е; apply identical transform to queries. Keep a 2nd raw
  `unicode61` column for exact/identifier/ISBN queries.
- **Fusion: RRF, k=60, on RANKS ONLY** (no score normalization — sidesteps the
  cosine-[0,1] vs BM25-negative mismatch by construction). Weighted-RRF seam
  (`wᵢ/(k+rank)`, per-source weights) shipped with both weights at 1.0 —
  named constants, tuned only through `test/eval/retrieval`.
- **FTS sees book identity via `book_meta`** — stemmed title+authors indexed as
  a third `chunk_fts` column (per-book-constant repeated per chunk, accepted
  bloat), bm25-weighted `1.0, 1.0, 0.5` so meta helps but never outranks prose.
  The vector half already gets identity from the embedded `[title › authors]`
  context prefix; this closes the same gap on the keyword half.
- **Reranking: SHIPPED always-on (D-011, 2026-07-08; hardened 2026-07-09).**
  Cross-encoder `bge-reranker-v2-m3` (568M, q8 ONNX ≈ 576 MB one-time download,
  pre-warmed by `calibre_build_index`) reranks the top-30 fused candidates for
  hybrid/vector when the optional model is present; candidates past the 30-cap
  keep their fused order (no rerank score claimed). Unavailable/failing model
  degrades to the fused order with a note; `CALIBRE_MCP_RERANK=off` disables.
  Keyword mode skips it. jina-reranker was rejected (CC-BY-NC).
- **Per-book scope:** store vectors grouped by `book_id` (contiguous → subarray
  slice); FTS via indexed `book_id` column on external content.

### Schema sketch

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL,
  location TEXT NOT NULL,        -- PDF page / EPUB spine pointer
  body TEXT NOT NULL,            -- raw chunk (snippets, exact match)
  body_stem TEXT NOT NULL,       -- pre-stemmed EN+RU, for recall
  book_meta TEXT NOT NULL,       -- stemmed title+authors (same name in FTS: external
                                 -- content resolves columns BY NAME)
  front_matter INTEGER NOT NULL DEFAULT 0  -- majority of chunk before the first chapter
);                               -- (frontMatterEnd at index time, D-016; additive migration)
CREATE INDEX idx_chunks_book ON chunks(book_id);

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  body_stem, body, book_meta, content='chunks', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_+#.'''
);  -- + AFTER INSERT/DELETE/UPDATE sync triggers (delete via 'delete' cmd)
    -- queries rank by bm25(chunk_fts, 1.0, 1.0, 0.5) — meta helps, never dominates

CREATE TABLE embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
  book_id INTEGER NOT NULL,
  vector BLOB NOT NULL          -- 384 × Float32 LE = 1536 B, L2-normalized
);
CREATE INDEX idx_emb_book ON embeddings(book_id);
-- opt-in: CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, book_id INTEGER, embedding FLOAT[384]);
```

### Retrieval flow

```
query
 ├─ embed ("query: " prefix; e5 requires it)
 ├─ stem query (same EN+RU transform as ingest)
 ├─ VECTOR: JS dot scan (or sqlite-vec) → top-50   [scope=book → subarray slice]
 ├─ FTS:    MATCH stemmed_query (body_stem|body|book_meta, bm25 1/1/.5) → top-50 [scope=book → AND book_id=?]
 ├─ RRF fuse (k=60, 1-based ranks, no normalization; weighted seam, both 1.0) → top-N
 ├─ cross-encoder rerank of the fused top-30 → emit topK (always-on when the optional
 │  model is present, D-011; fused-order tail past the cap; degrades to fused order
 │  when the model is absent/failing or CALIBRE_MCP_RERANK=off)
 └─ scope=book only: stable-partition front-matter chunks below body matches (D-016,
    issue #18 — TOC/praise/foreword are keyword-dense but semantically empty; nothing
    is dropped, demoted hits carry a "[front matter]" label + a note)
 → {chunk_id, book_id, location, snippet}
```

## 5. Open items (confirm at implementation time)

1. pymupdf4llm key name: `page` vs `page_number` on the installed version.
2. AGPL aggregation-vs-linking reading for the Python subprocess (conventional
   interpretation, not a quoted legal source).
3. Real M-series throughput for e5-small under transformers.js (measure).
4. transformers.js cache/cold-start location + first-run download UX.

## Sources

ruMTEB arXiv 2408.12503 · encodechka · HF cards (intfloat/multilingual-e5-*,
Alibaba-NLP/gte-multilingual-base, BAAI/bge-m3) · pymupdf4llm + PyMuPDF docs ·
Calibre manual (ebook-convert/conversion) · @lingo-reader/epub-parser ·
sqlite.org/fts5.html · alexgarcia.xyz/sqlite-vec · WiseLibs/better-sqlite3 ·
Cormack SIGIR'09 RRF · Anthropic Contextual Retrieval · Jina late chunking.

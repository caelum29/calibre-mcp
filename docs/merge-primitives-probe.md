# Merge primitives — live Content Server probe (2026-07-19)

Firsthand probe for the `calibre_merge_books` effort (wayfinder map #40, ticket #37): every
primitive the merge composition needs, exercised against the **running GUI's Content Server**
(`http://localhost:8080`) via the locked routed write path
(`calibredb --with-library http://localhost:8080/#<libId>`), on throwaway records
(book ids 920 "ZZZ Probe Dest" / 921 "ZZZ Probe Source", scrap EPUBs, now trash-removed).

Environment at probe time: **calibre 9.11** (docs elsewhere say 9.10 — bumped since),
macOS, GUI open, Programming_Books served. `calibredb` invoked as
`/Applications/calibre.app/Contents/MacOS/calibredb` (not on PATH).

## 1. `add_format` routed — WORKS, including file upload

```bash
calibredb add_format 920 /path/probe-extra.txt --with-library 'http://localhost:8080/#Programming_Books'
```

- File upload over `/cdb/cmd` works: local file, GUI open, new format committed.
- **Latency:** the new format was visible in `/ajax/book` ~0.1 s *after* the CLI returned
  (first 100 ms poll hit). Effectively immediate; the #33 timeout-verify lesson still applies.
- **`--dont-replace` collision** (dest already has that format):
  **exit code 1**, message on **stderr**: `A EPUB file already exists for book: 920, not replacing`.
  The merge loop must treat this exact case as a *benign skip*, not a failure — match on the
  message or pre-check formats and never issue the colliding call.

## 2. `set_metadata` expressiveness — routed

All via `--field` on the server URL, GUI open:

| Field | Probe | Result |
|---|---|---|
| `identifiers:a:1,b:2` | set `isbn:…,probe1:aaa`, then `probe2:bbb` | **REPLACES the whole dict** — only `probe2` survived. Union must be computed client-side and written whole. |
| `tags:a,b` | set `probeA,probeB`, then `probeC` | **Replaces** too. Same client-side-union rule for every multi-value field. |
| `comments:…` | HTML + a real `\n` in the arg | Preserved **verbatim** (`<b>`, `&amp;`, newline all intact in `/ajax` read-back). |
| `cover:/local/path.png` | local PNG, routed | **Works** — file upload over `/cdb/cmd`; `/ajax` shows `cover: /get/cover/920/…`. |

### Custom columns (`--field '#label:value'`)

No live library has custom columns (checked all three), and a second `calibre-server`
**cannot run while the GUI is open** (see §5) — so `#col` was probed **locally** on a scratch
library with one column per datatype. The routed path uses the same `/cdb/cmd set_metadata`
command with identical `--field` parsing server-side, so encodings are expected to transfer;
flagged as inference, not live-verified.

Verified encodings (all round-tripped exactly via `list --for-machine`):

| Datatype | Write | Read-back |
|---|---|---|
| text | `#pt:plain text value` | string |
| text `--is-multiple` | `#pm:tagA,tagB` | `["tagA","tagB"]` — later writes **replace** (client-side union again) |
| int | `#pi:42` | `42` |
| float | `#pf:3.14` | `3.14` |
| bool | `#pb:true` / `#pb:false` | `true` / `false` |
| datetime | `#pd:2026-07-19` | `2026-07-19T00:00:00+00:00` |
| series | `#ps:My Series [3]` | name `My Series` (bracket index accepted; `list` shows name only) |
| enumeration | `#pe:beta` | `beta` (must match `enum_values`) |

`add_custom_column` syntax gotcha: positional order is `label name datatype`
(e.g. `calibredb add_custom_column --with-library <lib> pt "Probe Text" text`).

## 3. `/get/FMT/<id>/<libId>` download — clean temp-file source

```
GET http://localhost:8080/get/EPUB/921/Programming_Books
Content-Disposition: attachment; filename="ZZZ Probe Source - Probe Author_921.epub"
Content-Type: application/epub+zip   Content-Length: 6648
```

- Extension in the filename is correct → safe to derive the temp filename (and hence the
  format `add_format` infers) from `Content-Disposition`, or just name it `<id>.<fmt>` ourselves.
- Note: the served bytes are **not** the originally-added file (1 266 B in → 6 648 B out) —
  calibre rewrites EPUB metadata on add. Irrelevant for merge (we move whatever the library holds).
- Downloaded fine with plain `curl` to the session temp dir; no size or lifecycle issues at probe scale.

## 4. `/ajax/book` read-back shape

- Formats appear in **both** `formats` (lowercase list, e.g. `['epub','txt']`) and
  `format_metadata` (dict keyed by lowercase format). Either works for the post-add verify step.
- After routed `remove`, `/ajax/book/<id>` returns **404** immediately.

## 5. `remove` without `--permanent` routed — RECOVERABLE

```bash
calibredb remove 921 --with-library 'http://localhost:8080/#Programming_Books'   # exit 0
```

Book 921 appeared in `<library>/.caltrash/b/921` → restorable from the GUI's
"recently deleted" (trash auto-expires, default 14 days). **Merge should always use the
non-permanent remove** for its delete-sources step; `--permanent` is unnecessary risk.

## 6. Environment findings (test-strategy relevant)

- **The calibre singleton lock is global for *server processes*, per-library for `calibredb`.**
  While the GUI runs: local `calibredb add`/`set_metadata`/`add_custom_column` against a
  *different* (scratch) library works fine, but `calibre-server` refuses to start at all:
  `Another calibre program such as another instance of calibre-server or the main calibre
  program is running.` → routed end-to-end tests need the GUI closed (fine in CI, which has
  no GUI); scratch-library *local* fixtures work any time, even mid-GUI-session.
- Throwaway records are cheap and safe: scrap EPUB → `calibredb add` routed → probe →
  non-permanent `remove` (lands in trash). A minimal valid EPUB is ~1 KB of zip.
- `calibredb` prints `Using proxies: {...}` on **stdout** when proxy env vars are set
  (our sandbox does this) — one more reason the stdout-parsing layer must tolerate/strip
  leading noise lines.

## Dead ends

- Probing `#col` writes over the *live* routed path: impossible today (no custom columns in
  any served library; can't serve the scratch library alongside the GUI — global server lock).
- `remove --permanent` routed: untested (blocked mid-probe; also not needed — see §5).

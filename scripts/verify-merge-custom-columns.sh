#!/usr/bin/env bash
# One-time ROUTED custom-column verification for calibre_merge_books (spec #50 §8 layer 3).
#
# The live probe (docs/merge-primitives-probe.md §2) could only verify #col encodings on a
# LOCAL scratch library: no served library has custom columns, and a second calibre-server
# can't start while the GUI runs (global server-process lock, probe §6). This script closes
# that gap: with the GUI CLOSED, it serves a generated scratch library that has one custom
# column per datatype, writes every encoding through the ROUTED path
# (calibredb --with-library http://localhost:<port>/#lib), and diffs the read-back.
#
# Usage:  quit the Calibre GUI, then  ./scripts/verify-merge-custom-columns.sh
# Attach the transcript to spec issue #50 (acceptance criterion).

set -euo pipefail

CALIBREDB="${CALIBREDB:-/Applications/calibre.app/Contents/MacOS/calibredb}"
CALIBRE_SERVER="${CALIBRE_SERVER:-/Applications/calibre.app/Contents/MacOS/calibre-server}"
PORT="${PORT:-8199}"

if pgrep -xq calibre; then
  echo "ERROR: the Calibre GUI is running — quit it first (the server-process lock is global)." >&2
  exit 1
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/calibre-merge-verify.XXXXXX")"
LIB="$SCRATCH/lib"
mkdir -p "$LIB"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

echo "== scratch library: $LIB"

# One column per merge-relevant datatype (add_custom_column order: label name datatype).
"$CALIBREDB" --with-library "$LIB" add_custom_column pt "Probe Text" text >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pm "Probe Multi" text --is-multiple >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pi "Probe Int" int >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pf "Probe Float" float >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pb "Probe Bool" bool >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pd "Probe Date" datetime >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column ps "Probe Series" series >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pe "Probe Enum" enumeration \
  --display '{"enum_values": ["alpha", "beta"]}' >/dev/null
"$CALIBREDB" --with-library "$LIB" add_custom_column pc "Probe Comments" comments >/dev/null

BOOK_TXT="$SCRATCH/scrap.txt"
echo "merge verify scrap" > "$BOOK_TXT"
"$CALIBREDB" --with-library "$LIB" add "$BOOK_TXT" --title "ZZZ Merge Verify" >/dev/null
# calibredb can prepend/append noise lines (e.g. "Using proxies: …", probe §6) —
# parse the JSON array from the first "[" with raw_decode, ignoring trailing junk.
BOOK_ID="$("$CALIBREDB" --with-library "$LIB" list --for-machine | python3 -c '
import json, sys
s = sys.stdin.read()
data, _ = json.JSONDecoder().raw_decode(s[s.index("["):])
print(data[0]["id"])')"
echo "== scrap book id: $BOOK_ID"

echo "== starting calibre-server on :$PORT (local writes enabled)"
"$CALIBRE_SERVER" --port "$PORT" --enable-local-write "$LIB" &>"$SCRATCH/server.log" &
SERVER_PID=$!
for _ in $(seq 1 30); do
  curl -fsS "http://localhost:$PORT/ajax/library-info" >/dev/null 2>&1 && break
  sleep 0.5
done
LIB_ID="$(curl -fsS "http://localhost:$PORT/ajax/library-info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["default_library"])')"
ROUTED="http://localhost:$PORT/#$LIB_ID"
echo "== routed library URL: $ROUTED"

# Every encoding calibre_merge_books emits, written through the ROUTED path.
"$CALIBREDB" --with-library "$ROUTED" set_metadata "$BOOK_ID" \
  --field '#pt:plain text value' \
  --field '#pm:tagA,tagB' \
  --field '#pi:42' \
  --field '#pf:3.14' \
  --field '#pb:true' \
  --field '#pd:2026-07-19' \
  --field '#ps:My Series [3]' \
  --field '#pe:beta' \
  --field '#pc:first note' >/dev/null

# Union-replacement check: a second multi write must REPLACE, proving unions are client-side.
"$CALIBREDB" --with-library "$ROUTED" set_metadata "$BOOK_ID" --field '#pm:tagA,tagB,tagC' >/dev/null

echo "== routed read-back:"
# The checker must be a FILE: piping into `python3 - <<EOF` would let the heredoc
# clobber the piped list output on stdin.
cat > "$SCRATCH/check.py" <<'EOF'
import json, sys
s = sys.stdin.read()
books, _ = json.JSONDecoder().raw_decode(s[s.index("["):])
book = next(b for b in books if b["id"] == int(sys.argv[1]))
expected = {
    "*pt": "plain text value",
    "*pm": ["tagA", "tagB", "tagC"],
    "*pi": 42,
    "*pf": 3.14,
    "*pb": True,
    "*ps": "My Series",
    "*pe": "beta",
    "*pc": "first note",
}
failures = []
for field, want in expected.items():
    got = book.get(field)
    ok = sorted(got) == sorted(want) if isinstance(want, list) else got == want
    print(f"  {'PASS' if ok else 'FAIL'} {field}: {got!r}" + ("" if ok else f" (expected {want!r})"))
    if not ok:
        failures.append(field)
pd = str(book.get("*pd", ""))
ok = pd.startswith("2026-07-19")
print(f"  {'PASS' if ok else 'FAIL'} *pd: {pd!r}")
if not ok:
    failures.append("*pd")
sys.exit(1 if failures else 0)
EOF
"$CALIBREDB" --with-library "$ROUTED" list --for-machine \
  --fields '*pt,*pm,*pi,*pf,*pb,*pd,*ps,*pe,*pc' | python3 "$SCRATCH/check.py" "$BOOK_ID"

echo "== ALL ROUTED CUSTOM-COLUMN ENCODINGS VERIFIED"

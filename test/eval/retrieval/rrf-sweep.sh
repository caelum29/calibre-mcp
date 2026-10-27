#!/usr/bin/env bash
# #142 weighted-RRF sweep driver: for each VECTOR_RRF_WEIGHT, temporarily rewrites the constant in
# calibre_semantic_search.ts (no config/env surface for the weights, by design), runs the three
# declared measurements (fixtureOn / fixtureOff / liveOn, hybrid only — vector/keyword don't
# depend on the weights), then restores the file. Score the reports with rrf-sweep.ts.
#
# Usage: test/eval/retrieval/rrf-sweep.sh [weight ...]   (default: 1.0 1.25 1.5 2.0)
set -euo pipefail
cd "$(dirname "$0")/../../.."
SRC=src/tools/calibre_semantic_search.ts
WEIGHTS=("${@:-1.0 1.25 1.5 2.0}")
read -r -a WEIGHTS <<<"${WEIGHTS[*]}"

cp "$SRC" "$SRC.sweep-bak"
trap 'mv "$SRC.sweep-bak" "$SRC"' EXIT

for w in "${WEIGHTS[@]}"; do
  sed -E "s/^const VECTOR_RRF_WEIGHT = [0-9.]+;/const VECTOR_RRF_WEIGHT = ${w};/" "$SRC.sweep-bak" >"$SRC"
  grep -q "^const VECTOR_RRF_WEIGHT = ${w};" "$SRC" || { echo "failed to set weight $w" >&2; exit 1; }
  echo "[sweep] w=$w fixtureOn" >&2
  pnpm -s eval --modes hybrid --tag "rrf142-w${w}-on"
  echo "[sweep] w=$w fixtureOff" >&2
  pnpm -s eval --modes hybrid --rerank off --tag "rrf142-w${w}-off"
  echo "[sweep] w=$w liveOn" >&2
  pnpm -s eval --modes hybrid --live --tag "rrf142-w${w}-on"
done

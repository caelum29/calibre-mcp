#!/usr/bin/env bash
# #142 weighted-RRF sweep driver: for each VECTOR weight (keyword stays 1.0), runs the three
# declared measurements (fixtureOn / fixtureOff / liveOn, hybrid only — vector/keyword don't
# depend on the weights) with `--rrf-weights`, which reaches retrieve()'s opts.rrfWeights
# (#259) — no source edits. Score the reports with rrf-sweep.ts.
#
# Usage: test/eval/retrieval/rrf-sweep.sh [weight ...]   (default: 1.0 1.25 1.5 2.0)
set -euo pipefail
cd "$(dirname "$0")/../../.."
WEIGHTS=("${@:-1.0 1.25 1.5 2.0}")
read -r -a WEIGHTS <<<"${WEIGHTS[*]}"

for w in "${WEIGHTS[@]}"; do
  echo "[sweep] w=$w fixtureOn" >&2
  pnpm -s eval --modes hybrid --rrf-weights "${w},1.0" --tag "rrf142-w${w}-on"
  echo "[sweep] w=$w fixtureOff" >&2
  pnpm -s eval --modes hybrid --rrf-weights "${w},1.0" --rerank off --tag "rrf142-w${w}-off"
  echo "[sweep] w=$w liveOn" >&2
  pnpm -s eval --modes hybrid --rrf-weights "${w},1.0" --live --tag "rrf142-w${w}-on"
done

#!/bin/zsh
set -euo pipefail

ROOT=${0:A:h:h}
UV_CACHE_DIR="$ROOT/.build/uv-cache"
PROJECT="$ROOT/ContentProduction/chatterbox-audition"
DEVICE=${NARRATION_DEVICE:-mps}
BACKEND=${NARRATION_BACKEND:-mlx-audio}
# The whole-utterance pilot showed that a German MLX startup can transiently
# consume about 5.4 GiB before its first checkpoint. Requiring 16.5 GiB avoids
# wasteful launch/kill cycles while preserving the 10 GiB floor plus the 1 GiB
# early-stop buffer throughout model initialization.
START_HEADROOM_GIB=${NARRATION_START_HEADROOM_GIB:-16.5}
# Keep the lifecycle owner waiting through an overnight memory window instead of
# exiting after the runner's five-minute diagnostic default.
WAIT_SECONDS=${NARRATION_WAIT_SECONDS:-43200}
# Sixteen units amortize one full-native MLX model load; the guard still owns
# one child and every checkpoint write remains atomic. The residency option is
# retained only for the explicit PyTorch fallback backend.
NEW_UNITS_PER_CHILD=${NARRATION_NEW_UNITS_PER_CHILD:-16}
MPS_RESIDENCY_STRATEGY=${NARRATION_MPS_RESIDENCY_STRATEGY:-phase-batched}

cd "$ROOT"
/usr/bin/python3 "$ROOT/scripts/run_narration_guarded.py" \
  --backend "$BACKEND" \
  --language en \
  --language de \
  --all \
  --device "$DEVICE" \
  --start-headroom-gib "$START_HEADROOM_GIB" \
  --wait-seconds "$WAIT_SECONDS" \
  --checkpoint-retries 100 \
  --checkpoint-continuations 5000 \
  --one-new-unit-per-child \
  --new-units-per-child "$NEW_UNITS_PER_CHILD" \
  --mps-residency-strategy "$MPS_RESIDENCY_STRATEGY" \
  --resume \
  --report "$ROOT/.evidence/audio/narration-memory-guard-full.json"
uv run --cache-dir "$UV_CACHE_DIR" --offline --frozen --project "$PROJECT" --no-sync \
  python "$ROOT/scripts/validate_narration_candidates.py" --all --write-public-summary

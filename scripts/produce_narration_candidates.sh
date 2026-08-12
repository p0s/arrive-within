#!/bin/zsh
set -euo pipefail

ROOT=${0:A:h:h}
UV_CACHE_DIR="$ROOT/.build/uv-cache"
PROJECT="$ROOT/ContentProduction/chatterbox-audition"
DEVICE=${NARRATION_DEVICE:-mps}
START_HEADROOM_GIB=${NARRATION_START_HEADROOM_GIB:-22}

cd "$ROOT"
/usr/bin/python3 "$ROOT/scripts/run_narration_guarded.py" \
  --language en \
  --language de \
  --all \
  --device "$DEVICE" \
  --start-headroom-gib "$START_HEADROOM_GIB" \
  --checkpoint-retries 100 \
  --checkpoint-continuations 5000 \
  --one-new-unit-per-child \
  --resume \
  --report "$ROOT/.evidence/audio/narration-memory-guard-full.json"
uv run --cache-dir "$UV_CACHE_DIR" --offline --frozen --project "$PROJECT" --no-sync \
  python "$ROOT/scripts/validate_narration_candidates.py" --all --write-public-summary

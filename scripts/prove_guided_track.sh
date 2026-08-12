#!/bin/zsh
set -euo pipefail

ROOT=${0:A:h:h}
UV_CACHE_DIR="$ROOT/.build/uv-cache"
PROJECT="$ROOT/ContentProduction/chatterbox-audition"
DEVICE=${NARRATION_DEVICE:-auto}

cd "$ROOT"
/usr/bin/python3 "$ROOT/scripts/run_narration_guarded.py" \
  --language en \
  --language de \
  --practice G01 \
  --device "$DEVICE" \
  --resume
uv run --cache-dir "$UV_CACHE_DIR" --offline --frozen --project "$PROJECT" --no-sync \
  python "$ROOT/scripts/validate_narration_candidates.py" --practice G01 --write-public-summary

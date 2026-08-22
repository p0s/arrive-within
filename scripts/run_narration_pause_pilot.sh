#!/bin/zsh
set -euo pipefail

# Private, guarded whole-utterance pilot. The generator writes lossless model
# PCM and masters each complete track once; existing AAC is never generation
# input. One host-wide accelerated worker owns both language runs sequentially.
ROOT=${0:A:h:h}
UV_CACHE_DIR="$ROOT/.build/uv-cache"
PROJECT="$ROOT/ContentProduction/chatterbox-audition"
DEVICE=${NARRATION_DEVICE:-mps}
BACKEND=${NARRATION_BACKEND:-mlx-audio}
VERSION="chatterbox-production-candidates-v4-whole-utterance"
EVIDENCE="$ROOT/.evidence/audio/whole-utterance-pilot-v4-20260821"
PRACTICES=(G02 G30 G41)
PRACTICE_ARGS=()
for practice in $PRACTICES; do
  PRACTICE_ARGS+=(--practice "$practice")
done

cd "$ROOT"
/usr/bin/python3 "$ROOT/scripts/run_narration_guarded.py" \
  --backend "$BACKEND" \
  --language en \
  --language de \
  $PRACTICE_ARGS \
  --device "$DEVICE" \
  --start-headroom-gib "${NARRATION_START_HEADROOM_GIB:-16.5}" \
  --wait-seconds "${NARRATION_WAIT_SECONDS:-43200}" \
  --checkpoint-retries 20 \
  --checkpoint-continuations 600 \
  --one-new-unit-per-child \
  --new-units-per-child "${NARRATION_NEW_UNITS_PER_CHILD:-16}" \
  --seed-offset "${NARRATION_SEED_OFFSET:-0}" \
  --mps-residency-strategy "${NARRATION_MPS_RESIDENCY_STRATEGY:-phase-batched}" \
  --resume \
  --report "$ROOT/.evidence/audio/narration-memory-guard-whole-utterance-pilot.json"

uv run --cache-dir "$UV_CACHE_DIR" --offline --frozen --project "$PROJECT" --no-sync \
  python "$ROOT/scripts/validate_narration_candidates.py" \
  $PRACTICE_ARGS

candidate_root="$ROOT/ContentProduction/production-candidates/$VERSION"
mkdir -p "$EVIDENCE"
for practice in $PRACTICES; do
  for language in en de; do
    candidate="$candidate_root/$practice/$language"
    manifest="$candidate/manifest.json"
    [[ -f "$manifest" ]] || {
      print -u2 "missing pilot manifest: $manifest"
      exit 66
    }
    rg -q '"syntheticIntraSentenceSilence": false' "$manifest" || {
      print -u2 "pilot manifest does not prove the no-synthetic-silence contract: $manifest"
      exit 65
    }
    rg -q '"unitIndex": 0' "$manifest" || {
      print -u2 "pilot manifest has no whole-utterance generation segment: $manifest"
      exit 65
    }
    cp -p "$candidate/delivery.m4a" "$EVIDENCE/$practice.$language.m4a"
    cp -p "$candidate/transcript.vtt" "$EVIDENCE/$practice.$language.vtt"
  done
done

print "Whole-utterance pilot complete: six full listening files are under $EVIDENCE"

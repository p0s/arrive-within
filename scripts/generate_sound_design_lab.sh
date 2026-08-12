#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
project_root="${script_directory:h}"
output_directory="${project_root}/Marketing/SoundDesignLab/output"

if [[ ! -f "${project_root}/project.yml" || "$output_directory" != "${project_root}"/* ]]; then
  print -u2 "Refusing to generate outside the Arrive Within checkout."
  exit 64
fi
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null || ! command -v jq >/dev/null; then
  print -u2 "ffmpeg, ffprobe, and jq are required."
  exit 69
fi

/bin/mkdir -p "$output_directory"

generate_ambience() {
  local name="$1"
  local expression="$2"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "aevalsrc=${expression}:sample_rate=48000:duration=30" \
    -af "highpass=f=32,lowpass=f=1800,volume=11dB,alimiter=limit=0.50" \
    -ar 48000 -ac 1 -c:a aac -b:a 64k -movflags +faststart \
    "${output_directory}/${name}.m4a"
}

generate_bell() {
  local name="$1"
  local fundamental="$2"
  local duration="$3"
  local second="$(printf '%.3f' "$(( fundamental * 3 / 2 ))")"
  local third="$(printf '%.3f' "$(( fundamental * 2 ))")"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=${fundamental}:sample_rate=48000:duration=${duration}" \
    -f lavfi -i "sine=frequency=${second}:sample_rate=48000:duration=${duration}" \
    -f lavfi -i "sine=frequency=${third}:sample_rate=48000:duration=${duration}" \
    -filter_complex \
    "[0:a]volume=0.15,afade=t=out:st=0.08:d=$(printf '%.2f' "$(( duration - 1 ))"):curve=exp[a0];[1:a]volume=0.065,afade=t=out:st=0.04:d=$(printf '%.2f' "$(( duration - 1 ))"):curve=exp[a1];[2:a]volume=0.028,afade=t=out:st=0.02:d=$(printf '%.2f' "$(( duration - 1 ))"):curve=exp[a2];[a0][a1][a2]amix=inputs=3:normalize=0,aecho=0.72:0.24:110|230:0.16|0.07,volume=35dB,alimiter=limit=0.70" \
    -ar 48000 -ac 1 -c:a pcm_s16le \
    "${output_directory}/${name}.wav"
}

generate_ambience "ambience-a-still-air" "0.010*sin(2*PI*55*t)*(0.74+0.26*cos(2*PI*t/30))+0.004*sin(2*PI*82.5*t)*(0.82+0.18*cos(4*PI*t/30))+0.0018*sin(2*PI*220*t)"
generate_ambience "ambience-b-forest-breath" "0.008*sin(2*PI*73.333333*t)*(0.70+0.30*cos(2*PI*t/30))+0.0042*sin(2*PI*110*t)*(0.78+0.22*cos(6*PI*t/30))+0.0014*sin(2*PI*293.333333*t)*(0.86+0.14*cos(8*PI*t/30))"
generate_ambience "ambience-c-water-light" "0.0075*sin(2*PI*48*t)*(0.72+0.28*cos(4*PI*t/30))+0.0038*sin(2*PI*96*t)*(0.80+0.20*cos(2*PI*t/30))+0.0016*sin(2*PI*384*t)*(0.84+0.16*cos(10*PI*t/30))"

generate_bell "bell-a-clear-opening" 523 4
generate_bell "bell-a-clear-closing" 392 5
generate_bell "bell-b-warm-opening" 440 4
generate_bell "bell-b-warm-closing" 330 5
generate_bell "bell-c-airy-opening" 659 4
generate_bell "bell-c-airy-closing" 494 5

assets='[]'
for asset_path in "${output_directory}"/*.m4a "${output_directory}"/*.wav; do
  name="${asset_path:t}"
  sha="$(/usr/bin/shasum -a 256 "$asset_path" | /usr/bin/awk '{print $1}')"
  duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$asset_path")"
  bytes="$(/usr/bin/stat -f '%z' "$asset_path")"
  probe="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of json "$asset_path")"
  loudness_output="$(ffmpeg -hide_banner -nostats -i "$asset_path" -af "loudnorm=I=-19:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1)"
  loudness="$(print -r -- "$loudness_output" | /usr/bin/sed -n '/^{/,/^}/p')"
  if ! jq -e '.input_i and .input_tp' >/dev/null <<< "$loudness"; then
    print -u2 "Could not measure loudness for ${name}."
    exit 70
  fi
  codec="$(jq -r '.streams[0].codec_name' <<< "$probe")"
  sample_rate="$(jq -r '.streams[0].sample_rate' <<< "$probe")"
  channels="$(jq -r '.streams[0].channels' <<< "$probe")"
  integrated_lufs="$(jq -r '.input_i' <<< "$loudness")"
  true_peak_dbtp="$(jq -r '.input_tp' <<< "$loudness")"
  role="bell-candidate"
  [[ "$name" == ambience-* ]] && role="ambience-candidate"
  assets="$(jq -c \
    --arg path "output/${name}" \
    --arg sha256 "$sha" \
    --arg role "$role" \
    --arg codec "$codec" \
    --argjson sample_rate "$sample_rate" \
    --argjson channels "$channels" \
    --arg integrated_lufs "$integrated_lufs" \
    --arg true_peak_dbtp "$true_peak_dbtp" \
    --argjson duration_seconds "$duration" \
    --argjson bytes "$bytes" \
    '. + [{path:$path, sha256:$sha256, role:$role, codec:$codec, sample_rate:$sample_rate, channels:$channels, duration_seconds:$duration_seconds, integrated_lufs:($integrated_lufs|tonumber), true_peak_dbtp:($true_peak_dbtp|tonumber), bytes:$bytes}]' \
    <<< "$assets")"
done

jq -n --sort-keys \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg ffmpeg "$(ffmpeg -version | /usr/bin/head -1)" \
  --arg generator_path "scripts/generate_sound_design_lab.sh" \
  --arg generator_sha256 "$(/usr/bin/shasum -a 256 "$0" | /usr/bin/awk '{print $1}')" \
  --argjson assets "$assets" \
  '{
    schema_version: 1,
    status: "objective-candidates-human-selection-pending",
    generated_at: $generated_at,
    generator: $ffmpeg,
    generator_path: $generator_path,
    generator_sha256: $generator_sha256,
    method: "Deterministic additive synthesis only; complete candidates are encoded after synthesis.",
    rights: "Original deterministic synthesis generated by this repository; no samples, recordings, cloned voices, reference voices, or third-party media.",
    ambience_loop_seconds: 30,
    ambience_target_role: "Optional low-level layer below narration with independent user volume; objective audition target near -32 LUFS-I.",
    assets: $assets,
    automated_checks: ["decode", "mono", "sample rate", "duration", "hash", "integrated loudness", "true peak", "bounded peak from synthesis limiter"],
    pending_human_checks: ["loop seam", "fatigue", "speaker and route balance", "bell harshness", "narration intelligibility", "owner selection"],
    release_boundary: "No candidate is selected or bundled by this lab. Only an explicitly selected and separately mastered asset may replace a shipping layer."
  }' > "${output_directory}/manifest.json"

print "Generated three ambience and three bell-family candidates in ${output_directory}."

#!/usr/bin/env python3
"""Validate private narration auditions and emit a public-safe results ledger.

The raw WAV files and detailed generation manifest stay under the ignored
ContentProduction/auditions directory. The derived ledger contains hashes and
objective measurements only; it is not voice approval or production mastering.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import statistics
import struct
import subprocess
import wave
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = (
    PROJECT_ROOT
    / "ContentProduction"
    / "auditions"
    / "chatterbox-default-v1"
    / "manifest.json"
)
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "audio" / "audition-results.json"
EXPECTED_CELLS = {
    (practice_id, language)
    for practice_id in ("G01", "G10", "G17", "G24", "G30", "G41")
    for language in ("en", "de")
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def dbfs(value: float) -> float | None:
    if value <= 0:
        return None
    return round(20.0 * math.log10(value), 3)


def read_pcm_measurements(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        sample_rate = source.getframerate()
        frames = source.getnframes()
        compression = source.getcomptype()
        payload = source.readframes(frames)

    if channels != 1 or sample_width != 2 or compression != "NONE":
        raise ValueError(f"{path.name} is not 16-bit mono PCM WAV")
    samples = struct.unpack(f"<{frames}h", payload)
    if not samples:
        raise ValueError(f"{path.name} has no samples")

    normalized = [sample / 32768.0 for sample in samples]
    absolute = [abs(sample) for sample in samples]
    peak = max(absolute) / 32768.0
    rms = math.sqrt(statistics.fmean(sample * sample for sample in normalized))
    threshold = round(32768.0 * (10.0 ** (-50.0 / 20.0)))
    voiced = [index for index, sample in enumerate(absolute) if sample > threshold]
    leading_silence = (voiced[0] / sample_rate) if voiced else (frames / sample_rate)
    trailing_silence = (
        ((frames - 1 - voiced[-1]) / sample_rate) if voiced else (frames / sample_rate)
    )

    longest_silent_run = 0
    current_silent_run = 0
    for sample in absolute:
        if sample <= threshold:
            current_silent_run += 1
            longest_silent_run = max(longest_silent_run, current_silent_run)
        else:
            current_silent_run = 0

    return {
        "sampleRate": sample_rate,
        "channels": channels,
        "bitsPerSample": sample_width * 8,
        "frames": frames,
        "durationSeconds": round(frames / sample_rate, 6),
        "samplePeakDBFS": dbfs(peak),
        "rmsDBFS": dbfs(rms),
        "dcOffset": round(statistics.fmean(normalized), 8),
        "fullScaleSamples": sum(sample >= 32767 for sample in absolute),
        "leadingSilenceSecondsAtMinus50DB": round(leading_silence, 4),
        "trailingSilenceSecondsAtMinus50DB": round(trailing_silence, 4),
        "longestSilenceSecondsAtMinus50DB": round(longest_silent_run / sample_rate, 4),
    }


def loudnorm_measurements(path: Path, ffmpeg: str) -> dict[str, float]:
    process = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "loudnorm=I=-19:TP=-1.5:LRA=7:print_format=json",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg could not measure {path.name}: {process.stderr[-500:]}")
    matches = re.findall(r"\{\s*\"input_i\".*?\}", process.stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError(f"ffmpeg emitted no loudnorm measurements for {path.name}")
    measured = json.loads(matches[-1])
    return {
        "integratedLoudnessLUFS": float(measured["input_i"]),
        "truePeakDBTP": float(measured["input_tp"]),
        "loudnessRangeLU": float(measured["input_lra"]),
        "loudnessThresholdLUFS": float(measured["input_thresh"]),
    }


def resolve_private_audio(manifest_path: Path, relative_path: str) -> Path:
    root = manifest_path.parent.resolve()
    candidate = (root / relative_path).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError(f"Audition path escapes its private root: {relative_path}")
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError(f"Audition is missing or unsafe: {relative_path}")
    return candidate


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported private audition manifest schema")
    if manifest.get("model", {}).get("voiceReference") is not None:
        raise ValueError("Default audition unexpectedly contains reference voice material")
    cells = {(item["id"], item["language"]) for item in manifest["results"]}
    if cells != EXPECTED_CELLS or len(manifest["results"]) != len(EXPECTED_CELLS):
        raise ValueError("Private audition manifest is not the exact required 6x2 matrix")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for objective audition measurement")
    version = subprocess.run(
        [ffmpeg, "-version"], capture_output=True, check=True, text=True
    ).stdout.splitlines()[0]

    results: list[dict[str, Any]] = []
    any_raw_clip_attention = False
    for item in sorted(manifest["results"], key=lambda value: (value["id"], value["language"])):
        audio_path = resolve_private_audio(manifest_path, item["relativePath"])
        actual_hash = sha256(audio_path)
        if actual_hash != item["sha256"]:
            raise ValueError(f"Hash mismatch for {item['id']}.{item['language']}")
        if audio_path.stat().st_size != item["bytes"]:
            raise ValueError(f"Byte-count mismatch for {item['id']}.{item['language']}")

        pcm = read_pcm_measurements(audio_path)
        if (
            pcm["sampleRate"] != item["sampleRate"]
            or pcm["channels"] != item["channels"]
            or pcm["frames"] != item["frames"]
        ):
            raise ValueError(f"PCM metadata mismatch for {item['id']}.{item['language']}")

        generation_clips = int(item.get("clippedInputSamples") or 0)
        clip_attention = generation_clips > 0 or pcm["fullScaleSamples"] > 0
        any_raw_clip_attention = any_raw_clip_attention or clip_attention
        results.append(
            {
                "id": item["id"],
                "language": item["language"],
                "voiceLabel": item["voiceLabel"],
                "fileName": audio_path.name,
                "sourceScriptSHA256": item["sourceScriptSHA256"],
                "excerptSHA256": item["excerptSHA256"],
                "audioSHA256": actual_hash,
                "bytes": item["bytes"],
                "generationClippedInputSamples": generation_clips,
                "rawClippingAttention": clip_attention,
                **pcm,
                **loudnorm_measurements(audio_path, ffmpeg),
            }
        )

    output = {
        "schemaVersion": 1,
        "auditionVersion": manifest["auditionVersion"],
        "state": "generated-and-objectively-measured-awaiting-human-review",
        "productionApproval": False,
        "analysisOfPrivateManifestSHA256": sha256(manifest_path),
        "rawFilesAreIgnored": True,
        "source": manifest["source"],
        "model": {
            key: value
            for key, value in manifest["model"].items()
            if key != "voiceReference"
        },
        "generation": manifest["generation"],
        "modelFileSHA256": manifest["modelFileSHA256"],
        "measurement": {
            "tool": version,
            "loudnormReferenceOnly": {"integratedLUFS": -19.0, "truePeakDBTP": -1.5},
            "normalizationApplied": False,
            "rawClippingAttentionPresent": any_raw_clip_attention,
        },
        "rights": {
            "privateAudition": manifest["rightsState"],
            "publicRedistribution": manifest["releaseRightsState"],
        },
        "humanGates": {
            "ownerVoiceDirection": "pending",
            "fluentEnglishListening": "pending",
            "fluentGermanListening": "pending",
            "pronunciationPacingAndArtifactReview": "pending",
            "safetyAndEditorialReview": "pending",
            "publicRedistributionSignoff": "pending",
        },
        "results": results,
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if str(PROJECT_ROOT) in rendered:
        raise ValueError("Public ledger unexpectedly contains an absolute project path")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    print(
        f"Measured {len(results)} audition cells; "
        f"raw clipping attention={any_raw_clip_attention}; "
        f"human approval remains pending"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Measure private sentence-aware pacing auditions into a public-safe ledger."""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import subprocess
import wave
from pathlib import Path
from typing import Any

from analyze_narration_auditions import (
    loudnorm_measurements,
    read_pcm_measurements,
    resolve_private_audio,
    sha256,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = PROJECT_ROOT / "ContentProduction" / "auditions" / "chatterbox-pacing-v2" / "manifest.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "audio" / "pacing-audition-results.json"
EXPECTED_IDS = {
    "en-approved-pacing-700",
    "en-approved-pacing-850",
    "de-a-natural-calm",
    "de-b-deep-calm",
    "de-c-conversational-slow",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def segment_hashes(path: Path, item: dict[str, Any]) -> list[str]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError(f"Unsupported PCM format: {path.name}")
        frames = source.getnframes()
        payload = source.readframes(frames)
        sample_rate = source.getframerate()
    samples = struct.unpack(f"<{frames}h", payload)
    offset = 0
    hashes: list[str] = []
    segments = item["segments"]
    for index, segment in enumerate(segments):
        count = int(segment["frames"])
        raw = struct.pack(f"<{count}h", *samples[offset : offset + count])
        import hashlib

        hashes.append(hashlib.sha256(raw).hexdigest())
        offset += count
        if index < len(segments) - 1:
            same_excerpt = segment["excerptID"] == segments[index + 1]["excerptID"]
            gap_ms = item["sentenceGapMs"] if same_excerpt else item["practiceTransitionGapMs"]
            offset += round(sample_rate * gap_ms / 1000)
    if offset != frames:
        raise ValueError(f"Assembly boundaries do not cover {path.name}: {offset} != {frames}")
    return hashes


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported private pacing manifest schema")
    if manifest.get("model", {}).get("voiceReference") is not None:
        raise ValueError("Pacing audition unexpectedly contains reference material")
    if {item["id"] for item in manifest["results"]} != EXPECTED_IDS:
        raise ValueError("Private manifest does not contain the exact required five variants")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for objective pacing-audition measurement")
    ffmpeg_version = subprocess.run(
        [ffmpeg, "-version"], capture_output=True, check=True, text=True
    ).stdout.splitlines()[0]

    results: list[dict[str, Any]] = []
    rendered_segments: dict[str, list[str]] = {}
    any_sample_clipping = False
    any_intersample_peak = False
    for item in sorted(manifest["results"], key=lambda value: value["id"]):
        path = resolve_private_audio(manifest_path, item["relativePath"])
        if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise ValueError(f"Private file integrity mismatch: {item['id']}")
        pcm = read_pcm_measurements(path)
        if pcm["frames"] != item["frames"] or pcm["sampleRate"] != item["sampleRate"]:
            raise ValueError(f"PCM metadata mismatch: {item['id']}")
        generation_clips = int(item.get("clippedInputSamples") or 0)
        sample_clip_attention = generation_clips > 0 or pcm["fullScaleSamples"] > 0
        loudness = loudnorm_measurements(path, ffmpeg)
        intersample_peak_attention = loudness["truePeakDBTP"] > 0
        any_sample_clipping = any_sample_clipping or sample_clip_attention
        any_intersample_peak = any_intersample_peak or intersample_peak_attention
        rendered_segments[item["id"]] = segment_hashes(path, item)
        results.append(
            {
                "id": item["id"],
                "label": item["label"],
                "language": item["language"],
                "voiceLabel": item["voiceLabel"],
                "deliveryClaim": item["deliveryClaim"],
                "excerptIDs": item["excerptIDs"],
                "sourceScriptSHA256": item["sourceScriptSHA256"],
                "promptSHA256": item["promptSHA256"],
                "audioSHA256": item["sha256"],
                "bytes": item["bytes"],
                "wordCount": item["wordCount"],
                "overallWordsPerMinute": item["overallWordsPerMinute"],
                "sentenceGapMs": item["sentenceGapMs"],
                "practiceTransitionGapMs": item["practiceTransitionGapMs"],
                "seed": item["seed"],
                "exaggeration": item["exaggeration"],
                "cfgWeight": item["cfgWeight"],
                "temperature": item["temperature"],
                "assembly": item["assembly"],
                "generationClippedInputSamples": generation_clips,
                "sampleClippingAttention": sample_clip_attention,
                "intersamplePeakAboveZeroAttention": intersample_peak_attention,
                **pcm,
                **loudness,
            }
        )

    english_shared = (
        rendered_segments["en-approved-pacing-700"]
        == rendered_segments["en-approved-pacing-850"]
    )
    if not english_shared:
        raise ValueError("English pacing clips do not share identical sentence renders")

    output = {
        "schemaVersion": 1,
        "auditionVersion": manifest["auditionVersion"],
        "state": "generated-and-objectively-measured-awaiting-owner-pacing-and-german-selection",
        "productionApproval": False,
        "analysisOfPrivateManifestSHA256": sha256(manifest_path),
        "rawFilesAreIgnored": True,
        "ownerDirection": manifest["ownerDirection"],
        "source": manifest["source"],
        "model": {key: value for key, value in manifest["model"].items() if key != "voiceReference"},
        "generation": manifest["generation"],
        "generationEnvironment": {
            "python": manifest["environment"]["python"],
            "platform": manifest["environment"]["platform"],
            "torch": manifest["environment"]["torch"],
            "chatterboxTTS": manifest["environment"]["chatterboxTTS"],
            "device": manifest["environment"]["device"],
        },
        "modelFileSHA256": manifest["modelFileSHA256"],
        "measurement": {
            "tool": ffmpeg_version,
            "normalizationApplied": False,
            "timeStretchApplied": False,
            "englishSentenceRendersIdenticalAcrossSpacingComparisons": english_shared,
            "sampleClippingAttentionPresent": any_sample_clipping,
            "intersamplePeakAboveZeroAttentionPresent": any_intersample_peak,
            "masteringReferenceOnly": {"integratedLUFS": -19.0, "truePeakDBTP": -1.5},
        },
        "rights": {
            "privateAudition": manifest["rightsState"],
            "publicRedistribution": manifest["releaseRightsState"],
        },
        "humanGates": {
            "englishVoiceIdentity": "owner-approved-with-pacing-revision",
            "englishPacing": "pending-owner-confirmation",
            "germanPreviousDefaultDelivery": "owner-rejected-excessive-speed",
            "germanAlternativeSelection": "pending-owner-selection",
            "fluentEnglishListening": "pending-complete-track-review",
            "fluentGermanListening": "pending",
            "pronunciationPacingAndArtifactReview": "pending",
            "safetyAndEditorialReview": "pending",
            "publicRedistributionSignoff": "pending",
        },
        "results": results,
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if str(PROJECT_ROOT) in rendered:
        raise ValueError("Public pacing ledger unexpectedly contains an absolute project path")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    print(
        f"Measured {len(results)} pacing variants; sample clipping attention={any_sample_clipping}; "
        f"intersample peak attention={any_intersample_peak}; "
        "English sentence renders shared; human selection remains pending"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

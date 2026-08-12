#!/usr/bin/env python3
"""Measure the private cadence/accent revision into a public-safe ledger."""

from __future__ import annotations

import argparse
import hashlib
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
DEFAULT_INPUT = (
    PROJECT_ROOT / "ContentProduction" / "auditions" / "chatterbox-cadence-accent-v3"
)
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "audio" / "cadence-accent-audition-results.json"
ENGLISH_IDS = {"en-e1-slower-fluid-1100", "en-e2-slower-fluid-1350"}
GERMAN_IDS = {
    "de-c1-accent-stability",
    "de-c2-accent-stability",
    "de-c3-accent-stability",
}
EXPECTED_IDS = ENGLISH_IDS | GERMAN_IDS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
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
        hashes.append(hashlib.sha256(raw).hexdigest())
        offset += count
        if index < len(segments) - 1:
            same_excerpt = segment["excerptID"] == segments[index + 1]["excerptID"]
            gap_ms = (
                item["sentenceGapMs"]
                if same_excerpt
                else item["practiceTransitionGapMs"]
            )
            offset += round(sample_rate * gap_ms / 1000)
    if offset != frames:
        raise ValueError(f"Assembly boundaries do not cover {path.name}: {offset} != {frames}")
    return hashes


def main() -> int:
    args = parse_args()
    input_root = args.input.resolve()
    output_path = args.output.resolve()
    manifest_paths = sorted(input_root.glob("manifest.*.json"))
    expected_manifest_names = {"manifest.english.json"} | {
        f"manifest.{identifier}.json" for identifier in GERMAN_IDS
    }
    if {path.name for path in manifest_paths} != expected_manifest_names:
        raise ValueError("Private input must contain one English and three isolated German manifests")

    manifests = [json.loads(path.read_text(encoding="utf-8")) for path in manifest_paths]
    if any(manifest.get("schemaVersion") != 1 for manifest in manifests):
        raise ValueError("Unsupported private cadence/accent manifest schema")
    if any(manifest.get("model", {}).get("voiceReference") is not None for manifest in manifests):
        raise ValueError("Cadence/accent revision unexpectedly contains reference material")
    if len({manifest["auditionVersion"] for manifest in manifests}) != 1:
        raise ValueError("Private process manifests disagree on audition version")

    results_by_id: dict[str, tuple[Path, dict[str, Any], dict[str, Any]]] = {}
    process_boundaries: list[dict[str, Any]] = []
    for path, manifest in zip(manifest_paths, manifests, strict=True):
        boundary = manifest["processBoundary"]
        selected = set(boundary["selectedVariantIDs"])
        if path.name == "manifest.english.json":
            if (
                boundary["scope"] != "english-only"
                or selected != ENGLISH_IDS
                or boundary["generationInputLanguage"] != "en"
                or boundary["otherLanguageGenerationCalls"] != 0
            ):
                raise ValueError("English process boundary is not isolated as declared")
        else:
            expected_id = path.name.removeprefix("manifest.").removesuffix(".json")
            if (
                boundary["scope"] != "german-only"
                or selected != {expected_id}
                or boundary["generationInputLanguage"] != "de"
                or boundary["otherLanguageGenerationCalls"] != 0
                or boundary["languageIDExplicitOnEveryGermanCall"] is not True
                or boundary["modelLoadedFreshForThisProcess"] is not True
            ):
                raise ValueError(f"German process boundary is not isolated: {expected_id}")
        process_boundaries.append(
            {
                "manifestSHA256": sha256(path),
                "scope": boundary["scope"],
                "selectedVariantIDs": boundary["selectedVariantIDs"],
                "modelLoadedFreshForThisProcess": boundary["modelLoadedFreshForThisProcess"],
                "generationInputLanguage": boundary["generationInputLanguage"],
                "otherLanguageGenerationCalls": boundary["otherLanguageGenerationCalls"],
                "languageIDExplicitOnEveryGermanCall": boundary[
                    "languageIDExplicitOnEveryGermanCall"
                ],
                "generationCallCount": boundary["generationCallCount"],
            }
        )
        for item in manifest["results"]:
            identifier = item["id"]
            if identifier in results_by_id:
                raise ValueError(f"Duplicate private result: {identifier}")
            results_by_id[identifier] = (path, manifest, item)
    if set(results_by_id) != EXPECTED_IDS:
        raise ValueError("Private process manifests do not contain the exact five revisions")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for objective cadence/accent measurement")
    ffmpeg_version = subprocess.run(
        [ffmpeg, "-version"], capture_output=True, check=True, text=True
    ).stdout.splitlines()[0]

    results: list[dict[str, Any]] = []
    rendered_segments: dict[str, list[str]] = {}
    any_sample_clipping = False
    any_intersample_peak = False
    duration_boundary_attention: list[dict[str, Any]] = []
    for identifier in sorted(results_by_id):
        manifest_path, manifest, item = results_by_id[identifier]
        path = resolve_private_audio(manifest_path, item["relativePath"])
        if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise ValueError(f"Private file integrity mismatch: {identifier}")
        pcm = read_pcm_measurements(path)
        if pcm["frames"] != item["frames"] or pcm["sampleRate"] != item["sampleRate"]:
            raise ValueError(f"PCM metadata mismatch: {identifier}")
        segment_frame_total = sum(int(segment["frames"]) for segment in item["segments"])
        expected_speech_seconds = segment_frame_total / item["sampleRate"]
        if abs(expected_speech_seconds - item["speechDurationSeconds"]) > 0.000001:
            raise ValueError(f"Speech-only duration mismatch: {identifier}")
        if identifier in GERMAN_IDS and any(
            segment.get("languageID") != "de" for segment in item["segments"]
        ):
            raise ValueError(f"German sentence call omitted explicit language ID: {identifier}")
        generation_clips = int(item.get("clippedInputSamples") or 0)
        sample_clip_attention = generation_clips > 0 or pcm["fullScaleSamples"] > 0
        loudness = loudnorm_measurements(path, ffmpeg)
        intersample_peak_attention = loudness["truePeakDBTP"] > 0
        any_sample_clipping = any_sample_clipping or sample_clip_attention
        any_intersample_peak = any_intersample_peak or intersample_peak_attention
        rendered_segments[identifier] = segment_hashes(path, item)

        public_segments: list[dict[str, Any]] = []
        for segment in item["segments"]:
            rate = float(segment["sentenceUnitWordsPerMinute"])
            attention = rate < 50 or rate > 300 or segment["durationSeconds"] < 0.35
            if attention:
                duration_boundary_attention.append(
                    {
                        "id": identifier,
                        "excerptID": segment["excerptID"],
                        "sentenceIndex": segment["sentenceIndex"],
                        "reason": "generated sentence duration is outside the broad automated bound",
                    }
                )
            public_segments.append(
                {
                    "excerptID": segment["excerptID"],
                    "sentenceIndex": segment["sentenceIndex"],
                    "seed": segment["seed"],
                    "textSHA256": segment["textSHA256"],
                    "wordCount": segment["wordCount"],
                    "frames": segment["frames"],
                    "durationSeconds": segment["durationSeconds"],
                    "sentenceUnitWordsPerMinute": segment["sentenceUnitWordsPerMinute"],
                    "languageID": segment["languageID"],
                    "newModelGenerationCall": segment["newModelGenerationCall"],
                    "durationBoundaryAttention": attention,
                }
            )
        results.append(
            {
                "id": identifier,
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
                "speechDurationSeconds": item["speechDurationSeconds"],
                "explicitInsertedSilenceSeconds": item["explicitInsertedSilenceSeconds"],
                "speechOnlyWordsPerMinute": item["speechOnlyWordsPerMinute"],
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
                "segments": public_segments,
                **pcm,
                **loudness,
            }
        )

    english_shared = (
        rendered_segments["en-e1-slower-fluid-1100"]
        == rendered_segments["en-e2-slower-fluid-1350"]
    )
    if not english_shared:
        raise ValueError("English E1/E2 do not share the intended regenerated sentence units")

    first_manifest = manifests[0]
    model_hash_sets = [manifest["modelFileSHA256"] for manifest in manifests]
    if any(value != model_hash_sets[0] for value in model_hash_sets[1:]):
        raise ValueError("Isolated processes did not use identical pinned model files")
    output = {
        "schemaVersion": 1,
        "auditionVersion": first_manifest["auditionVersion"],
        "state": "generated-and-objectively-measured-awaiting-owner-English-pacing-and-German-accent-review",
        "productionApproval": False,
        "rawFilesAreIgnored": True,
        "ownerDirection": first_manifest["ownerDirection"],
        "source": first_manifest["source"],
        "model": {
            key: value
            for key, value in first_manifest["model"].items()
            if key != "voiceReference"
        },
        "generation": first_manifest["generation"],
        "modelFileSHA256": model_hash_sets[0],
        "processBoundaries": process_boundaries,
        "measurement": {
            "tool": ffmpeg_version,
            "normalizationApplied": False,
            "timeStretchApplied": False,
            "speechOnlyDefinition": "generated sentence-unit duration excluding only the explicitly inserted assembly gaps; model-internal pauses remain included",
            "englishSentenceRendersIdenticalAcrossE1E2": english_shared,
            "sampleClippingAttentionPresent": any_sample_clipping,
            "intersamplePeakAboveZeroAttentionPresent": any_intersample_peak,
            "automatedHallucinationCheckScope": "broad per-sentence duration/truncation bounds only; no transcript or native-accent claim",
            "durationBoundaryAttention": duration_boundary_attention,
            "masteringReferenceOnly": {"integratedLUFS": -19.0, "truePeakDBTP": -1.5},
        },
        "rights": {
            "privateAudition": first_manifest["rightsState"],
            "publicRedistribution": first_manifest["releaseRightsState"],
        },
        "humanGates": {
            "englishVoiceIdentity": "owner-approved",
            "englishSpacing": "850ms-preferred-over-700ms-but-still-too-fast",
            "englishPacing": "pending-owner-review-of-corrected-slower-E1-E2",
            "germanCPacingDirection": "owner-preferred-but-not-approved",
            "germanPreviousCAccent": "owner-rejected-English-accent-drift",
            "germanAccentStability": "pending-owner-and-fluent-German-review; automation-does-not-prove-native-accent",
            "fluentEnglishListening": "pending-complete-track-review",
            "fluentGermanListening": "pending",
            "safetyAndEditorialReview": "pending",
            "publicRedistributionSignoff": "pending",
        },
        "results": results,
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if str(PROJECT_ROOT) in rendered:
        raise ValueError("Public cadence/accent ledger unexpectedly contains an absolute project path")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    print(
        f"Measured {len(results)} corrected variants; sample clipping attention="
        f"{any_sample_clipping}; intersample attention={any_intersample_peak}; "
        f"duration-boundary attention={len(duration_boundary_attention)}; human accent/pacing review pending"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate private English F auditions and emit public-safe measurements."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from analyze_narration_auditions import (
    loudnorm_measurements,
    read_pcm_measurements,
    resolve_private_audio,
    sha256,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = PROJECT_ROOT / "ContentProduction" / "auditions" / "chatterbox-english-f-v4" / "manifest.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "audio" / "english-f-audition-results.json"
EXPECTED = {
    "en-f1-calm-slow": {"range": [125, 135], "list": 450, "sentence": 1400, "transition": 2000},
    "en-f2-spacious-slow": {"range": [105, 120], "list": 650, "sentence": 1700, "transition": 2400},
}


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
    if manifest.get("schemaVersion") != 1 or manifest.get("auditionVersion") != "chatterbox-english-f-v4":
        raise ValueError("Unsupported private English F manifest")
    if manifest.get("model", {}).get("voiceReference") is not None:
        raise ValueError("English F manifest unexpectedly uses reference audio")
    results = manifest.get("results", [])
    if len(results) != 2 or {item["id"] for item in results} != set(EXPECTED):
        raise ValueError("Private manifest must contain exactly F1 and F2")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for objective English F measurement")
    ffmpeg_version = subprocess.run([ffmpeg, "-version"], capture_output=True, check=True, text=True).stdout.splitlines()[0]

    public_results: list[dict[str, Any]] = []
    target_failures: list[str] = []
    for item in sorted(results, key=lambda value: value["id"]):
        expected = EXPECTED[item["id"]]
        audio_path = resolve_private_audio(manifest_path, item["relativePath"])
        if sha256(audio_path) != item["sha256"] or audio_path.stat().st_size != item["bytes"]:
            raise ValueError(f"Private audio integrity mismatch: {item['id']}")
        pcm = read_pcm_measurements(audio_path)
        if pcm["frames"] != item["frames"] or pcm["sampleRate"] != item["sampleRate"]:
            raise ValueError(f"PCM metadata mismatch: {item['id']}")
        if (
            item["speechOnlyWPMRange"] != expected["range"]
            or item["listPauseMs"] != expected["list"]
            or item["sentenceGapMs"] != expected["sentence"]
            or item["practiceTransitionGapMs"] != expected["transition"]
        ):
            raise ValueError(f"Owner target mismatch: {item['id']}")
        wpm = float(item["speechOnlyWordsPerMinute"])
        target_met = expected["range"][0] <= wpm <= expected["range"][1]
        if not target_met:
            target_failures.append(f"{item['id']} speech-only WPM {wpm} outside {expected['range']}")
        pauses = item["semanticPauses"]
        by_after = {record["after"]: record for record in pauses}
        for required in ("sadness", "numbness"):
            if required not in by_after:
                raise ValueError(f"{item['id']} is missing measured pause after {required}")
            realized = float(by_after[required]["realizedPauseMs"])
            if realized < expected["list"]:
                target_failures.append(f"{item['id']} pause after {required} is {realized} ms")
        generation_clips = int(item.get("clippedInputSamples") or 0)
        public_results.append(
            {
                "id": item["id"],
                "label": item["label"],
                "language": "en",
                "voiceLabel": item["voiceLabel"],
                "deliveryClaim": item["deliveryClaim"],
                "excerptIDs": item["excerptIDs"],
                "sourceScriptSHA256": item["sourceScriptSHA256"],
                "promptSHA256": item["promptSHA256"],
                "audioSHA256": item["sha256"],
                "bytes": item["bytes"],
                "wordCount": item["wordCount"],
                "speechDurationSeconds": item["speechDurationSeconds"],
                "explicitSentenceAndTransitionSilenceSeconds": item["explicitSentenceAndTransitionSilenceSeconds"],
                "speechOnlyWordsPerMinute": item["speechOnlyWordsPerMinute"],
                "overallWordsPerMinute": item["overallWordsPerMinute"],
                "speechOnlyWPMRange": item["speechOnlyWPMRange"],
                "speechOnlyTargetMet": target_met,
                "listPauseMs": item["listPauseMs"],
                "clausePauseMs": item["clausePauseMs"],
                "sentenceGapMs": item["sentenceGapMs"],
                "practiceTransitionGapMs": item["practiceTransitionGapMs"],
                "realizedPauseAfterSadnessMs": by_after["sadness"]["realizedPauseMs"],
                "realizedPauseAfterNumbnessMs": by_after["numbness"]["realizedPauseMs"],
                "semanticPauses": pauses,
                "seed": item["seed"],
                "exaggeration": item["exaggeration"],
                "cfgWeight": item["cfgWeight"],
                "temperature": item["temperature"],
                "assembly": item["assembly"],
                "generationClippedInputSamples": generation_clips,
                "sampleClippingAttention": generation_clips > 0 or pcm["fullScaleSamples"] > 0,
                **pcm,
                **loudnorm_measurements(audio_path, ffmpeg),
            }
        )

    output = {
        "schemaVersion": 1,
        "auditionVersion": manifest["auditionVersion"],
        "state": "generated-and-objectively-measured-awaiting-owner-F1-F2-pacing-selection",
        "productionApproval": False,
        "bulkEnglishGenerationAuthorized": False,
        "rawFilesAreIgnored": True,
        "analysisOfPrivateManifestSHA256": sha256(manifest_path),
        "ownerDirection": manifest["ownerDirection"],
        "source": manifest["source"],
        "model": {key: value for key, value in manifest["model"].items() if key != "voiceReference"},
        "generation": manifest["generation"],
        "modelFileSHA256": manifest["modelFileSHA256"],
        "processBoundary": manifest["processBoundary"],
        "measurement": {
            "tool": ffmpeg_version,
            "normalizationApplied": False,
            "timeStretchApplied": False,
            "speechOnlyDefinition": "all regenerated context-aware phrase audio plus semantic list/clause pauses; excludes only explicit full-sentence and practice-transition gaps",
            "masteringReferenceOnly": {"integratedLUFS": -19.0, "truePeakDBTP": -1.5},
        },
        "germanOwnerSelection": {
            "selectedDirection": "de-c2-accent-stability",
            "selectedAt": "2026-08-10",
            "rawAuditionIsProductionMaster": False,
            "rawClippingAndIntersamplePeakAttentionMustBeCorrectedAfterCompleteTrackAssembly": True,
        },
        "humanGates": {
            "englishVoiceIdentity": "owner-approved-default-en",
            "englishE1E2": "owner-rejected-too-fast-including-emotional-lists",
            "englishF1F2Pacing": "pending-owner-selection-or-rejection",
            "fluentEnglishListening": "pending",
            "germanC2Direction": "owner-selected",
            "fluentGermanListening": "pending",
            "scriptAndEditorialReview": "pending",
            "pronunciationAndArtifactReview": "pending",
            "masteringAndHeadroom": "pending-complete-track-assembly",
            "vttAlignment": "pending",
            "physicalDeviceAudio": "pending",
            "publicRedistributionSignoff": "pending"
        },
        "results": public_results,
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    personal_home_prefix = "/" + "Users" + "/"
    if str(PROJECT_ROOT) in rendered or personal_home_prefix in rendered:
        raise ValueError("Public English F ledger contains a private local path")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    if target_failures:
        raise ValueError("; ".join(target_failures))
    print("English F validation passed: exactly two candidates meet speech-rate and required semantic-pause targets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

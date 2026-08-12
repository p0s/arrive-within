#!/usr/bin/env python3
"""Validate private narration candidates and emit a public-safe objective ledger."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
GENERATOR_PATH = ROOT / "ContentProduction/chatterbox-audition/generate_production_candidates.py"
PLAN_PATH = ROOT / "ContentProduction/narration-production-plan.json"
CATALOG_PATH = ROOT / "Content/guided/catalog.json"
PRIVATE_ROOT = ROOT / "ContentProduction/production-candidates"
PUBLIC_REPORT = ROOT / "docs/audio/production-candidate-results.json"
EXPECTED_IDS = tuple(f"G{index:02d}" for index in range(1, 43))
LANGUAGES = ("en", "de")


class ValidationFailure(Exception):
    pass


def load_generator() -> Any:
    spec = importlib.util.spec_from_file_location("narration_production_validation", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise ValidationFailure("unable to load the narration production module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


production = load_generator()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--practice", action="append", choices=EXPECTED_IDS)
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--write-public-summary", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValidationFailure(f"missing required candidate file: {path.name}") from error
    except json.JSONDecodeError as error:
        raise ValidationFailure(f"invalid JSON in {path.name}: {error}") from error
    if not isinstance(document, dict):
        raise ValidationFailure(f"expected a JSON object in {path.name}")
    return document


def run_checked(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(arguments, check=True, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise ValidationFailure(f"required executable is unavailable: {arguments[0]}") from error
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()[-2000:]
        raise ValidationFailure(f"{arguments[0]} failed: {detail}") from error


def probe_audio(path: Path, ffprobe: str) -> dict[str, Any]:
    completed = run_checked(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_fmt,sample_rate,channels,duration,bit_rate",
            "-show_entries",
            "format=duration,bit_rate",
            "-of",
            "json",
            str(path),
        ]
    )
    document = json.loads(completed.stdout)
    streams = document.get("streams", [])
    if len(streams) != 1:
        raise ValidationFailure(f"{path.name}: expected exactly one audio stream")
    stream = streams[0]
    file_format = document.get("format", {})
    return {
        "codec": stream.get("codec_name"),
        "sampleFormat": stream.get("sample_fmt"),
        "sampleRate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "durationSeconds": float(stream.get("duration") or file_format.get("duration") or 0),
        "bitrateBPS": int(stream.get("bit_rate") or file_format.get("bit_rate") or 0),
    }


def measure_loudness(path: Path, ffmpeg: str) -> dict[str, float]:
    completed = run_checked(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "loudnorm=I=-19:TP=-2:LRA=7:print_format=json",
            "-f",
            "null",
            "-",
        ]
    )
    matches = re.findall(r'\{\s*"input_i".*?\}', completed.stderr, flags=re.DOTALL)
    if not matches:
        raise ValidationFailure(f"{path.name}: FFmpeg returned no loudness measurement")
    measured = json.loads(matches[-1])
    return {
        "integratedLUFS": float(measured["input_i"]),
        "truePeakDBTP": float(measured["input_tp"]),
        "loudnessRangeLU": float(measured["input_lra"]),
    }


def parse_vtt(path: Path) -> list[dict[str, Any]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or lines[0] != "WEBVTT":
        raise ValidationFailure(f"{path.name}: transcript must begin with WEBVTT")
    cues: list[dict[str, Any]] = []
    index = 2
    timing = re.compile(
        r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> "
        r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})$"
    )
    while index < len(lines):
        if not lines[index]:
            index += 1
            continue
        expected_index = len(cues) + 1
        if lines[index] != str(expected_index) or index + 2 >= len(lines):
            raise ValidationFailure(f"{path.name}: malformed cue {expected_index}")
        match = timing.fullmatch(lines[index + 1])
        if match is None:
            raise ValidationFailure(f"{path.name}: malformed timing for cue {expected_index}")
        values = [int(value) for value in match.groups()]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        text_lines: list[str] = []
        index += 2
        while index < len(lines) and lines[index]:
            text_lines.append(lines[index])
            index += 1
        if not text_lines or end <= start:
            raise ValidationFailure(f"{path.name}: empty or invalid cue {expected_index}")
        cues.append({"startSeconds": start, "endSeconds": end, "text": "\n".join(text_lines)})
    return cues


def require_close(actual: float, expected: float, tolerance: float, label: str) -> None:
    if not math.isfinite(actual) or abs(actual - expected) > tolerance:
        raise ValidationFailure(f"{label}: {actual} differs from recorded {expected}")


def expected_segments(
    events: list[Any],
    language: str,
    direction: dict[str, Any],
    practice_ordinal: int,
    seed_offset: int = 0,
    *,
    legacy_complete_track: bool = False,
) -> list[dict[str, Any]]:
    expected: list[dict[str, Any]] = []
    generation_ordinal = 0
    for event in events:
        if not isinstance(event, production.SentenceEvent):
            continue
        units = (
            production.legacy_complete_track_generation_units(event.text, language)
            if legacy_complete_track
            else production.generation_units(event.text, language)
        )
        for unit_index, unit in enumerate(units):
            expected.append(
                {
                    "sentenceIndex": event.sentence_index,
                    "unitIndex": unit_index,
                    "seed": production.production_seed(
                        direction,
                        practice_ordinal,
                        generation_ordinal,
                        seed_offset,
                    ),
                    "languageID": "de" if language == "de" else None,
                    "sourceTextSHA256": production.text_sha256(unit.source_text),
                    "generationTextSHA256": production.text_sha256(unit.generation_text),
                    "wordCount": len(production.words(unit.source_text)),
                }
            )
            generation_ordinal += 1
    return expected


def validate_track(
    practice: dict[str, Any],
    language: str,
    plan: dict[str, Any],
    plan_hash: str,
    catalog_hash: str,
    ffmpeg: str,
    ffprobe: str,
) -> dict[str, Any]:
    identifier = practice["id"]
    localized = practice["localized"][language]
    script_path = ROOT / localized["scriptPath"]
    track_root = PRIVATE_ROOT / plan["productionVersion"] / identifier / language
    manifest_path = track_root / "manifest.json"
    manifest = load_json(manifest_path)
    direction = plan["directions"][language]
    required_top_level = {
        "schemaVersion": 1,
        "productionVersion": plan["productionVersion"],
        "contentID": identifier,
        "language": language,
        "scriptRevision": localized["scriptRevision"],
        "editorialState": localized["editorialState"],
        "scriptSHA256": sha256(script_path),
        "catalogSHA256": catalog_hash,
        "planSHA256": plan_hash,
        "direction": direction,
        "rights": plan["rights"],
        "humanGates": plan["humanGates"],
        "productionMasterApproval": False,
        "finishedTrackApproval": False,
        "automatedState": "production-candidate-objective-checks-passed",
    }
    for key, expected in required_top_level.items():
        if manifest.get(key) != expected:
            raise ValidationFailure(f"{identifier}/{language}: manifest mismatch for {key}")

    boundary = manifest.get("processBoundary", {})
    if (
        boundary.get("languageOnly") != language
        or boundary.get("otherLanguageGenerationCalls") != 0
        or boundary.get("referenceVoiceUsed") is not False
        or boundary.get("runtimeNetworkUsed") is not False
        or boundary.get("languageIDExplicitOnEveryGermanCall") != (language == "de")
    ):
        raise ValidationFailure(f"{identifier}/{language}: invalid process-boundary evidence")
    lifecycle = boundary.get("activeInvocationLifecycle")
    if lifecycle is not None and (
        lifecycle not in {
            "one-new-unit-per-owned-process",
            "bounded-model-reuse-in-owned-process",
        }
        or boundary.get("logicalGenerationCallCount")
        != boundary.get("generationCallCount")
        or not isinstance(boundary.get("assemblyProcessGenerationCallCount"), int)
        or not isinstance(boundary.get("assemblyProcessMPSModelReloadCount"), int)
    ):
        raise ValidationFailure(
            f"{identifier}/{language}: invalid generation-lifecycle evidence"
        )
    if lifecycle == "one-new-unit-per-owned-process" and (
        boundary.get("assemblyProcessGenerationCallCount") != 0
        or boundary.get("assemblyProcessMPSModelReloadCount") != 0
        or boundary.get("configuredMaximumNewGenerationCallsPerOwnedProcess") != 1
        or boundary.get("maximumGenerationCallsPerMPSModel") != 1
    ):
        raise ValidationFailure(
            f"{identifier}/{language}: invalid one-unit process-boundary evidence"
        )

    assembly = manifest.get("assembly", {})
    if (
        assembly.get("wholeTrackBeforeMastering") is not True
        or assembly.get("timeStretch") != "none"
        or assembly.get("perChunkNormalization") != "none"
        or assembly.get("sampleRate") != 24000
        or assembly.get("channels") != 1
        or assembly.get("dropoutAttention") is not False
    ):
        raise ValidationFailure(f"{identifier}/{language}: invalid assembly evidence")

    files = manifest.get("files")
    expected_names = {
        "raw": "assembled.float.wav",
        "master": "master.wav",
        "delivery": "delivery.m4a",
        "transcript": "transcript.vtt",
    }
    if not isinstance(files, dict) or set(files) != set(expected_names):
        raise ValidationFailure(f"{identifier}/{language}: unexpected candidate file set")
    resolved_files: dict[str, Path] = {}
    for role, expected_name in expected_names.items():
        record = files[role]
        if record.get("name") != expected_name:
            raise ValidationFailure(f"{identifier}/{language}: unexpected {role} filename")
        path = track_root / expected_name
        if not path.is_file():
            raise ValidationFailure(f"{identifier}/{language}: missing {role} candidate")
        if path.stat().st_size != record.get("bytes") or sha256(path) != record.get("sha256"):
            raise ValidationFailure(f"{identifier}/{language}: {role} hash or size mismatch")
        resolved_files[role] = path

    raw_probe = probe_audio(resolved_files["raw"], ffprobe)
    master_probe = probe_audio(resolved_files["master"], ffprobe)
    delivery_probe = probe_audio(resolved_files["delivery"], ffprobe)
    if (raw_probe["codec"], raw_probe["sampleFormat"]) != ("pcm_f32le", "flt"):
        raise ValidationFailure(f"{identifier}/{language}: raw assembly must be float PCM")
    if (master_probe["codec"], master_probe["sampleFormat"]) != ("pcm_s24le", "s32"):
        raise ValidationFailure(f"{identifier}/{language}: master must be 24-bit PCM")
    if delivery_probe["codec"] != "aac":
        raise ValidationFailure(f"{identifier}/{language}: delivery must be AAC")
    for role, probe in (("raw", raw_probe), ("master", master_probe), ("delivery", delivery_probe)):
        expected_sample_rate = (
            plan["mastering"]["deliverySampleRate"] if role == "delivery" else plan["generation"]["sampleRate"]
        )
        if probe["sampleRate"] != expected_sample_rate or probe["channels"] != 1 or probe["durationSeconds"] <= 0:
            raise ValidationFailure(f"{identifier}/{language}: invalid {role} audio format")
    if not plan["mastering"]["deliveryBitrateMinimumBPS"] <= delivery_probe["bitrateBPS"] <= plan[
        "mastering"
    ]["deliveryBitrateMaximumBPS"]:
        raise ValidationFailure(f"{identifier}/{language}: AAC bitrate is outside the contract")
    require_close(master_probe["durationSeconds"], delivery_probe["durationSeconds"], 0.12, "duration")

    master_loudness = measure_loudness(resolved_files["master"], ffmpeg)
    delivery_loudness = measure_loudness(resolved_files["delivery"], ffmpeg)
    minimum = float(plan["mastering"]["integratedLUFSMinimum"])
    maximum = float(plan["mastering"]["integratedLUFSMaximum"])
    peak_maximum = float(plan["mastering"]["deliveryTruePeakMaximumDBTP"])
    for role, measured in (("master", master_loudness), ("delivery", delivery_loudness)):
        if not minimum <= measured["integratedLUFS"] <= maximum:
            raise ValidationFailure(f"{identifier}/{language}: {role} loudness outside contract")
        if measured["truePeakDBTP"] > peak_maximum:
            raise ValidationFailure(f"{identifier}/{language}: {role} true peak outside contract")
        recorded = manifest["mastering"][role]
        require_close(measured["integratedLUFS"], float(recorded["integratedLUFS"]), 0.11, f"{role} LUFS")
        require_close(measured["truePeakDBTP"], float(recorded["truePeakDBTP"]), 0.11, f"{role} peak")

    cues = parse_vtt(resolved_files["transcript"])
    recorded_cues = manifest.get("cues", [])
    if len(cues) != len(recorded_cues):
        raise ValidationFailure(f"{identifier}/{language}: VTT cue count mismatch")
    previous_end = 0.0
    for cue, recorded in zip(cues, recorded_cues, strict=True):
        require_close(cue["startSeconds"], float(recorded["startSeconds"]), 0.0006, "cue start")
        require_close(cue["endSeconds"], float(recorded["endSeconds"]), 0.0006, "cue end")
        if cue["text"] != recorded["text"] or production.text_sha256(cue["text"]) != recorded["textSHA256"]:
            raise ValidationFailure(f"{identifier}/{language}: VTT text mismatch")
        if cue["startSeconds"] < previous_end or cue["endSeconds"] > delivery_probe["durationSeconds"] + 0.001:
            raise ValidationFailure(f"{identifier}/{language}: VTT timing is outside the track")
        previous_end = cue["endSeconds"]

    _, events = production.parse_script(script_path)
    seed_offset = int(manifest.get("generationSeedOffset", 0))
    if not 0 <= seed_offset < 1000:
        raise ValidationFailure(f"{identifier}/{language}: invalid generation seed offset")
    expected_options = [expected_segments(
        events,
        language,
        direction,
        int(identifier[1:]),
        seed_offset,
    )]
    if boundary.get("activeInvocationLifecycle") is None:
        expected_options.append(
            expected_segments(
                events,
                language,
                direction,
                int(identifier[1:]),
                seed_offset,
                legacy_complete_track=True,
            )
        )
    segments = manifest.get("segments", [])
    expected = next(
        (
            option
            for option in expected_options
            if len(segments) == len(option)
            and boundary.get("generationCallCount") == len(option)
            and all(
                all(segment.get(key) == value for key, value in locked.items())
                for segment, locked in zip(segments, option, strict=True)
            )
        ),
        None,
    )
    if expected is None:
        raise ValidationFailure(f"{identifier}/{language}: generation-call coverage mismatch")
    for segment, locked in zip(segments, expected, strict=True):
        for key, value in locked.items():
            if segment.get(key) != value:
                raise ValidationFailure(f"{identifier}/{language}: segment mismatch for {key}")
        if segment.get("dropoutAttention") is not False:
            raise ValidationFailure(f"{identifier}/{language}: segment has dropout attention")

    speech_seconds = float(assembly.get("speechDurationSeconds", 0))
    duration = float(assembly.get("durationSeconds", 0))
    word_count = int(assembly.get("wordCount", 0))
    if speech_seconds <= 0 or duration <= 0 or word_count <= 0:
        raise ValidationFailure(f"{identifier}/{language}: invalid assembly totals")
    require_close(word_count / speech_seconds * 60, float(assembly["speechOnlyWordsPerMinute"]), 0.011, "speech WPM")
    require_close(word_count / duration * 60, float(assembly["overallWordsPerMinute"]), 0.011, "overall WPM")
    wpm_minimum, wpm_maximum = direction["speechOnlyWPMRange"]
    wpm_tolerance = float(plan["generation"]["aggregateSpeechWPMTolerance"])
    if not wpm_minimum - wpm_tolerance <= float(
        assembly["speechOnlyWordsPerMinute"]
    ) <= wpm_maximum + wpm_tolerance:
        raise ValidationFailure(f"{identifier}/{language}: track speech rate outside selected direction")
    target_seconds = int(practice["targetMinutes"]) * 60
    if abs(duration - target_seconds) > float(plan["generation"]["durationTargetToleranceSeconds"]):
        raise ValidationFailure(f"{identifier}/{language}: duration misses catalog target")
    if (
        assembly.get("scriptPauseAllocation") != plan["generation"]["scriptPauseAllocation"]
        or float(assembly.get("scriptPauseOriginalSeconds", 0)) <= 0
        or float(assembly.get("scriptPauseAllocatedSeconds", 0)) <= 0
    ):
        raise ValidationFailure(f"{identifier}/{language}: invalid authored-pause allocation")

    return {
        "id": identifier,
        "language": language,
        "direction": direction["id"],
        "scriptRevision": localized["scriptRevision"],
        "scriptSHA256": sha256(script_path),
        "manifestSHA256": sha256(manifest_path),
        "masterSHA256": files["master"]["sha256"],
        "deliverySHA256": files["delivery"]["sha256"],
        "transcriptSHA256": files["transcript"]["sha256"],
        "durationSeconds": round(delivery_probe["durationSeconds"], 3),
        "speechOnlyWordsPerMinute": assembly["speechOnlyWordsPerMinute"],
        "overallWordsPerMinute": assembly["overallWordsPerMinute"],
        "integratedLUFS": round(delivery_loudness["integratedLUFS"], 2),
        "truePeakDBTP": round(delivery_loudness["truePeakDBTP"], 2),
        "deliveryBitrateBPS": delivery_probe["bitrateBPS"],
        "deliveryBytes": files["delivery"]["bytes"],
        "rawClippingAttention": assembly["rawClippingAttention"],
        "dropoutAttention": False,
        "automatedState": "passed",
        "humanApproval": False,
    }


def validate_run_manifests(
    selected_ids: list[str], plan: dict[str, Any], plan_hash: str, catalog_hash: str
) -> None:
    output_root = PRIVATE_ROOT / plan["productionVersion"]
    for language in LANGUAGES:
        run = load_json(output_root / f"run.{language}.json")
        if (
            run.get("productionVersion") != plan["productionVersion"]
            or run.get("languageOnly") != language
            or run.get("otherLanguageGenerationCalls") != 0
            or run.get("ownerSelectedDirection") != plan["directions"][language]["id"]
            or run.get("planSHA256") != plan_hash
            or run.get("catalogSHA256") != catalog_hash
            or run.get("humanGates") != plan["humanGates"]
            or run.get("finishedLibraryApproval") is not False
        ):
            raise ValidationFailure(f"invalid {language}-only run manifest")
        tracks = run.get("tracks", [])
        by_id = {track.get("contentID"): track for track in tracks}
        if not set(selected_ids).issubset(by_id) or (len(selected_ids) == 42 and set(by_id) != set(EXPECTED_IDS)):
            raise ValidationFailure(f"{language}-only run manifest does not cover the requested scope")
        for identifier in selected_ids:
            manifest_path = output_root / identifier / language / "manifest.json"
            if by_id[identifier].get("manifestSHA256") != sha256(manifest_path):
                raise ValidationFailure(f"{identifier}/{language}: run-manifest hash mismatch")


def main() -> int:
    args = parse_args()
    plan = production.load_and_validate_plan(PLAN_PATH)
    catalog = production.load_and_validate_catalog(CATALOG_PATH)
    plan_hash = sha256(PLAN_PATH)
    catalog_hash = sha256(CATALOG_PATH)
    selected_ids = list(EXPECTED_IDS if args.all else args.practice or [])
    practices = {practice["id"]: practice for practice in catalog["practices"]}
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ValidationFailure("FFmpeg and FFprobe are required")

    results: list[dict[str, Any]] = []
    for identifier in selected_ids:
        for language in LANGUAGES:
            result = validate_track(
                practices[identifier], language, plan, plan_hash, catalog_hash, ffmpeg, ffprobe
            )
            results.append(result)
            print(f"validated {identifier}/{language}", flush=True)
    validate_run_manifests(selected_ids, plan, plan_hash, catalog_hash)

    total_delivery_bytes = sum(result["deliveryBytes"] for result in results)
    total_duration = sum(result["durationSeconds"] for result in results)
    if len(selected_ids) == 42 and total_delivery_bytes > plan["mastering"]["packageMaximumBytes"]:
        raise ValidationFailure("complete bilingual AAC package exceeds the 400 MiB contract")
    report = {
        "schemaVersion": 1,
        "productionVersion": plan["productionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "complete-42x2" if len(selected_ids) == 42 else "bounded-proof",
        "practiceIDs": selected_ids,
        "languages": list(LANGUAGES),
        "planSHA256": plan_hash,
        "catalogSHA256": catalog_hash,
        "source": plan["source"],
        "model": {
            "repository": plan["model"]["repository"],
            "revision": plan["model"]["revision"],
            "germanT3Model": plan["model"]["germanT3Model"],
            "referenceVoiceUsed": False,
        },
        "directions": {
            language: {
                "id": plan["directions"][language]["id"],
                "ownerState": plan["directions"][language]["ownerState"],
            }
            for language in LANGUAGES
        },
        "objectiveValidation": "passed",
        "productionMasterApproval": False,
        "finishedLibraryApproval": False,
        "humanGates": plan["humanGates"],
        "totals": {
            "tracks": len(results),
            "durationSeconds": round(total_duration, 3),
            "deliveryBytes": total_delivery_bytes,
            "packageMaximumBytes": plan["mastering"]["packageMaximumBytes"],
        },
        "tracks": results,
    }
    if args.write_public_summary:
        PUBLIC_REPORT.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print("wrote public-safe objective narration-candidate ledger")
    print(
        f"validated {len(results)} candidates: {total_duration / 60:.1f} minutes, "
        f"{total_delivery_bytes / (1024 * 1024):.1f} MiB delivery AAC"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValidationFailure, ValueError, KeyError, OSError) as error:
        print(f"narration candidate validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error

#!/usr/bin/env python3
"""Validate Arrive Within's bilingual guided-content source and release contracts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = PROJECT_ROOT / "Content/guided/catalog.json"
EXPECTED_IDS = [f"G{index:02d}" for index in range(1, 43)]
LANGUAGES = ("en", "de")
AUDITION_IDS = ("G01", "G10", "G17", "G24", "G30", "G41")
FORBIDDEN_SOURCE_MARKERS = (
    "todo",
    "tbd",
    "lorem ipsum",
    "placeholder",
    "insert text",
    "coming soon",
)


class ValidationFailure(Exception):
    pass


@dataclass(frozen=True)
class ScriptSource:
    metadata: dict[str, str]
    body: str
    spoken_word_count: int


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValidationFailure(f"missing file: {path.relative_to(PROJECT_ROOT)}") from error
    except json.JSONDecodeError as error:
        raise ValidationFailure(
            f"invalid JSON: {path.relative_to(PROJECT_ROOT)}:{error.lineno}:{error.colno}"
        ) from error


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_relative_file(value: Any, expected: str, label: str) -> Path:
    if value != expected:
        raise ValidationFailure(f"{label} must be exactly {expected!r}, found {value!r}")
    path = (PROJECT_ROOT / expected).resolve()
    if not path.is_relative_to(PROJECT_ROOT):
        raise ValidationFailure(f"{label} escapes the project root")
    return path


def validate_catalog() -> dict[str, Any]:
    document = load_json(CATALOG_PATH)
    if document.get("schemaVersion") != 1 or document.get("catalogVersion", 0) < 1:
        raise ValidationFailure("unsupported catalogue schema/catalogue version")
    practices = document.get("practices")
    if not isinstance(practices, list) or len(practices) != 42:
        raise ValidationFailure("catalogue must contain exactly 42 practices")
    identifiers = [practice.get("id") for practice in practices]
    if identifiers != EXPECTED_IDS:
        raise ValidationFailure("catalogue IDs must be ordered exactly G01 through G42")

    allowed_categories = {
        "foundations",
        "calm",
        "body",
        "focus",
        "self-kindness",
        "emotions",
        "morning",
        "evening",
        "sleep",
    }
    allowed_safety = {"seatedOrStill", "safeWalkingOnly", "bedOrResting"}
    for practice in practices:
        identifier = practice["id"]
        if practice.get("version", 0) < 1 or practice.get("targetMinutes", 0) < 1:
            raise ValidationFailure(f"{identifier}: invalid version or target duration")
        if practice.get("category") not in allowed_categories:
            raise ValidationFailure(f"{identifier}: invalid category")
        if practice.get("safetyContext") not in allowed_safety:
            raise ValidationFailure(f"{identifier}: invalid safety context")
        tags = practice.get("purposeTags")
        if not isinstance(tags, list) or not tags or any(not isinstance(tag, str) or not tag for tag in tags):
            raise ValidationFailure(f"{identifier}: purpose tags must be non-empty strings")
        localized = practice.get("localized")
        if not isinstance(localized, dict) or set(localized) != set(LANGUAGES):
            raise ValidationFailure(f"{identifier}: exact English/German parity is required")
        for language in LANGUAGES:
            entry = localized[language]
            for field in ("title", "purpose", "accessibilitySummary"):
                if not isinstance(entry.get(field), str) or not entry[field].strip():
                    raise ValidationFailure(f"{identifier}/{language}: missing {field}")
            if entry.get("scriptRevision", 0) < 1:
                raise ValidationFailure(f"{identifier}/{language}: invalid script revision")
            if entry.get("editorialState") not in {"draft", "production-candidate", "approved"}:
                raise ValidationFailure(f"{identifier}/{language}: invalid editorial state")
            base = f"Content/guided/{identifier}"
            require_relative_file(
                entry.get("scriptPath"), f"{base}/script.{language}.md", "script path"
            )
            require_relative_file(
                entry.get("transcriptPath"),
                f"{base}/transcript.{language}.vtt",
                "transcript path",
            )
            require_relative_file(
                entry.get("audioPath"), f"{base}/audio.{language}.m4a", "audio path"
            )
    return document


def parse_script(path: Path) -> ScriptSource:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ValidationFailure(f"missing script: {path.relative_to(PROJECT_ROOT)}") from error
    if not raw.startswith("---\n") or "\n---\n" not in raw[4:]:
        raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: missing simple front matter")
    header, body = raw[4:].split("\n---\n", 1)
    metadata: dict[str, str] = {}
    for line in header.splitlines():
        key, separator, value = line.partition(":")
        if not separator or not key.strip() or not value.strip():
            raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: invalid front matter line")
        metadata[key.strip()] = value.strip()
    lowered = body.casefold()
    for marker in FORBIDDEN_SOURCE_MARKERS:
        if marker in lowered:
            raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: forbidden marker {marker!r}")
    spoken = re.sub(r"\[[^\]]+\]", " ", body)
    spoken = re.sub(r"^#+\s+.*$", " ", spoken, flags=re.MULTILINE)
    words = re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)?", spoken, flags=re.UNICODE)
    return ScriptSource(metadata=metadata, body=body, spoken_word_count=len(words))


def validate_sources(
    document: dict[str, Any], selected_identifiers: set[str] | None = None
) -> dict[str, Any]:
    total_words = {"en": 0, "de": 0}
    script_hashes: dict[str, dict[str, str]] = {}
    for practice in document["practices"]:
        identifier = practice["id"]
        if selected_identifiers is not None and identifier not in selected_identifiers:
            continue
        target_minutes = practice["targetMinutes"]
        script_hashes[identifier] = {}
        for language in LANGUAGES:
            localized = practice["localized"][language]
            path = PROJECT_ROOT / localized["scriptPath"]
            source = parse_script(path)
            expected_metadata = {
                "id": identifier,
                "language": language,
                "revision": str(localized["scriptRevision"]),
                "status": localized["editorialState"],
                "target_minutes": str(target_minutes),
            }
            for key, value in expected_metadata.items():
                if source.metadata.get(key) != value:
                    raise ValidationFailure(
                        f"{path.relative_to(PROJECT_ROOT)}: {key} must be {value!r}"
                    )
            minimum_words = target_minutes * 42
            maximum_words = target_minutes * 105
            if not minimum_words <= source.spoken_word_count <= maximum_words:
                raise ValidationFailure(
                    f"{path.relative_to(PROJECT_ROOT)}: {source.spoken_word_count} spoken words "
                    f"outside {minimum_words}–{maximum_words}"
                )
            total_words[language] += source.spoken_word_count
            script_hashes[identifier][language] = sha256(path)

        if practice["safetyContext"] == "safeWalkingOnly":
            combined = " ".join(
                parse_script(PROJECT_ROOT / practice["localized"][language]["scriptPath"]).body.casefold()
                for language in LANGUAGES
            )
            if "safe" not in combined or "sicher" not in combined:
                raise ValidationFailure(f"{identifier}: walking scripts need explicit bilingual safety wording")

    return {"totalWords": total_words, "scriptSHA256": script_hashes}


def parse_vtt(path: Path) -> float:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as error:
        raise ValidationFailure(f"missing transcript: {path.relative_to(PROJECT_ROOT)}") from error
    if not lines or lines[0].strip() != "WEBVTT":
        raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: transcript must begin WEBVTT")
    cue_pattern = re.compile(
        r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$"
    )
    previous_end = 0.0
    cue_count = 0
    for line in lines:
        match = cue_pattern.match(line.strip())
        if not match:
            continue
        numbers = [int(value) for value in match.groups()]
        start = numbers[0] * 3600 + numbers[1] * 60 + numbers[2] + numbers[3] / 1000
        end = numbers[4] * 3600 + numbers[5] * 60 + numbers[6] + numbers[7] / 1000
        if start < previous_end or end <= start:
            raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: overlapping/invalid cue")
        previous_end = end
        cue_count += 1
    if cue_count == 0:
        raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: no timestamped cues")
    return previous_end


def probe_audio(path: Path) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name,sample_rate,channels,duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise ValidationFailure("ffprobe is required for release content validation") from error
    except subprocess.CalledProcessError as error:
        raise ValidationFailure(f"audio decode failed: {path.relative_to(PROJECT_ROOT)}") from error
    document = json.loads(completed.stdout)
    streams = document.get("streams", [])
    if len(streams) != 1:
        raise ValidationFailure(f"{path.relative_to(PROJECT_ROOT)}: exactly one audio stream required")
    return streams[0]


def validate_packaged(
    document: dict[str, Any],
    source_report: dict[str, Any],
    *,
    required_editorial_state: str,
    expected_review_states: dict[str, str],
) -> dict[str, Any]:
    package_bytes = 0
    asset_hashes: dict[str, dict[str, str]] = {}
    for practice in document["practices"]:
        identifier = practice["id"]
        target_seconds = practice["targetMinutes"] * 60
        asset_hashes[identifier] = {}
        for language in LANGUAGES:
            localized = practice["localized"][language]
            if localized["editorialState"] != required_editorial_state:
                raise ValidationFailure(
                    f"{identifier}/{language}: expected editorial state "
                    f"{required_editorial_state!r}"
                )
            audio_path = PROJECT_ROOT / localized["audioPath"]
            transcript_path = PROJECT_ROOT / localized["transcriptPath"]
            provenance_path = audio_path.with_name(f"provenance.{language}.json")
            audio = probe_audio(audio_path)
            if audio.get("codec_name") != "aac" or int(audio.get("channels", 0)) != 1:
                raise ValidationFailure(f"{identifier}/{language}: delivery must be mono AAC")
            duration = float(audio.get("duration", 0))
            if not target_seconds * 0.75 <= duration <= target_seconds * 1.25:
                raise ValidationFailure(f"{identifier}/{language}: duration outside target tolerance")
            transcript_end = parse_vtt(transcript_path)
            if abs(transcript_end - duration) > 2.0:
                raise ValidationFailure(f"{identifier}/{language}: VTT/audio duration mismatch")
            provenance = load_json(provenance_path)
            expected = {
                "contentID": identifier,
                "language": language,
                "scriptSHA256": source_report["scriptSHA256"][identifier][language],
                "audioSHA256": sha256(audio_path),
                "transcriptSHA256": sha256(transcript_path),
                **expected_review_states,
            }
            for key, value in expected.items():
                if provenance.get(key) != value:
                    raise ValidationFailure(f"{identifier}/{language}: provenance mismatch for {key}")
            loudness = float(provenance.get("integratedLUFS", 999))
            true_peak = float(provenance.get("truePeakDBTP", 999))
            if not -20.0 <= loudness <= -18.0 or true_peak > -1.5:
                raise ValidationFailure(f"{identifier}/{language}: mastering outside release bounds")
            package_bytes += audio_path.stat().st_size
            asset_hashes[identifier][language] = expected["audioSHA256"]
    if package_bytes > 400 * 1024 * 1024:
        raise ValidationFailure(f"narration package exceeds 400 MiB: {package_bytes} bytes")
    return {
        "narrationBytes": package_bytes,
        "audioSHA256": asset_hashes,
        "packagedEditorialState": required_editorial_state,
    }


def validate_device_candidate(
    document: dict[str, Any], source_report: dict[str, Any]
) -> dict[str, Any]:
    result = validate_packaged(
        document,
        source_report,
        required_editorial_state="production-candidate",
        expected_review_states={
            "rightsState": "approved",
            "humanListeningState": "approved",
            "scriptSafetyState": "approved",
            "transcriptAlignmentState": "approved",
            "physicalDeviceAudioState": "pending-testflight-review",
            "finishedLibraryApproval": False,
        },
    )
    result["physicalDeviceAudioPending"] = True
    return result


def validate_owner_deferred_candidate(
    document: dict[str, Any], source_report: dict[str, Any]
) -> dict[str, Any]:
    result = validate_packaged(
        document,
        source_report,
        required_editorial_state="production-candidate",
        expected_review_states={
            "rightsState": "objective-output-rights-evidence-recorded-human-signoff-deferred",
            "humanListeningState": "owner-deferred-not-passed",
            "scriptSafetyState": "owner-deferred-not-passed",
            "transcriptAlignmentState": "automated-passed-human-pending",
        },
    )
    result["ownerDeferredHumanReview"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "mode",
        choices=("catalog", "source", "owner-deferred-candidate", "device-candidate"),
    )
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument(
        "--practice",
        action="append",
        choices=EXPECTED_IDS,
        help="validate only this source practice; repeatable and forbidden in release mode",
    )
    arguments = parser.parse_args()

    if arguments.mode in {"owner-deferred-candidate", "device-candidate"} and arguments.practice:
        parser.error("--practice cannot narrow packaged validation")

    try:
        document = validate_catalog()
        report: dict[str, Any] = {
            "mode": arguments.mode,
            "catalogSHA256": sha256(CATALOG_PATH),
            "practiceCount": len(document["practices"]),
            "languageCount": 2,
            "auditionIDs": list(AUDITION_IDS),
            "status": "passed",
        }
        if arguments.mode in {"source", "owner-deferred-candidate", "device-candidate"}:
            selected = set(arguments.practice) if arguments.practice else None
            report.update(validate_sources(document, selected))
            report["validatedPracticeCount"] = (
                len(selected) if selected is not None else len(document["practices"])
            )
        if arguments.mode == "owner-deferred-candidate":
            report.update(validate_owner_deferred_candidate(document, report))
        if arguments.mode == "device-candidate":
            report.update(validate_device_candidate(document, report))
    except ValidationFailure as error:
        if arguments.json_output:
            print(json.dumps({"mode": arguments.mode, "status": "failed", "error": str(error)}))
        else:
            print(f"guided-content validation failed: {error}", file=sys.stderr)
        return 1

    if arguments.json_output:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        validated_count = report.get("validatedPracticeCount", report["practiceCount"])
        scope = (
            f"{validated_count} of {report['practiceCount']} concepts"
            if validated_count != report["practiceCount"]
            else f"{report['practiceCount']} concepts"
        )
        print(
            f"guided-content {arguments.mode} validation passed: "
            f"{scope} × {report['languageCount']} languages"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

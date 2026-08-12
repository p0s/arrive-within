#!/usr/bin/env python3
"""Promote a complete private 42x2 objective candidate set into public app resources."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from validate_narration_review_approval import ApprovalFailure, validate_approval


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "Content/guided/catalog.json"
REPORT_PATH = ROOT / "docs/audio/production-candidate-results.json"
PRIVATE_ROOT = ROOT / "ContentProduction/production-candidates"
BACKUP_ROOT = ROOT / ".evidence/release"
EXPECTED_IDS = tuple(f"G{index:02d}" for index in range(1, 43))
LANGUAGES = ("en", "de")


class PromotionFailure(Exception):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise PromotionFailure(f"invalid or missing input: {path.name}") from error
    if not isinstance(value, dict):
        raise PromotionFailure(f"expected object: {path.name}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_inputs(
    review_packet: Path,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    catalog = load_json(CATALOG_PATH)
    report = load_json(REPORT_PATH)
    if (
        report.get("scope") != "complete-42x2"
        or report.get("objectiveValidation") != "passed"
        or report.get("productionMasterApproval") is not False
        or report.get("finishedLibraryApproval") is not False
        or report.get("practiceIDs") != list(EXPECTED_IDS)
        or report.get("languages") != list(LANGUAGES)
        or report.get("totals", {}).get("tracks") != 84
    ):
        raise PromotionFailure("public objective report is not a complete 42x2 objective set")
    if any(state != "pending" for state in report.get("humanGates", {}).values()):
        raise PromotionFailure("human gates must remain pending")

    practices = catalog.get("practices")
    if not isinstance(practices, list) or [item.get("id") for item in practices] != list(EXPECTED_IDS):
        raise PromotionFailure("catalogue is not the exact ordered 42-practice source")
    report_tracks = {(item.get("id"), item.get("language")): item for item in report.get("tracks", [])}
    if set(report_tracks) != {(identifier, language) for identifier in EXPECTED_IDS for language in LANGUAGES}:
        raise PromotionFailure("objective report does not contain the exact bilingual track set")

    prepared: list[dict[str, Any]] = []
    production_version = report["productionVersion"]
    for practice in practices:
        identifier = practice["id"]
        for language in LANGUAGES:
            track = report_tracks[(identifier, language)]
            track_root = PRIVATE_ROOT / production_version / identifier / language
            manifest_path = track_root / "manifest.json"
            delivery_path = track_root / "delivery.m4a"
            transcript_path = track_root / "transcript.vtt"
            manifest = load_json(manifest_path)
            expected = {
                "contentID": identifier,
                "language": language,
                "automatedState": "production-candidate-objective-checks-passed",
                "productionMasterApproval": False,
                "finishedTrackApproval": False,
            }
            if any(manifest.get(key) != value for key, value in expected.items()):
                raise PromotionFailure(f"{identifier}/{language}: private manifest state mismatch")
            if (
                sha256(manifest_path) != track.get("manifestSHA256")
                or sha256(delivery_path) != track.get("deliverySHA256")
                or sha256(transcript_path) != track.get("transcriptSHA256")
                or manifest.get("processBoundary", {}).get("runtimeNetworkUsed") is not False
                or manifest.get("processBoundary", {}).get("referenceVoiceUsed") is not False
            ):
                raise PromotionFailure(f"{identifier}/{language}: private objective artifact mismatch")
            localized = practice["localized"][language]
            if sha256(ROOT / localized["scriptPath"]) != track.get("scriptSHA256"):
                raise PromotionFailure(f"{identifier}/{language}: script hash mismatch")
            prepared.append(
                {
                    "id": identifier,
                    "language": language,
                    "localized": localized,
                    "manifest": manifest,
                    "manifestSHA256": track["manifestSHA256"],
                    "delivery": delivery_path,
                    "transcript": transcript_path,
                    "track": track,
                    "promotedScriptSHA256": hashlib.sha256(
                        script_with_editorial_state(
                            ROOT / localized["scriptPath"],
                            localized["editorialState"],
                            "production-candidate",
                        ).encode("utf-8")
                    ).hexdigest(),
                }
            )
    approval = validate_approval(review_packet, REPORT_PATH)
    return catalog, report, prepared, approval


def provenance(
    item: dict[str, Any], report: dict[str, Any], approval: dict[str, Any]
) -> dict[str, Any]:
    manifest = item["manifest"]
    track = item["track"]
    return {
        "schemaVersion": 1,
        "contentID": item["id"],
        "language": item["language"],
        "scriptRevision": item["localized"]["scriptRevision"],
        "scriptSHA256": item["promotedScriptSHA256"],
        "generationScriptSHA256": track["scriptSHA256"],
        "audioSHA256": track["deliverySHA256"],
        "transcriptSHA256": track["transcriptSHA256"],
        "productionManifestSHA256": item["manifestSHA256"],
        "productionVersion": report["productionVersion"],
        "productionDirection": track["direction"],
        "source": report["source"],
        "model": report["model"],
        "referenceVoiceUsed": False,
        "runtimeNetworkUsed": False,
        "integratedLUFS": track["integratedLUFS"],
        "truePeakDBTP": track["truePeakDBTP"],
        "deliveryBitrateBPS": track["deliveryBitrateBPS"],
        "durationSeconds": track["durationSeconds"],
        "reviewRecordSHA256": approval["reviewRecordSHA256"],
        "reviewPacketManifestSHA256": approval["packetManifestSHA256"],
        "rightsState": "approved",
        "humanListeningState": "approved",
        "scriptSafetyState": "approved",
        "transcriptAlignmentState": "approved",
        "physicalDeviceAudioState": "pending-testflight-review",
        "automatedObjectiveState": "passed",
        "productionMasterApproval": True,
        "finishedTrackApproval": True,
        "finishedLibraryApproval": False,
        "claimBoundary": "Human-approved narration device candidate; TestFlight physical-device audio and finished-library approval remain pending.",
    }


def script_with_editorial_state(path: Path, expected: str, replacement: str) -> str:
    text = path.read_text(encoding="utf-8")
    marker = f"status: {expected}"
    if text.count(marker) != 1:
        raise PromotionFailure(f"{path.name}: expected one exact {marker!r} header")
    return text.replace(marker, f"status: {replacement}", 1)


def apply_promotion(
    catalog: dict[str, Any],
    report: dict[str, Any],
    items: list[dict[str, Any]],
    approval: dict[str, Any],
) -> None:
    catalog_hash = sha256(CATALOG_PATH)
    backup = BACKUP_ROOT / f"narration-promotion-backup-{catalog_hash[:12]}"
    if backup.exists():
        raise PromotionFailure("the exact pre-promotion backup already exists; inspect it before retrying")
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(CATALOG_PATH, backup / "catalog.json")
    for item in items:
        target_root = ROOT / "Content/guided" / item["id"]
        for name in (f"audio.{item['language']}.m4a", f"transcript.{item['language']}.vtt", f"provenance.{item['language']}.json"):
            existing = target_root / name
            if existing.is_file():
                saved = backup / item["id"] / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(existing, saved)
        script_path = ROOT / item["localized"]["scriptPath"]
        saved_script = backup / item["id"] / script_path.name
        saved_script.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(script_path, saved_script)

    with tempfile.TemporaryDirectory(prefix="narration-promotion-", dir=ROOT / ".build") as temporary:
        stage = Path(temporary)
        for item in items:
            staged_root = stage / item["id"]
            staged_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item["delivery"], staged_root / f"audio.{item['language']}.m4a")
            shutil.copy2(item["transcript"], staged_root / f"transcript.{item['language']}.vtt")
            (staged_root / f"provenance.{item['language']}.json").write_text(
                json.dumps(
                    provenance(item, report, approval),
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            script_path = ROOT / item["localized"]["scriptPath"]
            (staged_root / script_path.name).write_text(
                script_with_editorial_state(
                    script_path,
                    item["localized"]["editorialState"],
                    "production-candidate",
                ),
                encoding="utf-8",
            )
        for practice in catalog["practices"]:
            for language in LANGUAGES:
                practice["localized"][language]["editorialState"] = "production-candidate"
        staged_catalog = stage / "catalog.json"
        staged_catalog.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        for item in items:
            target_root = ROOT / "Content/guided" / item["id"]
            for name in (f"audio.{item['language']}.m4a", f"transcript.{item['language']}.vtt", f"provenance.{item['language']}.json"):
                os.replace(stage / item["id"] / name, target_root / name)
            script_path = ROOT / item["localized"]["scriptPath"]
            os.replace(stage / item["id"] / script_path.name, script_path)
        os.replace(staged_catalog, CATALOG_PATH)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--review-packet",
        type=Path,
        required=True,
        help="Private complete review packet whose review-template.json records every approval.",
    )
    parser.add_argument("--apply", action="store_true", help="write validated candidates into public resources")
    args = parser.parse_args()
    catalog, report, items, approval = validate_inputs(args.review_packet)
    if args.apply:
        apply_promotion(catalog, report, items, approval)
        action = "promoted"
    else:
        action = "ready"
    print(
        f"Narration promotion {action}: 84 exact objective candidates with "
        "hash-bound human and rights approval for physical-device testing."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ApprovalFailure, PromotionFailure, OSError, KeyError, TypeError) as error:
        print(f"narration promotion failed: {error}")
        raise SystemExit(1) from error

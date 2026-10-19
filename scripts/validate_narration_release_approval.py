#!/usr/bin/env python3
"""Validate the private post-TestFlight seal for a narrated release candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from validate_narration_review_approval import validate_approval


REQUIRED_SCENARIOS = {
    "builtInSpeaker",
    "headphones",
    "bluetooth",
    "lock",
    "background",
    "interruption",
    "routeLoss",
    "narrationAmbienceBalance",
    "languageOverride",
}
DEVICE_FAMILIES = ("iphone", "ipad")


class ReleaseApprovalFailure(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ReleaseApprovalFailure(f"release input must be a regular file: {path.name}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseApprovalFailure(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise ReleaseApprovalFailure(f"expected JSON object: {path.name}")
    return value


def validate_release_approval(
    review_packet: Path,
    objective_report: Path,
    candidate_record_path: Path,
    release_approval_path: Path,
) -> dict[str, Any]:
    review = validate_approval(review_packet, objective_report)
    candidate = load_json(candidate_record_path)
    release = load_json(release_approval_path)
    binary = candidate.get("binary")
    media = candidate.get("media_state")
    app_store = candidate.get("app_store_connect")
    if not all(isinstance(value, dict) for value in (binary, media, app_store)):
        raise ReleaseApprovalFailure("candidate record is missing binary, media, or App Store state")
    if (
        binary.get("apple_processing_validation") != "VALID"
        or app_store.get("processing_state") != "VALID"
        or app_store.get("internal_build_state") != "IN_BETA_TESTING"
        or not isinstance(app_store.get("build_id"), str)
        or not app_store["build_id"].strip()
        or not isinstance(binary.get("ipa_sha256"), str)
        or len(binary["ipa_sha256"]) != 64
        or media.get("narration_track_count") != 84
        or media.get("narration_incomplete") is not False
        or media.get("human_audio_and_rights_review_passed") is not True
    ):
        raise ReleaseApprovalFailure("candidate record is not an exact valid narrated TestFlight build")
    expected = {
        "schemaVersion": 1,
        "state": "approved-for-shipping",
        "reviewRecordSHA256": review["reviewRecordSHA256"],
        "reviewPacketManifestSHA256": review["packetManifestSHA256"],
        "candidateRecordSHA256": sha256(candidate_record_path),
        "marketingVersion": candidate.get("marketing_version"),
        "buildNumber": candidate.get("build_number"),
        "ipaSHA256": binary.get("ipa_sha256"),
        "finishedLibraryApproval": "approved",
    }
    for key, value in expected.items():
        if release.get(key) != value:
            raise ReleaseApprovalFailure(f"release approval mismatch for {key}")
    if not isinstance(release.get("approvalNotes"), str):
        raise ReleaseApprovalFailure("release approval notes must be a string")
    devices = release.get("physicalDeviceAudio")
    if not isinstance(devices, dict) or set(devices) != set(DEVICE_FAMILIES):
        raise ReleaseApprovalFailure("exact iPhone/iPad physical audio evidence is required")
    for family in DEVICE_FAMILIES:
        device = devices[family]
        scenarios = device.get("scenarios") if isinstance(device, dict) else None
        if (
            not isinstance(device.get("target"), str)
            or not device["target"].strip()
            or device.get("distributionChannel") != "TestFlight"
            or device.get("marketingVersion") != expected["marketingVersion"]
            or device.get("buildNumber") != expected["buildNumber"]
            or device.get("buildID") != app_store["build_id"]
            or device.get("ipaSHA256") != expected["ipaSHA256"]
            or device.get("state") != "approved"
            or not isinstance(device.get("notes"), str)
            or not isinstance(scenarios, dict)
            or set(scenarios) != REQUIRED_SCENARIOS
        ):
            raise ReleaseApprovalFailure(f"{family}: incomplete exact physical audio evidence")
        for scenario, state in scenarios.items():
            allowed = {"approved"}
            if scenario == "headphones":
                allowed.add("not-applicable-unavailable")
            if state not in allowed:
                raise ReleaseApprovalFailure(f"{family}/{scenario}: physical audio gate not approved")
    return {
        "marketingVersion": expected["marketingVersion"],
        "buildNumber": expected["buildNumber"],
        "ipaSHA256": expected["ipaSHA256"],
        "releaseApprovalSHA256": sha256(release_approval_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-packet", type=Path, required=True)
    parser.add_argument("--objective-report", type=Path, required=True)
    parser.add_argument("--candidate-record", type=Path, required=True)
    parser.add_argument("--release-approval", type=Path, required=True)
    arguments = parser.parse_args()
    result = validate_release_approval(
        arguments.review_packet,
        arguments.objective_report,
        arguments.candidate_record,
        arguments.release_approval,
    )
    print(
        "Narration release approval passed: "
        f"{result['marketingVersion']} ({result['buildNumber']}) is hash-bound to approved "
        "human review and exact iPhone/iPad physical audio evidence."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseApprovalFailure, OSError, KeyError, TypeError, ValueError) as error:
        print(f"narration release approval failed: {error}")
        raise SystemExit(1) from error

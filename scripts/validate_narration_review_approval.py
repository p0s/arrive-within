#!/usr/bin/env python3
"""Validate a private, hash-bound human narration approval packet."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REPORT = ROOT / "docs/audio/production-candidate-results.json"
EXPECTED_IDS = tuple(f"G{index:02d}" for index in range(1, 43))
LANGUAGES = ("en", "de")
TRACK_GATES = (
    "fluentListening",
    "scriptAndEditorialReview",
    "pronunciationAndArtifactReview",
    "vttAlignmentReview",
    "finishedTrackApproval",
)
LIBRARY_GATES = (
    "publicRedistributionSignoff",
    "deviceCandidateApproval",
)


class ApprovalFailure(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ApprovalFailure(f"approval input must be a regular file: {path.name}")


def load_json(path: Path) -> dict[str, Any]:
    require_regular_file(path)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApprovalFailure(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise ApprovalFailure(f"expected JSON object: {path.name}")
    return value


def safe_packet_asset(packet: Path, relative: Any, label: str) -> Path:
    if not isinstance(relative, str):
        raise ApprovalFailure(f"{label} asset path is missing")
    candidate = Path(relative)
    if candidate.is_absolute() or candidate.parts != ("assets", candidate.name):
        raise ApprovalFailure(f"{label} asset path is unsafe")
    unresolved = packet / candidate
    if unresolved.is_symlink():
        raise ApprovalFailure(f"{label} asset must not be a symlink")
    resolved_packet = packet.resolve()
    resolved = unresolved.resolve()
    if resolved.parent != resolved_packet / "assets":
        raise ApprovalFailure(f"{label} asset escapes the packet")
    require_regular_file(resolved)
    return resolved


def validate_approval(packet: Path, report_path: Path) -> dict[str, Any]:
    if packet.is_symlink() or not packet.is_dir():
        raise ApprovalFailure("review packet must be a real directory")
    packet_manifest_path = packet / "manifest.json"
    review_path = packet / "review-template.json"
    packet_manifest = load_json(packet_manifest_path)
    review = load_json(review_path)
    report = load_json(report_path)

    expected_keys = {(identifier, language) for identifier in EXPECTED_IDS for language in LANGUAGES}
    items = packet_manifest.get("items")
    if (
        packet_manifest.get("schemaVersion") != 1
        or packet_manifest.get("scope") != "private-completed-candidates-only-not-library-approval"
        or packet_manifest.get("candidateCount") != 84
        or not isinstance(items, list)
        or len(items) != 84
    ):
        raise ApprovalFailure("packet manifest is not an exact 42x2 review set")
    packet_items = {(item.get("id"), item.get("language")): item for item in items if isinstance(item, dict)}
    if set(packet_items) != expected_keys:
        raise ApprovalFailure("packet manifest track identities are incomplete or duplicated")

    tracks = review.get("tracks")
    if (
        review.get("schemaVersion") != 1
        or review.get("state") != "approved-for-promotion"
        or review.get("packetManifestSHA256") != sha256(packet_manifest_path)
        or not isinstance(tracks, list)
        or len(tracks) != 84
    ):
        raise ApprovalFailure("review record is not an approved hash-bound 42x2 set")
    review_tracks = {(track.get("id"), track.get("language")): track for track in tracks if isinstance(track, dict)}
    if set(review_tracks) != expected_keys:
        raise ApprovalFailure("review track identities are incomplete or duplicated")
    library_gates = review.get("libraryGates")
    if not isinstance(library_gates, dict) or set(library_gates) != set(LIBRARY_GATES):
        raise ApprovalFailure("library approval gates do not match the required set")
    if any(library_gates[gate] != "approved" for gate in LIBRARY_GATES):
        raise ApprovalFailure("every library approval gate must be approved")
    if not isinstance(review.get("approvalNotes"), str):
        raise ApprovalFailure("approval notes must be a string")

    report_tracks_raw = report.get("tracks")
    if (
        report.get("scope") != "complete-42x2"
        or report.get("objectiveValidation") != "passed"
        or report.get("totals", {}).get("tracks") != 84
        or not isinstance(report_tracks_raw, list)
    ):
        raise ApprovalFailure("objective report is not a passed complete 42x2 set")
    report_tracks = {
        (track.get("id"), track.get("language")): track
        for track in report_tracks_raw
        if isinstance(track, dict)
    }
    if set(report_tracks) != expected_keys:
        raise ApprovalFailure("objective report track identities are incomplete or duplicated")

    for key in sorted(expected_keys):
        item = packet_items[key]
        reviewed = review_tracks[key]
        objective = report_tracks[key]
        expected_hashes = {
            "candidateManifestSHA256": objective.get("manifestSHA256"),
            "deliverySHA256": objective.get("deliverySHA256"),
            "transcriptSHA256": objective.get("transcriptSHA256"),
        }
        if any(item.get(field) != value or reviewed.get(field) != value for field, value in expected_hashes.items()):
            raise ApprovalFailure(f"{key[0]}/{key[1]}: reviewed hashes do not match objective evidence")
        gates = reviewed.get("gates")
        if not isinstance(gates, dict) or set(gates) != set(TRACK_GATES):
            raise ApprovalFailure(f"{key[0]}/{key[1]}: track approval gates do not match")
        if any(gates[gate] != "approved" for gate in TRACK_GATES):
            raise ApprovalFailure(f"{key[0]}/{key[1]}: every track gate must be approved")
        if not isinstance(reviewed.get("notes"), str):
            raise ApprovalFailure(f"{key[0]}/{key[1]}: notes must be a string")
        audio = safe_packet_asset(packet, item.get("audio"), f"{key[0]}/{key[1]} audio")
        transcript = safe_packet_asset(packet, item.get("transcript"), f"{key[0]}/{key[1]} transcript")
        if sha256(audio) != expected_hashes["deliverySHA256"] or sha256(transcript) != expected_hashes["transcriptSHA256"]:
            raise ApprovalFailure(f"{key[0]}/{key[1]}: reviewed packet bytes changed after approval")

    return {
        "reviewRecordSHA256": sha256(review_path),
        "packetManifestSHA256": sha256(packet_manifest_path),
        "trackCount": 84,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--objective-report", type=Path, default=DEFAULT_REPORT)
    arguments = parser.parse_args()
    result = validate_approval(arguments.packet, arguments.objective_report)
    print(
        "Narration device-candidate approval passed: "
        f"{result['trackCount']} hash-bound tracks and every required human/rights gate approved."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ApprovalFailure, OSError, KeyError, TypeError, ValueError) as error:
        print(f"narration approval failed: {error}")
        raise SystemExit(1) from error

#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate_narration_review_approval.py")
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("narration_review_approval", SCRIPT)
assert SPEC and SPEC.loader
approval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(approval)

PROMOTION_SCRIPT = Path(__file__).with_name("promote_narration_candidates.py")
PROMOTION_SPEC = importlib.util.spec_from_file_location(
    "narration_promotion", PROMOTION_SCRIPT
)
assert PROMOTION_SPEC and PROMOTION_SPEC.loader
promotion = importlib.util.module_from_spec(PROMOTION_SPEC)
PROMOTION_SPEC.loader.exec_module(promotion)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class NarrationReviewApprovalTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path]:
        packet = root / "packet"
        assets = packet / "assets"
        assets.mkdir(parents=True)
        items = []
        review_tracks = []
        report_tracks = []
        for identifier in approval.EXPECTED_IDS:
            for language in approval.LANGUAGES:
                stem = f"{identifier}.{language}"
                audio = f"audio-{stem}".encode()
                transcript = f"WEBVTT\n\n{stem}\n".encode()
                (assets / f"{stem}.m4a").write_bytes(audio)
                (assets / f"{stem}.vtt").write_bytes(transcript)
                manifest_hash = digest(f"manifest-{stem}".encode())
                audio_hash = digest(audio)
                transcript_hash = digest(transcript)
                hashes = {
                    "candidateManifestSHA256": manifest_hash,
                    "deliverySHA256": audio_hash,
                    "transcriptSHA256": transcript_hash,
                }
                items.append(
                    {
                        "id": identifier,
                        "language": language,
                        **hashes,
                        "audio": f"assets/{stem}.m4a",
                        "transcript": f"assets/{stem}.vtt",
                    }
                )
                review_tracks.append(
                    {
                        "id": identifier,
                        "language": language,
                        **hashes,
                        "gates": {gate: "approved" for gate in approval.TRACK_GATES},
                        "notes": "",
                    }
                )
                report_tracks.append(
                    {
                        "id": identifier,
                        "language": language,
                        "manifestSHA256": manifest_hash,
                        "deliverySHA256": audio_hash,
                        "transcriptSHA256": transcript_hash,
                    }
                )
        manifest_path = packet / "manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "scope": "private-completed-candidates-only-not-library-approval",
                    "candidateCount": 84,
                    "items": items,
                }
            ),
            encoding="utf-8",
        )
        review_path = packet / "review-template.json"
        review_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "state": "approved-for-promotion",
                    "packetManifestSHA256": approval.sha256(manifest_path),
                    "tracks": review_tracks,
                    "libraryGates": {gate: "approved" for gate in approval.LIBRARY_GATES},
                    "approvalNotes": "",
                }
            ),
            encoding="utf-8",
        )
        report_path = root / "report.json"
        report_path.write_text(
            json.dumps(
                {
                    "scope": "complete-42x2",
                    "objectiveValidation": "passed",
                    "totals": {"tracks": 84},
                    "tracks": report_tracks,
                }
            ),
            encoding="utf-8",
        )
        return packet, report_path

    def test_exact_complete_approved_packet_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            packet, report = self.fixture(Path(directory))
            result = approval.validate_approval(packet, report)
            self.assertEqual(result["trackCount"], 84)
            self.assertEqual(result["packetManifestSHA256"], approval.sha256(packet / "manifest.json"))

    def test_pending_track_gate_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            packet, report = self.fixture(Path(directory))
            review_path = packet / "review-template.json"
            review = json.loads(review_path.read_text())
            review["tracks"][0]["gates"]["fluentListening"] = "pending"
            review_path.write_text(json.dumps(review))
            with self.assertRaisesRegex(approval.ApprovalFailure, "every track gate"):
                approval.validate_approval(packet, report)

    def test_tampered_reviewed_audio_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            packet, report = self.fixture(Path(directory))
            (packet / "assets" / "G01.en.m4a").write_bytes(b"changed")
            with self.assertRaisesRegex(approval.ApprovalFailure, "changed after approval"):
                approval.validate_approval(packet, report)

    def test_device_candidate_script_state_changes_exactly_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.md"
            path.write_text("---\nstatus: draft\n---\nWords.\n")
            promoted = promotion.script_with_editorial_state(path, "draft", "production-candidate")
            self.assertIn("status: production-candidate", promoted)
            self.assertNotIn("status: draft", promoted)

    def test_device_candidate_script_state_fails_on_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.md"
            path.write_text("---\nstatus: approved\n---\nWords.\n")
            with self.assertRaisesRegex(promotion.PromotionFailure, "expected one exact"):
                promotion.script_with_editorial_state(path, "draft", "production-candidate")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("validate_narration_release_approval.py")
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("narration_release_approval", SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class NarrationReleaseApprovalTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path]:
        candidate = root / "candidate.json"
        candidate.write_text(
            json.dumps(
                {
                    "marketing_version": "1.1",
                    "build_number": 8,
                    "binary": {
                        "ipa_sha256": "a" * 64,
                        "apple_processing_validation": "VALID",
                    },
                    "media_state": {
                        "narration_track_count": 84,
                        "narration_incomplete": False,
                        "human_audio_and_rights_review_passed": True,
                    },
                    "app_store_connect": {
                        "build_id": "testflight-build-8",
                        "processing_state": "VALID",
                        "internal_build_state": "IN_BETA_TESTING",
                    },
                }
            )
        )
        scenarios = {scenario: "approved" for scenario in release.REQUIRED_SCENARIOS}
        approval = root / "release-approval.json"
        approval.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "state": "approved-for-shipping",
                    "reviewRecordSHA256": "b" * 64,
                    "reviewPacketManifestSHA256": "c" * 64,
                    "candidateRecordSHA256": release.sha256(candidate),
                    "marketingVersion": "1.1",
                    "buildNumber": 8,
                    "ipaSHA256": "a" * 64,
                    "finishedLibraryApproval": "approved",
                    "physicalDeviceAudio": {
                        "iphone": {
                            "target": "physical-phone",
                            "distributionChannel": "TestFlight",
                            "marketingVersion": "1.1",
                            "buildNumber": 8,
                            "buildID": "testflight-build-8",
                            "ipaSHA256": "a" * 64,
                            "state": "approved",
                            "scenarios": scenarios,
                            "notes": "",
                        },
                        "ipad": {
                            "target": "physical-tablet",
                            "distributionChannel": "TestFlight",
                            "marketingVersion": "1.1",
                            "buildNumber": 8,
                            "buildID": "testflight-build-8",
                            "ipaSHA256": "a" * 64,
                            "state": "approved",
                            "scenarios": scenarios,
                            "notes": "",
                        },
                    },
                    "approvalNotes": "",
                }
            )
        )
        return candidate, approval

    def test_exact_testflight_release_approval_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate, approval = self.fixture(root)
            review_result = {
                "reviewRecordSHA256": "b" * 64,
                "packetManifestSHA256": "c" * 64,
                "trackCount": 84,
            }
            with mock.patch.object(release, "validate_approval", return_value=review_result):
                result = release.validate_release_approval(
                    root / "packet", root / "objective.json", candidate, approval
                )
            self.assertEqual(result["buildNumber"], 8)

    def test_pending_device_scenario_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate, approval = self.fixture(root)
            document = json.loads(approval.read_text())
            document["physicalDeviceAudio"]["ipad"]["scenarios"]["routeLoss"] = "pending"
            approval.write_text(json.dumps(document))
            review_result = {
                "reviewRecordSHA256": "b" * 64,
                "packetManifestSHA256": "c" * 64,
                "trackCount": 84,
            }
            with mock.patch.object(release, "validate_approval", return_value=review_result):
                with self.assertRaisesRegex(release.ReleaseApprovalFailure, "not approved"):
                    release.validate_release_approval(
                        root / "packet", root / "objective.json", candidate, approval
                    )

    def test_candidate_record_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate, approval = self.fixture(root)
            candidate_document = json.loads(candidate.read_text())
            candidate_document["build_number"] = 9
            candidate.write_text(json.dumps(candidate_document))
            review_result = {
                "reviewRecordSHA256": "b" * 64,
                "packetManifestSHA256": "c" * 64,
                "trackCount": 84,
            }
            with mock.patch.object(release, "validate_approval", return_value=review_result):
                with self.assertRaisesRegex(release.ReleaseApprovalFailure, "candidateRecordSHA256"):
                    release.validate_release_approval(
                        root / "packet", root / "objective.json", candidate, approval
                    )

    def test_physical_evidence_from_another_build_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate, approval = self.fixture(root)
            document = json.loads(approval.read_text())
            document["physicalDeviceAudio"]["ipad"]["buildID"] = "stale-build"
            approval.write_text(json.dumps(document))
            review_result = {
                "reviewRecordSHA256": "b" * 64,
                "packetManifestSHA256": "c" * 64,
                "trackCount": 84,
            }
            with mock.patch.object(release, "validate_approval", return_value=review_result):
                with self.assertRaisesRegex(release.ReleaseApprovalFailure, "physical audio evidence"):
                    release.validate_release_approval(
                        root / "packet", root / "objective.json", candidate, approval
                    )


if __name__ == "__main__":
    unittest.main()

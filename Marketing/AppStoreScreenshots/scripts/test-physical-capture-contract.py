#!/usr/bin/env python3

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from physical_capture_contract import garden_phase, validate_report


class PhysicalCaptureContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source_commit = "a" * 40
        self.revision = "b" * 64
        self.namespace = str(uuid.UUID("ba197c64-e230-5ad7-9bdf-81ced414a21c"))

    def report(self, capture_id: str, locale: str, time_text: str) -> dict[str, object]:
        hour, minute = map(int, time_text.split(":"))
        local = datetime(2026, 9, 25, hour, minute, tzinfo=timezone(timedelta(hours=8)))
        started = local.astimezone(timezone.utc)
        appearance, surface, needs_renderer = {
            "garden-seed": ("dark", "garden", True),
            "garden-hero": ("dark", "garden", True),
            "garden-day": ("light", "garden", True),
            "journey-calendar": ("light", "journey", False),
            "journey-milestones": ("light", "journey-milestones", False),
            "journal": ("light", "journal-editor", False),
        }[capture_id]
        return {
            "schemaVersion": 1,
            "captureID": capture_id,
            "locale": locale,
            "appearance": appearance,
            "namespace": self.namespace,
            "readySurface": surface,
            "rendererReady": needs_renderer,
            "journalEditorPrefilled": capture_id == "journal",
            "bundleIdentifier": "com.philipps.arrivewithin.ios",
            "marketingVersion": "1.0.2",
            "buildNumber": "19",
            "sourceCommit": self.source_commit,
            "sourceManifestRevision": self.revision,
            "startedAt": started.isoformat(),
            "captureLocalDate": "2026-09-25",
            "visibleStatusTime": time_text,
            "timezone": "Asia/Singapore",
            "gardenPhase": garden_phase(time_text),
        }

    def validate(self, report: dict[str, object], capture_id: str, locale: str) -> dict[str, object]:
        start = datetime.fromisoformat(str(report["startedAt"]))
        return validate_report(
            report,
            expected_capture_id=capture_id,
            expected_locale=locale,
            bundle_id="com.philipps.arrivewithin.ios",
            marketing_version="1.0.2",
            build_number="19",
            source_commit=self.source_commit,
            device_family="iPad",
            device_model="iPad Pro 13-inch (M4)",
            os_version="26.6",
            started_after=(start - timedelta(seconds=2)).isoformat(),
            now=start + timedelta(seconds=2),
        )

    def test_all_six_current_capture_states_accept_only_their_real_phase(self) -> None:
        times = {
            "garden-seed": "21:10",
            "garden-hero": "18:15",
            "garden-day": "12:00",
            "journey-calendar": "12:01",
            "journey-milestones": "12:02",
            "journal": "12:03",
        }
        for capture_id, time_text in times.items():
            with self.subTest(capture_id=capture_id):
                result = self.validate(self.report(capture_id, "en-US", time_text), capture_id, "en-US")
                self.assertEqual(result["status"], "passed")

    def test_wrong_phase_is_rejected(self) -> None:
        seed = self.report("garden-seed", "en-US", "07:30")
        seed["gardenPhase"] = "dawn"
        with self.assertRaisesRegex(ValueError, "dusk or night"):
            self.validate(seed, "garden-seed", "en-US")
        day = self.report("garden-day", "de-DE", "17:00")
        day["gardenPhase"] = "dusk"
        with self.assertRaisesRegex(ValueError, "08:00–16:59"):
            self.validate(day, "garden-day", "de-DE")

    def test_mismatched_locale_capture_source_or_device_fails_closed(self) -> None:
        report = self.report("journal", "de-DE", "12:00")
        with self.assertRaisesRegex(ValueError, "fixture, locale"):
            self.validate(report, "journal", "en-US")
        report = self.report("garden-day", "en-US", "12:00")
        report["appearance"] = "dark"
        with self.assertRaisesRegex(ValueError, "fixture, locale, appearance"):
            self.validate(report, "garden-day", "en-US")
        report = self.report("journey-calendar", "en-US", "12:00")
        with self.assertRaisesRegex(ValueError, "source commit"):
            validate_report(
                report,
                expected_capture_id="journey-calendar",
                expected_locale="en-US",
                bundle_id="com.philipps.arrivewithin.ios",
                marketing_version="1.0.2",
                build_number="19",
                source_commit="c" * 40,
                device_family="iPad",
                device_model="iPad Pro 13-inch (M4)",
                os_version="26.6",
                started_after="2026-09-25T04:00:00+00:00",
                now=datetime.fromisoformat(str(report["startedAt"])) + timedelta(seconds=2),
            )
        with self.assertRaisesRegex(ValueError, "configured 13-inch iPad"):
            validate_report(
                report,
                expected_capture_id="journey-calendar",
                expected_locale="en-US",
                bundle_id="com.philipps.arrivewithin.ios",
                marketing_version="1.0.2",
                build_number="19",
                source_commit=self.source_commit,
                device_family="iPad",
                device_model="iPad Pro 11-inch (M5)",
                os_version="26.6",
                started_after="2026-09-25T04:00:00+00:00",
                now=datetime.fromisoformat(str(report["startedAt"])) + timedelta(seconds=2),
            )

    def test_unexpected_report_fields_or_status_override_timezone_fail(self) -> None:
        report = self.report("garden-day", "en-US", "12:00")
        report["statusOverride"] = True
        with self.assertRaisesRegex(ValueError, "unknown or incomplete"):
            self.validate(report, "garden-day", "en-US")
        report = self.report("garden-day", "en-US", "12:00")
        report["timezone"] = "UTC"
        with self.assertRaisesRegex(ValueError, "timezone Asia/Singapore"):
            self.validate(report, "garden-day", "en-US")


if __name__ == "__main__":
    unittest.main(verbosity=2)

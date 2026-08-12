#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("create_narration_review_packet.py")
SPEC = importlib.util.spec_from_file_location("narration_review_packet", SCRIPT)
assert SPEC and SPEC.loader
packet = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packet)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class NarrationReviewPacketTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path]:
        candidates = root / "candidates"
        track = candidates / "G01" / "en"
        track.mkdir(parents=True)
        audio = b"objective audio"
        transcript = b"WEBVTT\n\n00:00.000 --> 00:01.000\nArrive.\n"
        (track / "delivery.m4a").write_bytes(audio)
        (track / "transcript.vtt").write_bytes(transcript)
        manifest = {
            "contentID": "G01",
            "language": "en",
            "automatedState": "production-candidate-objective-checks-passed",
            "productionMasterApproval": False,
            "finishedTrackApproval": False,
            "direction": {"id": "en-f2-spacious-slow"},
            "assembly": {"speechOnlyWordsPerMinute": 117.0, "rawClippingAttention": True},
            "mastering": {"delivery": {"durationSeconds": 180.0, "integratedLUFS": -19.0, "truePeakDBTP": -2.0}},
            "files": {
                "delivery": {"name": "delivery.m4a", "bytes": len(audio), "sha256": digest(audio)},
                "transcript": {"name": "transcript.vtt", "bytes": len(transcript), "sha256": digest(transcript)},
            },
        }
        (track / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        catalog = root / "catalog.json"
        catalog.write_text(
            json.dumps({"practices": [{"id": "G01", "localized": {"en": {"title": "Arrive Here"}, "de": {"title": "Hier ankommen"}}}]}),
            encoding="utf-8",
        )
        return candidates, catalog

    def test_packet_copies_verified_assets_and_keeps_every_gate_pending(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            output = private / "review"
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                result = packet.build_packet(candidates, catalog, output)
            self.assertEqual(result["candidateCount"], 1)
            self.assertEqual(result["completeByLanguage"], {"en": 1, "de": 0})
            review = json.loads((output / "review-template.json").read_text())
            self.assertEqual(review["state"], "pending-human-review")
            self.assertTrue(all(value == "pending" for value in review["libraryGates"].values()))
            self.assertTrue(all(value == "pending" for value in review["tracks"][0]["gates"].values()))
            self.assertEqual(
                review["packetManifestSHA256"],
                packet.sha256(output / "manifest.json"),
            )
            self.assertEqual((output / "assets" / "G01.en.m4a").read_bytes(), b"objective audio")
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertIs(manifest["items"][0]["rawClippingAttention"], True)
            index = (output / "index.html").read_text()
            self.assertIn("connect-src 'none'", index)
            self.assertIn("raw-source clipping attention", index)
            self.assertIn("Export review-template.json", index)
            self.assertEqual(stat.S_IMODE((output / "index.html").stat().st_mode), 0o644)
            self.assertEqual(stat.S_IMODE((output / "review-template.json").stat().st_mode), 0o600)

    def test_hash_mismatch_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            (candidates / "G01" / "en" / "delivery.m4a").write_bytes(b"changed")
            with self.assertRaisesRegex(packet.PacketFailure, "do not match"):
                packet.collect_candidates(candidates, catalog)

    def test_existing_output_is_never_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            output = private / "review"
            output.mkdir(parents=True)
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                with self.assertRaisesRegex(packet.PacketFailure, "already exists"):
                    packet.build_packet(candidates, catalog, output)

    def test_exact_review_decisions_carry_forward(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            first = private / "review-one"
            second = private / "review-two"
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                packet.build_packet(candidates, catalog, first)
                review_path = first / "review-template.json"
                review = json.loads(review_path.read_text())
                review["tracks"][0]["gates"] = {
                    gate: "approved" for gate in packet.REVIEW_GATES
                }
                review["tracks"][0]["notes"] = "Listened in full."
                review_path.write_text(json.dumps(review))
                packet.build_packet(candidates, catalog, second, first)
            carried = json.loads((second / "review-template.json").read_text())
            self.assertTrue(
                all(value == "approved" for value in carried["tracks"][0]["gates"].values())
            )
            self.assertEqual(carried["tracks"][0]["notes"], "Listened in full.")

    def test_review_does_not_carry_after_candidate_hash_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            first = private / "review-one"
            second = private / "review-two"
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                packet.build_packet(candidates, catalog, first)
                review_path = first / "review-template.json"
                review = json.loads(review_path.read_text())
                review["tracks"][0]["gates"] = {
                    gate: "approved" for gate in packet.REVIEW_GATES
                }
                review_path.write_text(json.dumps(review))
                track = candidates / "G01" / "en"
                new_audio = b"new objective audio"
                (track / "delivery.m4a").write_bytes(new_audio)
                manifest = json.loads((track / "manifest.json").read_text())
                manifest["files"]["delivery"] = {
                    "name": "delivery.m4a",
                    "bytes": len(new_audio),
                    "sha256": digest(new_audio),
                }
                (track / "manifest.json").write_text(json.dumps(manifest))
                packet.build_packet(candidates, catalog, second, first)
            carried = json.loads((second / "review-template.json").read_text())
            self.assertTrue(
                all(value == "pending" for value in carried["tracks"][0]["gates"].values())
            )

    def test_parallel_review_records_merge_complementary_gates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            first = private / "review-one"
            second = private / "review-two"
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                packet.build_packet(candidates, catalog, first)
                base_path = first / "review-template.json"
                base = json.loads(base_path.read_text())
                first_record = root / "english-review.json"
                first_decision = json.loads(json.dumps(base))
                first_decision["tracks"][0]["gates"]["fluentListening"] = "approved"
                first_record.write_text(json.dumps(first_decision))
                second_record = root / "editorial-review.json"
                second_decision = json.loads(json.dumps(base))
                second_decision["tracks"][0]["gates"]["scriptAndEditorialReview"] = "approved"
                second_record.write_text(json.dumps(second_decision))
                packet.build_packet(
                    candidates,
                    catalog,
                    second,
                    first,
                    [first_record, second_record],
                )
            merged = json.loads((second / "review-template.json").read_text())
            self.assertEqual(merged["tracks"][0]["gates"]["fluentListening"], "approved")
            self.assertEqual(
                merged["tracks"][0]["gates"]["scriptAndEditorialReview"], "approved"
            )

    def test_conflicting_parallel_review_decisions_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates, catalog = self.fixture(root)
            private = root / ".evidence" / "audio"
            first = private / "review-one"
            second = private / "review-two"
            with mock.patch.object(packet, "PRIVATE_OUTPUT_ROOT", private):
                packet.build_packet(candidates, catalog, first)
                base = json.loads((first / "review-template.json").read_text())
                records = []
                for index, state in enumerate(("approved", "rejected")):
                    decision = json.loads(json.dumps(base))
                    decision["tracks"][0]["gates"]["fluentListening"] = state
                    record = root / f"review-{index}.json"
                    record.write_text(json.dumps(decision))
                    records.append(record)
                with self.assertRaisesRegex(packet.PacketFailure, "conflicting"):
                    packet.build_packet(candidates, catalog, second, first, records)


if __name__ == "__main__":
    unittest.main()

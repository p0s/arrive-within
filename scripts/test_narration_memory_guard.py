#!/usr/bin/env python3
"""Deterministic unit tests for the narration accelerator guard."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("run_narration_guarded.py")
SPEC = importlib.util.spec_from_file_location("narration_memory_guard", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load narration memory guard")
guard = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = guard
SPEC.loader.exec_module(guard)

GENERATOR_PATH = (
    Path(__file__).resolve().parents[1]
    / "ContentProduction"
    / "chatterbox-audition"
    / "generate_production_candidates.py"
)
GENERATOR_SPEC = importlib.util.spec_from_file_location(
    "narration_production_for_guard_test", GENERATOR_PATH
)
if GENERATOR_SPEC is None or GENERATOR_SPEC.loader is None:
    raise RuntimeError("Unable to load narration production module")
production = importlib.util.module_from_spec(GENERATOR_SPEC)
sys.modules[GENERATOR_SPEC.name] = production
GENERATOR_SPEC.loader.exec_module(production)


class NarrationMemoryGuardTests(unittest.TestCase):
    def test_guard_attests_every_model_file_the_generator_opens(self) -> None:
        for language in ("en", "de"):
            self.assertEqual(
                set(guard.MODEL_PATTERNS[language]),
                set(production.model_allow_patterns(language)),
            )

    @staticmethod
    def measurement(
        *, guard_terminated: bool, before: int, after: int, exit_code: int | None = None
    ) -> guard.ChildMeasurement:
        return guard.ChildMeasurement(
            language="en",
            exit_code=(
                exit_code
                if exit_code is not None
                else (-15 if guard_terminated else 0)
            ),
            required_start_available_bytes=20 * guard.GIB,
            before_available_bytes=20 * guard.GIB,
            minimum_available_bytes=11 * guard.GIB,
            after_available_bytes=20 * guard.GIB,
            peak_process_group_rss_bytes=4 * guard.GIB,
            guard_floor_bytes=10 * guard.GIB,
            kill_trigger_bytes=11 * guard.GIB,
            guard_terminated=guard_terminated,
            probe_first_unit=False,
            probe_unit_count=1,
            probe_result=None,
            checkpoint_count_before=before,
            checkpoint_count_after=after,
            checkpoint_existing_unchanged=True,
            checkpoint_new_count=max(0, after - before),
            checkpoint_removed_count=max(0, before - after),
            checkpoint_finalized_tracks=[],
            checkpoint_transition_valid=True,
        )

    def test_process_group_rss_sums_live_kib_samples(self) -> None:
        completed = mock.Mock(returncode=0, stdout=" 1024\n2048\n")
        with mock.patch.object(guard.subprocess, "run", return_value=completed) as run:
            self.assertEqual(guard.process_group_rss_bytes(42), 3 * 1024 * 1024)
        run.assert_called_once_with(
            ["/bin/ps", "-o", "rss=", "-g", "42"],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_parses_host_memory_pressure(self) -> None:
        sample = guard.parse_memory_pressure(
            "The system has 38654705664 (2359296 pages with a page size of 16384).\n"
            "System-wide memory free percentage: 79%\n"
        )
        self.assertEqual(sample.total_bytes, 38_654_705_664)
        self.assertEqual(sample.free_percent, 79)
        self.assertEqual(sample.available_bytes, 30_537_217_474)

    def test_headroom_is_maximum_of_ten_gib_and_quarter_ram(self) -> None:
        self.assertEqual(guard.minimum_headroom(16 * guard.GIB), 10 * guard.GIB)
        self.assertEqual(guard.minimum_headroom(64 * guard.GIB), 16 * guard.GIB)

    def test_optional_start_headroom_is_never_below_the_stop_trigger(self) -> None:
        trigger = 11 * guard.GIB
        self.assertEqual(guard.required_start_headroom(trigger, 0), trigger)
        self.assertEqual(guard.required_start_headroom(trigger, 30), 30 * guard.GIB)

    def test_preflight_timeout_report_preserves_latest_private_measurement(self) -> None:
        sample = guard.MemorySample(total_bytes=36 * guard.GIB, free_percent=50)
        with mock.patch.object(guard, "sample_host_memory", return_value=sample):
            with self.assertRaises(guard.HeadroomTimeout) as raised:
                guard.wait_for_headroom(
                    30 * guard.GIB,
                    timeout_seconds=0,
                    poll_seconds=0.25,
                    consecutive_samples=2,
                    phase="preflight",
                    language="en",
                )

        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "guard.json"
            guard.write_report(report, [], [raised.exception.failure])
            payload = json.loads(report.read_text(encoding="utf-8"))

        self.assertEqual(payload["measurements"], [])
        self.assertEqual(
            payload["headroomFailures"],
            [
                {
                    "free_percent": 50,
                    "language": "en",
                    "observed_available_bytes": 18 * guard.GIB,
                    "phase": "preflight",
                    "required_available_bytes": 30 * guard.GIB,
                    "total_bytes": 36 * guard.GIB,
                    "wait_seconds": 0,
                }
            ],
        )

    def test_probe_requires_one_practice(self) -> None:
        with self.assertRaises(SystemExit):
            guard.parse_args(["--language", "en", "--all", "--probe-first-unit"])

    def test_languages_are_unique(self) -> None:
        with self.assertRaises(SystemExit):
            guard.parse_args(
                ["--language", "en", "--language", "en", "--practice", "G01"]
            )

    def test_kill_buffer_cannot_be_removed(self) -> None:
        with self.assertRaises(SystemExit):
            guard.parse_args(
                ["--language", "en", "--practice", "G01", "--kill-buffer-gib", "0"]
            )

    def test_start_headroom_cannot_be_negative(self) -> None:
        with self.assertRaises(SystemExit):
            guard.parse_args(
                ["--language", "en", "--practice", "G01", "--start-headroom-gib", "-1"]
            )

    def test_seed_offset_requires_one_explicit_practice(self) -> None:
        with self.assertRaises(SystemExit):
            guard.parse_args(
                ["--language", "en", "--all", "--seed-offset", "1"]
            )

    def test_seed_offset_is_forwarded_to_the_owned_worker(self) -> None:
        arguments = guard.parse_args(
            ["--language", "en", "--practice", "G16", "--seed-offset", "1"]
        )

        command = guard.generation_command(arguments, "en")

        self.assertEqual(command[-2:], ["--seed-offset", "1"])

    def test_real_child_fails_closed_without_pinned_environment(self) -> None:
        arguments = guard.parse_args(
            ["--device", "cpu", "--language", "en", "--practice", "G16"]
        )
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(guard, "PROJECT", Path(directory)):
                with self.assertRaisesRegex(
                    RuntimeError, "Pinned narration environment is missing"
                ):
                    guard.run_child(arguments, "en")

    def test_probe_unit_count_is_bounded_and_forwarded(self) -> None:
        arguments = guard.parse_args(
            [
                "--language", "en", "--practice", "G16", "--probe-first-unit",
                "--probe-unit-count", "4",
            ]
        )
        report = Path("relative-private-probe.json")
        command = guard.generation_command(arguments, "en", report)
        self.assertIn("--probe-first-unit", command)
        self.assertEqual(command[command.index("--probe-unit-count") + 1], "4")
        self.assertEqual(command[command.index("--probe-report") + 1], str(report))

        larger = guard.parse_args(
            [
                "--language", "de", "--practice", "G16", "--probe-first-unit",
                "--probe-unit-count", "16", "--mps-residency-strategy", "phase-batched",
            ]
        )
        larger_command = guard.generation_command(larger, "de")
        self.assertEqual(larger.probe_unit_count, 16)
        self.assertEqual(
            larger_command[larger_command.index("--mps-residency-strategy") + 1],
            "phase-batched",
        )

        with self.assertRaises(SystemExit):
            guard.parse_args(
                ["--language", "en", "--practice", "G16", "--probe-unit-count", "4"]
            )

    def test_mlx_backend_uses_isolated_environment_for_production_and_probes(self) -> None:
        production_arguments = guard.parse_args(
            [
                "--backend", "mlx-audio", "--device", "mps",
                "--language", "de", "--practice", "G09", "--resume",
            ]
        )
        production_command = guard.generation_command(production_arguments, "de")
        self.assertEqual(
            production_command[0],
            str(guard.MLX_PROJECT / ".venv" / "bin" / "python"),
        )
        self.assertEqual(production_command[1], str(guard.GENERATOR))
        self.assertEqual(
            production_command[production_command.index("--backend") + 1],
            "mlx-audio",
        )
        arguments = guard.parse_args(
            [
                "--backend", "mlx-audio", "--device", "mps",
                "--language", "de", "--practice", "G01",
                "--probe-first-unit", "--probe-unit-count", "2",
                "--probe-unit-start", "62", "--probe-token-limit", "300",
            ]
        )
        report = Path("relative-private-probe.json")
        command = guard.generation_command(arguments, "de", report)
        self.assertEqual(command[0], str(guard.MLX_PROJECT / ".venv" / "bin" / "python"))
        self.assertEqual(command[1], str(guard.MLX_BENCHMARK))
        self.assertEqual(command[command.index("--unit-count") + 1], "2")
        self.assertEqual(command[command.index("--unit-start") + 1], "62")
        self.assertEqual(command[command.index("--token-limit-override") + 1], "300")
        self.assertEqual(command[command.index("--report") + 1], str(report))

    def test_one_unit_continuation_is_forwarded_and_rejects_probe(self) -> None:
        arguments = guard.parse_args(
            [
                "--language", "en", "--practice", "G16",
                "--one-new-unit-per-child",
                "--checkpoint-continuations", "1",
            ]
        )
        self.assertIn(
            "--one-new-unit-per-child",
            guard.generation_command(arguments, "en"),
        )
        self.assertEqual(
            guard.generation_command(arguments, "en")[
                guard.generation_command(arguments, "en").index("--new-units-per-child") + 1
            ],
            "1",
        )
        two_units = guard.parse_args(
            [
                "--language", "de", "--practice", "G16",
                "--one-new-unit-per-child", "--new-units-per-child", "2",
                "--checkpoint-continuations", "1",
            ]
        )
        self.assertEqual(two_units.new_units_per_child, 2)
        self.assertEqual(
            guard.generation_command(two_units, "de")[
                guard.generation_command(two_units, "de").index("--new-units-per-child") + 1
            ],
            "2",
        )
        eight_units = guard.parse_args(
            [
                "--language", "de", "--practice", "G16",
                "--one-new-unit-per-child", "--new-units-per-child", "8",
                "--checkpoint-continuations", "1",
                "--mps-residency-strategy", "phase-batched",
            ]
        )
        self.assertEqual(eight_units.new_units_per_child, 8)
        with self.assertRaises(SystemExit):
            guard.parse_args(
                [
                    "--language", "en", "--practice", "G16",
                    "--probe-first-unit", "--one-new-unit-per-child",
                ]
            )

    def test_main_retries_guarded_stops_with_or_without_checkpoint_progress(self) -> None:
        progress = self.measurement(guard_terminated=True, before=6, after=7)
        completed = self.measurement(guard_terminated=False, before=7, after=7)
        sample = guard.MemorySample(total_bytes=36 * guard.GIB, free_percent=75)
        with tempfile.TemporaryDirectory() as directory:
            with (
                mock.patch.object(guard.tempfile, "gettempdir", return_value=directory),
                mock.patch.object(guard, "run_child", side_effect=[progress, completed]) as run,
                mock.patch.object(guard, "sample_host_memory", return_value=sample),
                mock.patch.object(guard, "wait_for_headroom", return_value=sample),
            ):
                result = guard.main(
                    [
                        "--device", "cpu",
                        "--language", "en", "--practice", "G33",
                        "--checkpoint-retries", "1",
                    ]
                )

        self.assertEqual(result, 0)
        self.assertEqual(run.call_count, 2)

        no_progress = self.measurement(guard_terminated=True, before=7, after=7)
        with tempfile.TemporaryDirectory() as directory:
            with (
                mock.patch.object(guard.tempfile, "gettempdir", return_value=directory),
                mock.patch.object(
                    guard, "run_child", side_effect=[no_progress, completed]
                ) as run,
                mock.patch.object(guard, "sample_host_memory", return_value=sample),
                mock.patch.object(guard, "wait_for_headroom", return_value=sample),
            ):
                result = guard.main(
                    [
                        "--device", "cpu",
                        "--language", "en", "--practice", "G33",
                        "--checkpoint-retries", "1",
                    ]
                )

        self.assertEqual(result, 0)
        self.assertEqual(run.call_count, 2)

    def test_main_relaunches_only_after_dedicated_status_and_exact_progress(self) -> None:
        continued = self.measurement(
            guard_terminated=False,
            before=15,
            after=16,
            exit_code=guard.CHECKPOINT_CONTINUATION_EXIT_CODE,
        )
        completed = self.measurement(
            guard_terminated=False, before=16, after=16, exit_code=0
        )
        sample = guard.MemorySample(total_bytes=36 * guard.GIB, free_percent=75)
        with tempfile.TemporaryDirectory() as directory:
            with (
                mock.patch.object(guard.tempfile, "gettempdir", return_value=directory),
                mock.patch.object(
                    guard, "run_child", side_effect=[continued, completed]
                ) as run,
                mock.patch.object(guard, "sample_host_memory", return_value=sample),
                mock.patch.object(guard, "wait_for_headroom", return_value=sample),
            ):
                result = guard.main(
                    [
                        "--device", "cpu",
                        "--language", "en", "--practice", "G16",
                        "--checkpoint-retries", "1",
                        "--one-new-unit-per-child",
                        "--checkpoint-continuations", "1",
                    ]
                )
        self.assertEqual(result, 0)
        self.assertEqual(run.call_count, 2)

        no_progress = self.measurement(
            guard_terminated=False,
            before=16,
            after=16,
            exit_code=guard.CHECKPOINT_CONTINUATION_EXIT_CODE,
        )
        with tempfile.TemporaryDirectory() as directory:
            with (
                mock.patch.object(guard.tempfile, "gettempdir", return_value=directory),
                mock.patch.object(guard, "run_child", return_value=no_progress),
            ):
                with self.assertRaisesRegex(RuntimeError, "without bounded new"):
                    guard.main(
                        [
                            "--device", "cpu",
                            "--language", "en", "--practice", "G16",
                            "--checkpoint-retries", "1",
                            "--one-new-unit-per-child",
                            "--checkpoint-continuations", "1",
                        ]
                    )

        too_much_progress = self.measurement(
            guard_terminated=False,
            before=16,
            after=18,
            exit_code=guard.CHECKPOINT_CONTINUATION_EXIT_CODE,
        )
        with tempfile.TemporaryDirectory() as directory:
            with (
                mock.patch.object(guard.tempfile, "gettempdir", return_value=directory),
                mock.patch.object(guard, "run_child", return_value=too_much_progress),
            ):
                with self.assertRaisesRegex(RuntimeError, "without bounded new"):
                    guard.main(
                        [
                            "--device", "cpu",
                            "--language", "en", "--practice", "G16",
                            "--one-new-unit-per-child",
                            "--checkpoint-continuations", "1",
                        ]
                    )

    def test_checkpoint_inventory_validates_pcm_hash_and_contiguous_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            private_candidates = Path(directory) / "candidates"
            unit_root = private_candidates / ".unit-cache" / "G16" / "en" / "unit-0000"
            unit_root.mkdir(parents=True)
            samples = guard.struct.pack("<ff", 0.25, -0.5)
            pcm_path = unit_root / "pcm.npy"
            header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }"
            padding = " " * ((64 - ((10 + len(header) + 1) % 64)) % 64)
            encoded_header = (header + padding + "\n").encode("latin1")
            pcm_path.write_bytes(
                b"\x93NUMPY\x01\x00"
                + guard.struct.pack("<H", len(encoded_header))
                + encoded_header
                + samples
            )
            (unit_root / "metadata.json").write_text(
                json.dumps(
                    {
                        "generationOrdinal": 0,
                        "sampleCount": 2,
                        "pcmFloat32SHA256": guard.hashlib.sha256(samples).hexdigest(),
                    }
                ),
                encoding="utf-8",
            )
            arguments = guard.parse_args(
                ["--language", "en", "--practice", "G16"]
            )
            with mock.patch.object(guard, "PRIVATE_CANDIDATES", private_candidates):
                with mock.patch.object(
                    guard,
                    "checkpoint_pcm_sha256",
                    wraps=guard.checkpoint_pcm_sha256,
                ) as pcm_hash:
                    inventory = guard.checkpoint_inventory(arguments, "en")
                    self.assertEqual(tuple(inventory), ("G16/en/unit-0000",))
                    self.assertEqual(guard.checkpoint_inventory(arguments, "en"), inventory)
                    self.assertEqual(pcm_hash.call_count, 1)
                pcm_path.write_bytes(pcm_path.read_bytes()[:-1] + b"0")
                with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                    guard.checkpoint_inventory(arguments, "en")

    def test_checkpoint_transition_allows_finalized_track_cache_removal(self) -> None:
        before = {
            "G16/en/unit-0000": "a",
            "G16/en/unit-0001": "b",
        }
        after = {"G17/en/unit-0000": "c"}
        valid, added, removed, finalized = guard.checkpoint_transition(
            before,
            after,
            completed_before={"G01/en"},
            completed_after={"G01/en", "G16/en"},
        )
        self.assertTrue(valid)
        self.assertEqual(added, 1)
        self.assertEqual(removed, 2)
        self.assertEqual(finalized, ["G16/en"])

    def test_checkpoint_transition_rejects_unexplained_removal(self) -> None:
        valid, added, removed, finalized = guard.checkpoint_transition(
            {"G16/en/unit-0000": "a"},
            {"G17/en/unit-0000": "b"},
            completed_before=set(),
            completed_after=set(),
        )
        self.assertFalse(valid)
        self.assertEqual((added, removed, finalized), (1, 1, []))

    def test_guard_attestation_detects_replacement_without_rehashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.bin"
            path.write_bytes(b"expected model bytes")
            entry = guard.attest_regular_file(
                path, guard.hashlib.sha256(path.read_bytes()).hexdigest()
            )
            self.assertTrue(guard.integrity_entry_is_unchanged(entry))

            replacement = path.with_name("replacement.bin")
            replacement.write_bytes(path.read_bytes())
            os.replace(replacement, path)
            self.assertFalse(guard.integrity_entry_is_unchanged(entry))

    def test_guard_attestation_binds_the_generator_source(self) -> None:
        fake = {
            "guardPID": os.getpid(),
            "plan": guard.attest_regular_file(guard.NARRATION_PLAN),
            "generator": guard.attest_regular_file(guard.GENERATOR),
            "modelFiles": {"model": guard.attest_regular_file(guard.GENERATOR)},
            "candidateTracks": {},
        }
        with (
            mock.patch.object(guard, "require_unchanged_model_entry"),
            mock.patch.object(guard, "refresh_candidate_attestations"),
        ):
            guard.refresh_integrity_attestation(fake)
            fake["generator"]["signature"][3] += 1
            with self.assertRaisesRegex(RuntimeError, "changed"):
                guard.refresh_integrity_attestation(fake)

    def test_candidate_attestation_detects_a_file_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            track = Path(directory) / "G16" / "en"
            track.mkdir(parents=True)
            delivery = track / "delivery.m4a"
            delivery.write_bytes(b"candidate bytes")
            digest = guard.hashlib.sha256(delivery.read_bytes()).hexdigest()
            (track / "manifest.json").write_text(
                json.dumps(
                    {
                        "files": {
                            "delivery": {
                                "name": "delivery.m4a",
                                "sha256": digest,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            entry = guard.attest_candidate_track(track)
            guard.require_unchanged_candidate_track(entry)
            delivery.write_bytes(b"changed bytes")
            with self.assertRaisesRegex(RuntimeError, "changed"):
                guard.require_unchanged_candidate_track(entry)


if __name__ == "__main__":
    unittest.main()

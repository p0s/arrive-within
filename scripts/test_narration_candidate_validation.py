#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate_narration_candidates.py")
SPEC = importlib.util.spec_from_file_location("narration_candidate_validation", SCRIPT)
assert SPEC and SPEC.loader
validation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validation)


class NarrationCandidateBoundaryTests(unittest.TestCase):
    def test_current_one_unit_boundary(self) -> None:
        validation.validate_process_boundary(
            {
                "activeInvocationLifecycle": "one-new-unit-per-owned-process",
                "logicalGenerationCallCount": 1,
                "generationCallCount": 1,
                "assemblyProcessGenerationCallCount": 0,
                "assemblyProcessMPSModelReloadCount": 0,
                "configuredMaximumNewGenerationCallsPerOwnedProcess": 1,
                "maximumGenerationCallsPerMPSModel": 1,
            },
            "G01",
            "en",
        )

    def test_legacy_two_unit_label_is_accepted_only_in_the_proved_shape(self) -> None:
        validation.validate_process_boundary(
            {
                "activeInvocationLifecycle": "one-new-unit-per-owned-process",
                "logicalGenerationCallCount": 2,
                "generationCallCount": 2,
                "assemblyProcessGenerationCallCount": 0,
                "assemblyProcessMPSModelReloadCount": 0,
                "configuredMaximumNewGenerationCallsPerOwnedProcess": 2,
                "maximumGenerationCallsPerMPSModel": 2,
                "mpsResidencyStrategy": "phase-per-unit",
            },
            "G06",
            "de",
        )
        with self.assertRaisesRegex(validation.ValidationFailure, "invalid one-unit"):
            validation.validate_process_boundary(
                {
                    "activeInvocationLifecycle": "one-new-unit-per-owned-process",
                    "logicalGenerationCallCount": 2,
                    "generationCallCount": 2,
                    "assemblyProcessGenerationCallCount": 1,
                    "assemblyProcessMPSModelReloadCount": 0,
                    "configuredMaximumNewGenerationCallsPerOwnedProcess": 2,
                    "maximumGenerationCallsPerMPSModel": 2,
                    "mpsResidencyStrategy": "phase-per-unit",
                },
                "G06",
                "de",
            )


if __name__ == "__main__":
    unittest.main()

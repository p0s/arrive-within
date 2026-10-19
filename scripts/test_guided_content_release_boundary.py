#!/usr/bin/env python3
"""Regression tests for the pre-TestFlight versus final-release gate boundary."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "scripts" / "validate_guided_content.py"


class GuidedContentReleaseBoundaryTests(unittest.TestCase):
    def test_pending_device_candidate_cannot_be_labeled_release(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(VALIDATOR), "release"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("invalid choice: 'release'", completed.stderr)


if __name__ == "__main__":
    unittest.main()

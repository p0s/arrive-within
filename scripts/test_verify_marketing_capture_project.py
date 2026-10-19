from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("verify_marketing_capture_project.py")
SPEC = importlib.util.spec_from_file_location("marketing_project_verifier", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


class MarketingCaptureProjectTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="arrive-within-project-contract-")
        self.root = Path(self.temporary.name)
        (self.root / "project.yml").write_text(
            "name: ArriveWithin\noptions:\n  minimumXcodeGenVersion: 2.46.0\n",
            encoding="utf-8",
        )
        self.project = self.root / verifier.PROJECT_NAME
        self.scheme = Path("xcshareddata/xcschemes") / verifier.MARKETING_SCHEME
        self.calls = 0

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def fake_runner(self, command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
        if command[-1] == "--version":
            return subprocess.CompletedProcess(command, 0, "Version: 2.46.0\n")
        self.calls += 1
        output_root = Path(command[command.index("--project") + 1])
        generated = output_root / verifier.PROJECT_NAME
        (generated / self.scheme).parent.mkdir(parents=True, exist_ok=True)
        spec_digest = hashlib.sha256((cwd / "project.yml").read_bytes()).hexdigest()
        (generated / "project.pbxproj").write_text(f"generated:{spec_digest}\n", encoding="utf-8")
        (generated / self.scheme).write_text("shared capture scheme\n", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "")

    def test_stale_and_modified_generated_projects_are_rebuilt(self) -> None:
        (self.project / "xcshareddata/xcschemes").mkdir(parents=True)
        (self.project / "project.pbxproj").write_text("stale project\n", encoding="utf-8")
        (self.project / self.scheme).parent.mkdir(parents=True, exist_ok=True)
        (self.project / self.scheme).write_text("stale scheme\n", encoding="utf-8")

        stale_binding = verifier.verify_project(self.root, xcodegen_binary="fake-xcodegen", runner=self.fake_runner)
        spec_digest = hashlib.sha256((self.root / "project.yml").read_bytes()).hexdigest()
        self.assertEqual(
            (self.project / "project.pbxproj").read_text(encoding="utf-8"),
            f"generated:{spec_digest}\n",
        )
        (self.project / "project.pbxproj").write_text(f"generated:{spec_digest}\n", encoding="utf-8")
        (self.project / self.scheme).write_text("shared capture scheme\n", encoding="utf-8")
        binding = verifier.verify_project(self.root, xcodegen_binary="fake-xcodegen", runner=self.fake_runner)
        self.assertEqual(binding, stale_binding)
        self.assertEqual(binding["xcodegen_version"], "2.46.0")
        self.assertRegex(binding["project_tree_sha256"], r"^[a-f0-9]{64}$")

        (self.project / "project.pbxproj").write_text("locally modified project\n", encoding="utf-8")
        repaired = verifier.verify_project(self.root, xcodegen_binary="fake-xcodegen", runner=self.fake_runner)
        self.assertEqual(repaired, binding)
        self.assertEqual(self.calls, 3)

    def test_generator_version_must_match_the_project_pin(self) -> None:
        def wrong_version(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(command, 0, "Version: 2.47.0\n")

        with self.assertRaisesRegex(RuntimeError, "requires pinned XcodeGen 2.46.0"):
            verifier.verify_project(self.root, xcodegen_binary="fake-xcodegen", runner=wrong_version)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Regenerate and bind the ignored Xcode project from project.yml."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PINNED_XCODEGEN_VERSION = "2.46.0"
PROJECT_NAME = "ArriveWithin.xcodeproj"
MARKETING_SCHEME = "ArriveWithinMarketingCaptures.xcscheme"
VERSION_LINE = re.compile(r"(?m)^Version:\s*(\S+)\s*$")
MINIMUM_VERSION_LINE = re.compile(r"(?m)^\s*minimumXcodeGenVersion:\s*['\"]?([^\s'\"]+)['\"]?\s*$")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def project_tree_sha256(directory: Path) -> str:
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError(f"generated Xcode project is not a regular directory: {directory}")
    digest = hashlib.sha256()
    files: list[Path] = []
    for current, names, filenames in os.walk(directory, followlinks=False):
        current_path = Path(current)
        for name in names:
            child = current_path / name
            if child.is_symlink():
                raise RuntimeError(f"generated Xcode project contains a symbolic link: {child}")
        for filename in filenames:
            child = current_path / filename
            if child.is_symlink() or not child.is_file():
                raise RuntimeError(f"generated Xcode project contains a non-regular file: {child}")
            files.append(child)
    for child in sorted(files, key=lambda item: item.relative_to(directory).as_posix()):
        relative = child.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256(child.read_bytes()).encode("ascii"))
        digest.update(b"\n")
    if not files:
        raise RuntimeError("generated Xcode project is empty")
    return digest.hexdigest()


def run(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def verify_project(
    root: Path = ROOT,
    *,
    xcodegen_binary: str | None = None,
    runner=run,
) -> dict[str, str]:
    root = root.resolve(strict=True)
    spec = root / "project.yml"
    if spec.is_symlink() or not spec.is_file():
        raise RuntimeError("project.yml must be a regular source file")
    spec_bytes = spec.read_bytes()
    version_match = MINIMUM_VERSION_LINE.search(spec_bytes.decode("utf-8"))
    if not version_match or version_match.group(1) != PINNED_XCODEGEN_VERSION:
        raise RuntimeError(
            f"project.yml must pin minimumXcodeGenVersion to {PINNED_XCODEGEN_VERSION}"
        )

    executable = xcodegen_binary or shutil.which("xcodegen")
    if not executable:
        raise RuntimeError("XcodeGen is required to verify the marketing capture project")
    version_result = runner([executable, "--version"], cwd=root)
    if version_result.returncode:
        raise RuntimeError(f"cannot read XcodeGen version: {version_result.stdout[-2000:]}")
    version_match = VERSION_LINE.search(version_result.stdout)
    if not version_match or version_match.group(1) != PINNED_XCODEGEN_VERSION:
        actual = version_match.group(1) if version_match else version_result.stdout.strip()
        raise RuntimeError(
            f"marketing capture requires pinned XcodeGen {PINNED_XCODEGEN_VERSION}; found {actual}"
        )

    generated_result = runner(
        [
            executable,
            "generate",
            "--no-env",
            "--spec",
            str(spec),
            "--project-root",
            str(root),
            "--project",
            str(root),
        ],
        cwd=root,
    )
    if generated_result.returncode:
        raise RuntimeError(f"XcodeGen failed to reproduce project.yml: {generated_result.stdout[-4000:]}")
    generated_project = root / PROJECT_NAME
    scheme = generated_project / "xcshareddata" / "xcschemes" / MARKETING_SCHEME
    if not scheme.is_file() or scheme.is_symlink():
        raise RuntimeError(f"regenerated Xcode project is missing the shared marketing scheme: {scheme}")
    generated_digest = project_tree_sha256(generated_project)

    return {
        "xcodegen_version": PINNED_XCODEGEN_VERSION,
        "project_spec_sha256": sha256(spec_bytes),
        "project_tree_sha256": generated_digest,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit the verified generation binding as JSON")
    args = parser.parse_args()
    binding = verify_project()
    if args.json:
        print(json.dumps(binding, sort_keys=True))
    else:
        print(
            "Marketing capture Xcode project verified: "
            f"XcodeGen {binding['xcodegen_version']}, tree SHA-256 {binding['project_tree_sha256']}."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, UnicodeDecodeError) as error:
        print(f"marketing capture project verification: {error}", file=sys.stderr)
        raise SystemExit(1)

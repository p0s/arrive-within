#!/usr/bin/env python3
"""Build a source-bound, signed Debug app for guarded physical capture."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_INPUT_CONTRACT = Path("Marketing/AppStoreScreenshots/capture-source-inputs.json")
SOURCE_MANIFEST_PATH = Path("Marketing/AppStoreScreenshots/capture-source-manifest-v1.0.2-build-19.json")
SOURCE_MANIFEST_RELATIVE_PATH = SOURCE_MANIFEST_PATH.name
PROJECT_BINDING_FILENAME = "capture-project-binding.json"
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
TEAM = re.compile(r"^[A-Za-z0-9]{10}$")


def run(command: list[str], *, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def storage_cache_command() -> Path:
    configured = os.environ.get("DEVELOPER_STORAGE_CACHE_COMMAND")
    located = configured or shutil.which("developer-storage-cache")
    if not located:
        raise RuntimeError("developer storage cache guard is unavailable; configure its local executable path")
    command = Path(located).expanduser()
    if not command.is_file() or not os.access(command, os.X_OK):
        raise RuntimeError("configured developer storage cache guard is not executable")
    return command.resolve(strict=True)


def collect(relative: str) -> list[str]:
    base = ROOT / relative
    if base.is_symlink():
        raise RuntimeError(f"source input is a symlink: {relative}")
    if base.is_file():
        return [relative]
    if not base.is_dir():
        raise RuntimeError(f"source input is missing: {relative}")
    result: list[str] = []
    for child in sorted(base.iterdir(), key=lambda item: item.name):
        child_relative = f"{relative}/{child.name}"
        if child.is_symlink():
            raise RuntimeError(f"source input contains a symlink: {child_relative}")
        if child.is_dir():
            result.extend(collect(child_relative))
        elif child.is_file():
            result.append(child_relative)
        else:
            raise RuntimeError(f"unsupported source input: {child_relative}")
    return result


def load_source_inputs() -> list[str]:
    contract = json.loads((ROOT / SOURCE_INPUT_CONTRACT).read_text(encoding="utf-8"))
    inputs = contract.get("inputs") if isinstance(contract, dict) and contract.get("schema_version") == 1 else None
    if (
        not isinstance(inputs, list)
        or not all(isinstance(item, str) and item and not item.startswith("/") and ".." not in item.split("/") and "\\" not in item for item in inputs)
        or str(SOURCE_INPUT_CONTRACT) not in inputs
        or len(inputs) != len(set(inputs))
    ):
        raise RuntimeError("capture source input contract is invalid")
    return inputs


def current_manifest() -> tuple[str, str]:
    manifest_path = ROOT / SOURCE_MANIFEST_PATH
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    inputs = load_source_inputs()
    paths = sorted(path for entry in inputs for path in collect(entry))
    records = []
    revision = hashlib.sha256()
    for relative in paths:
        content = (ROOT / relative).read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        records.append({"path": relative, "bytes": len(content), "sha256": digest})
        revision.update(relative.encode("utf-8"))
        revision.update(b"\0")
        revision.update(digest.encode("ascii"))
        revision.update(b"\n")
    actual_revision = revision.hexdigest()
    if payload.get("inputs") != inputs or payload.get("source_revision") != actual_revision or payload.get("files") != records:
        raise RuntimeError("capture source manifest is stale; regenerate it from the current app source")
    return actual_revision, sha256_file(manifest_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.expanduser()
    if not output.is_absolute() or output.is_symlink():
        raise RuntimeError("--output must be an absolute, non-symlink path")

    status = run(["git", "status", "--porcelain", "--untracked-files=all"])
    if status.returncode or status.stdout.strip():
        raise RuntimeError("physical capture build requires a clean checkout")
    commit = run(["git", "rev-parse", "HEAD"])
    signature = run(["git", "log", "-1", "--format=%G?"])
    if commit.returncode or not COMMIT.fullmatch(commit.stdout.strip()) or signature.stdout.strip() != "G":
        raise RuntimeError("physical capture build requires a valid signed source commit")
    source_commit = commit.stdout.strip()
    project_check = run([sys.executable, str(ROOT / "scripts/verify_marketing_capture_project.py"), "--json"])
    if project_check.returncode:
        sys.stderr.write(project_check.stdout[-4000:])
        raise RuntimeError("physical capture build rejected a stale or unverified generated Xcode project")
    project_binding = json.loads(project_check.stdout)
    if (
        project_binding.get("xcodegen_version") != "2.46.0"
        or not SHA256.fullmatch(str(project_binding.get("project_spec_sha256", "")))
        or not SHA256.fullmatch(str(project_binding.get("project_tree_sha256", "")))
    ):
        raise RuntimeError("generated Xcode project verification returned an invalid source binding")
    source_revision, source_manifest_sha256 = current_manifest()
    storage_cache = storage_cache_command()

    derived = ROOT / ".build/physical-marketing-derived-data"
    derived.mkdir(parents=True, exist_ok=True)
    command = [
        str(storage_cache), "run", "--", "xcodebuild",
        "-project", str(ROOT / "ArriveWithin.xcodeproj"),
        "-scheme", "ArriveWithin",
        "-configuration", "Debug",
        "-sdk", "iphoneos",
        "-destination", "generic/platform=iOS",
        "-derivedDataPath", str(derived),
        "V2N_BUILD_SOURCE_COMMIT=" + source_commit,
        "V2N_CAPTURE_SOURCE_REVISION=" + source_revision,
        "CODE_SIGNING_ALLOWED=YES",
        "build",
    ]
    build = run(command)
    if build.returncode:
        sys.stderr.write(build.stdout[-6000:])
        raise RuntimeError(f"signed Debug app build failed with exit {build.returncode}")

    app = derived / "Build/Products/Debug-iphoneos/Arrive Within.app"
    info_path = app / "Info.plist"
    if not app.is_dir() or app.is_symlink() or not info_path.is_file() or info_path.is_symlink():
        raise RuntimeError("xcodebuild did not produce the expected app bundle")
    with info_path.open("rb") as handle:
        info = plistlib.load(handle)
    expected = {
        "CFBundleIdentifier": "com.philipps.arrivewithin.ios",
        "CFBundleShortVersionString": "1.0.2",
        "CFBundleVersion": "19",
        "V2N_BUILD_SOURCE_COMMIT": source_commit,
        "V2N_CAPTURE_SOURCE_REVISION": source_revision,
    }
    if any(info.get(key) != value for key, value in expected.items()):
        raise RuntimeError("built app Info.plist does not contain the exact source-bound identity")
    executable_name = info.get("CFBundleExecutable")
    if not isinstance(executable_name, str) or "/" in executable_name:
        raise RuntimeError("built app executable name is invalid")
    executable = app / executable_name
    if not executable.is_file() or executable.is_symlink():
        raise RuntimeError("built app executable is missing")
    signature_check = run(["codesign", "--verify", "--deep", "--strict", str(app)])
    signature_details = run(["codesign", "-dv", "--verbose=4", str(app)])
    identity_text = signature_details.stdout
    team_id = next(
        (line.partition("=")[2] for line in identity_text.splitlines() if line.startswith("TeamIdentifier=")),
        "",
    )
    if signature_check.returncode or not TEAM.fullmatch(team_id):
        raise RuntimeError("built app is not validly signed by a development team")
    receipt = {
        "schema_version": 1,
        "app_bundle_path": str(app),
        "bundle_id": expected["CFBundleIdentifier"],
        "marketing_version": expected["CFBundleShortVersionString"],
        "build_number": expected["CFBundleVersion"],
        "source_commit": source_commit,
        "source_dirty": False,
        "executable_sha256": sha256_file(executable),
        "team_id": team_id,
        "source_provenance": {
            "plist": "Info.plist",
            "key": "V2N_BUILD_SOURCE_COMMIT",
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt_bytes = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8")
    output.write_bytes(receipt_bytes)
    output.chmod(0o600)
    project_binding_path = output.with_name(PROJECT_BINDING_FILENAME)
    project_binding_payload = {
        "schema_version": 1,
        "source_commit": source_commit,
        "source_revision": source_revision,
        "source_manifest_path": SOURCE_MANIFEST_RELATIVE_PATH,
        "source_manifest_sha256": source_manifest_sha256,
        "build_receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest(),
        "generated_project": project_binding,
    }
    project_binding_bytes = (json.dumps(project_binding_payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    project_binding_path.write_bytes(project_binding_bytes)
    project_binding_path.chmod(0o600)
    print(json.dumps({
        "schema_version": 1,
        "receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest(),
        "binding_path": str(project_binding_path),
        "binding_sha256": hashlib.sha256(project_binding_bytes).hexdigest(),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"physical build adapter: {error}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Run Chatterbox generation under one lifecycle-owned host memory guard."""

from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "ContentProduction" / "chatterbox-audition"
GENERATOR = PROJECT / "generate_production_candidates.py"
UV_CACHE = ROOT / ".build" / "uv-cache"
GIB = 1024**3
MINIMUM_HEADROOM_BYTES = 10 * GIB
HEADROOM_FRACTION = 0.25
DEFAULT_KILL_BUFFER_BYTES = 1 * GIB
LOCK_NAME = "codex-accelerator-mps.lock"
GUARD_ENVIRONMENT_KEY = "ARRIVE_WITHIN_NARRATION_MEMORY_GUARD"
INTEGRITY_ATTESTATION_ENVIRONMENT_KEY = "ARRIVE_WITHIN_NARRATION_INTEGRITY_ATTESTATION"
CHECKPOINT_CONTINUATION_EXIT_CODE = 75
PRIVATE_CANDIDATES = ROOT / "ContentProduction" / "production-candidates" / "chatterbox-production-candidates-v2"
NARRATION_PLAN = ROOT / "ContentProduction" / "narration-production-plan.json"
MODEL_CACHE = ROOT / "ContentProduction" / "model-cache" / "huggingface"
MODEL_PATTERNS = {
    "en": (
        "ve.safetensors",
        "t3_cfg.safetensors",
        "s3gen.safetensors",
        "tokenizer.json",
        "conds.pt",
    ),
    "de": (
        "ve.pt",
        "t3_mtl23ls_v3.safetensors",
        "s3gen.pt",
        "conds.pt",
    ),
}


@dataclass(frozen=True)
class MemorySample:
    total_bytes: int
    free_percent: int

    @property
    def available_bytes(self) -> int:
        return self.total_bytes * self.free_percent // 100


@dataclass
class ChildMeasurement:
    language: str
    exit_code: int
    required_start_available_bytes: int
    before_available_bytes: int
    minimum_available_bytes: int
    after_available_bytes: int
    peak_process_group_rss_bytes: int
    guard_floor_bytes: int
    kill_trigger_bytes: int
    guard_terminated: bool
    probe_first_unit: bool
    probe_unit_count: int
    probe_result: dict[str, Any] | None
    checkpoint_count_before: int
    checkpoint_count_after: int
    checkpoint_existing_unchanged: bool
    checkpoint_new_count: int
    checkpoint_removed_count: int
    checkpoint_finalized_tracks: list[str]
    checkpoint_transition_valid: bool


@dataclass(frozen=True)
class HeadroomFailure:
    language: str | None
    phase: str
    required_available_bytes: int
    observed_available_bytes: int
    total_bytes: int
    free_percent: int
    wait_seconds: float


@dataclass(frozen=True)
class CachedCheckpointFingerprint:
    metadata_signature: tuple[int, int, int, int, int]
    pcm_signature: tuple[int, int, int, int, int]
    value: str


CHECKPOINT_FINGERPRINT_CACHE: dict[str, CachedCheckpointFingerprint] = {}


class HeadroomTimeout(RuntimeError):
    def __init__(self, failure: HeadroomFailure) -> None:
        self.failure = failure
        super().__init__(
            "Host memory did not recover to "
            f"{failure.required_available_bytes / GIB:.1f} GiB headroom"
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def integrity_signature(path: Path, *, allow_symlink: bool = False) -> list[int]:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"Integrity-attested file is missing: {path.name}") from error
    if stat.S_ISLNK(metadata.st_mode):
        if not allow_symlink:
            raise RuntimeError(f"Integrity-attested file must not be a symlink: {path.name}")
    elif not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"Integrity-attested path must be a regular file: {path.name}")
    return [
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    ]


def attest_regular_file(path: Path, expected_sha256: str | None = None) -> dict[str, Any]:
    path = path.resolve(strict=True)
    signature = integrity_signature(path)
    actual_sha256 = sha256_file(path)
    if expected_sha256 is not None and actual_sha256 != expected_sha256:
        raise RuntimeError(f"Integrity-attested hash mismatch: {path.name}")
    return {
        "path": str(path),
        "signature": signature,
        "sha256": actual_sha256,
    }


def integrity_entry_is_unchanged(entry: dict[str, Any]) -> bool:
    path = Path(entry.get("path", ""))
    expected = entry.get("signature")
    if not path.is_absolute() or not isinstance(expected, list):
        return False
    try:
        return integrity_signature(path) == expected
    except RuntimeError:
        return False


def require_unchanged_integrity_entry(entry: dict[str, Any]) -> None:
    if not integrity_entry_is_unchanged(entry):
        raise RuntimeError("Integrity-attested file changed during narration generation")


def model_snapshot_root(plan: dict[str, Any]) -> Path:
    repository = plan.get("model", {}).get("repository")
    revision = plan.get("model", {}).get("revision")
    if (
        not isinstance(repository, str)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
        or not isinstance(revision, str)
        or not re.fullmatch(r"[0-9a-f]{40}", revision)
    ):
        raise RuntimeError("Narration plan has an unsafe pinned model coordinate")
    encoded_repository = "models--" + repository.replace("/", "--")
    return MODEL_CACHE / encoded_repository / "snapshots" / revision


def attest_model_files(
    plan: dict[str, Any], languages: Sequence[str]
) -> dict[str, dict[str, Any]]:
    snapshot_root = model_snapshot_root(plan)
    model_root = snapshot_root.parents[1].resolve(strict=True)
    expected_hashes = plan.get("modelFileSHA256", {})
    names = sorted({name for language in languages for name in MODEL_PATTERNS[language]})
    records: dict[str, dict[str, Any]] = {}
    for name in names:
        snapshot_path = snapshot_root / name
        snapshot_signature = integrity_signature(snapshot_path, allow_symlink=True)
        target_path = snapshot_path.resolve(strict=True)
        try:
            target_path.relative_to(model_root)
        except ValueError as error:
            raise RuntimeError("Pinned model file escaped its model cache") from error
        expected = expected_hashes.get(name)
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise RuntimeError(f"Narration plan lacks a valid model hash: {name}")
        record = attest_regular_file(target_path, expected)
        records[name] = {
            **record,
            "snapshotPath": str(snapshot_path),
            "snapshotSignature": snapshot_signature,
        }
    return records


def require_unchanged_model_entry(entry: dict[str, Any]) -> None:
    snapshot_path = Path(entry.get("snapshotPath", ""))
    if (
        not snapshot_path.is_absolute()
        or integrity_signature(snapshot_path, allow_symlink=True)
        != entry.get("snapshotSignature")
    ):
        raise RuntimeError("Pinned model snapshot changed during narration generation")
    require_unchanged_integrity_entry(entry)


def attest_candidate_track(track_root: Path) -> dict[str, Any]:
    manifest_path = track_root / "manifest.json"
    manifest_entry = attest_regular_file(manifest_path)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError("Completed narration candidate manifest is invalid") from error
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise RuntimeError("Completed narration candidate has no file manifest")
    file_entries: dict[str, dict[str, Any]] = {}
    resolved_root = track_root.resolve(strict=True)
    for role, record in files.items():
        if not isinstance(role, str) or not isinstance(record, dict):
            raise RuntimeError("Completed narration candidate file record is invalid")
        name = record.get("name")
        expected = record.get("sha256")
        if (
            not isinstance(name, str)
            or Path(name).name != name
            or not isinstance(expected, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected)
        ):
            raise RuntimeError("Completed narration candidate file identity is unsafe")
        path = track_root / name
        if path.parent.resolve() != resolved_root:
            raise RuntimeError("Completed narration candidate file escaped its track")
        file_entries[role] = attest_regular_file(path, expected)
    return {
        "trackRoot": str(track_root),
        "manifest": manifest_entry,
        "files": file_entries,
    }


def require_unchanged_candidate_track(entry: dict[str, Any]) -> None:
    require_unchanged_integrity_entry(entry.get("manifest", {}))
    files = entry.get("files")
    if not isinstance(files, dict) or not files:
        raise RuntimeError("Narration candidate attestation is invalid")
    for file_entry in files.values():
        require_unchanged_integrity_entry(file_entry)


def refresh_candidate_attestations(state: dict[str, Any]) -> None:
    tracks = state.setdefault("candidateTracks", {})
    if not isinstance(tracks, dict):
        raise RuntimeError("Narration candidate attestation state is invalid")
    for entry in tracks.values():
        require_unchanged_candidate_track(entry)
    if not PRIVATE_CANDIDATES.exists():
        return
    for identifier_root in sorted(PRIVATE_CANDIDATES.iterdir()):
        if not re.fullmatch(r"G(?:0[1-9]|[1-3][0-9]|4[0-2])", identifier_root.name):
            continue
        if identifier_root.is_symlink() or not identifier_root.is_dir():
            raise RuntimeError("Narration candidate identifier path is unsafe")
        for language_root in sorted(identifier_root.iterdir()):
            if language_root.name not in {"en", "de"}:
                continue
            key = f"{identifier_root.name}/{language_root.name}"
            if key not in tracks and (language_root / "manifest.json").is_file():
                tracks[key] = attest_candidate_track(language_root)


def create_integrity_attestation(languages: Sequence[str]) -> dict[str, Any]:
    plan_entry = attest_regular_file(NARRATION_PLAN)
    plan = json.loads(NARRATION_PLAN.read_text(encoding="utf-8"))
    state: dict[str, Any] = {
        "schemaVersion": 1,
        "guardPID": os.getpid(),
        "plan": plan_entry,
        "generator": attest_regular_file(GENERATOR),
        "modelFiles": attest_model_files(plan, languages),
        "candidateTracks": {},
    }
    refresh_candidate_attestations(state)
    return state


def refresh_integrity_attestation(state: dict[str, Any]) -> None:
    if state.get("guardPID") != os.getpid():
        raise RuntimeError("Narration integrity attestation has the wrong owner")
    require_unchanged_integrity_entry(state.get("plan", {}))
    require_unchanged_integrity_entry(state.get("generator", {}))
    model_files = state.get("modelFiles")
    if not isinstance(model_files, dict) or not model_files:
        raise RuntimeError("Narration model attestation is invalid")
    for entry in model_files.values():
        require_unchanged_model_entry(entry)
    refresh_candidate_attestations(state)


def write_integrity_attestation(path: Path, state: dict[str, Any]) -> None:
    temporary = path.parent / f".{path.name}.tmp"
    temporary.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.chmod(0o600)
    os.replace(temporary, path)
    path.chmod(0o600)


def parse_memory_pressure(output: str) -> MemorySample:
    total_match = re.search(r"system has\s+(\d+)\s+\(", output)
    percent_match = re.search(r"free percentage:\s*(\d+)%", output)
    if total_match is None or percent_match is None:
        raise RuntimeError("Unable to parse memory_pressure output")
    total_bytes = int(total_match.group(1))
    free_percent = int(percent_match.group(1))
    if total_bytes <= 0 or not 0 <= free_percent <= 100:
        raise RuntimeError("memory_pressure returned invalid host values")
    return MemorySample(total_bytes=total_bytes, free_percent=free_percent)


def sample_host_memory() -> MemorySample:
    completed = subprocess.run(
        ["/usr/bin/memory_pressure", "-Q"],
        check=True,
        capture_output=True,
        text=True,
    )
    return parse_memory_pressure(completed.stdout)


def minimum_headroom(total_bytes: int) -> int:
    return max(MINIMUM_HEADROOM_BYTES, int(total_bytes * HEADROOM_FRACTION))


def required_start_headroom(kill_trigger_bytes: int, requested_gib: float) -> int:
    """Require any optional conservative preflight without lowering the stop line."""
    return max(kill_trigger_bytes, int(requested_gib * GIB))


def process_group_rss_bytes(process_group_id: int) -> int:
    """Return the current resident bytes of the exact owned process group."""
    completed = subprocess.run(
        ["/bin/ps", "-o", "rss=", "-g", str(process_group_id)],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode not in (0, 1):
        raise RuntimeError("Unable to sample the owned narration process group")
    values = [int(value) for value in completed.stdout.split() if value.isdigit()]
    return sum(values) * 1024


def checkpoint_pcm_sha256(path: Path, expected_sample_count: int) -> str:
    """Validate a one-dimensional float32 NPY and hash its exact PCM payload."""
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Narration checkpoint PCM must be a regular file")
    with path.open("rb") as handle:
        if handle.read(6) != b"\x93NUMPY":
            raise RuntimeError("Narration checkpoint PCM has an invalid NPY signature")
        version = handle.read(2)
        if version == b"\x01\x00":
            header_length_bytes = handle.read(2)
            header_length = struct.unpack("<H", header_length_bytes)[0]
        elif version in (b"\x02\x00", b"\x03\x00"):
            header_length_bytes = handle.read(4)
            header_length = struct.unpack("<I", header_length_bytes)[0]
        else:
            raise RuntimeError("Narration checkpoint PCM uses an unsupported NPY version")
        try:
            header = ast.literal_eval(handle.read(header_length).decode("latin1"))
        except (SyntaxError, UnicodeDecodeError, ValueError) as error:
            raise RuntimeError("Narration checkpoint PCM has an invalid NPY header") from error
        if (
            header.get("descr") not in ("<f4", "=f4", "|f4")
            or header.get("fortran_order") is not False
            or header.get("shape") != (expected_sample_count,)
        ):
            raise RuntimeError("Narration checkpoint PCM shape or dtype is invalid")
        payload = handle.read()
    if len(payload) != expected_sample_count * 4:
        raise RuntimeError("Narration checkpoint PCM byte length is invalid")
    return hashlib.sha256(payload).hexdigest()


def regular_file_signature(path: Path, role: str) -> tuple[int, int, int, int, int]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"Narration checkpoint {role} must be a regular file")
    # The production wrapper deliberately uses macOS /usr/bin/python3.  Path.stat's
    # follow_symlinks keyword is unavailable there, while lstat has the exact
    # no-follow behavior needed after the explicit symlink rejection above.
    stat = path.lstat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


def checkpoint_fingerprint(unit_root: Path, ordinal: int) -> str:
    metadata_path = unit_root / "metadata.json"
    pcm_path = unit_root / "pcm.npy"
    metadata_signature = regular_file_signature(metadata_path, "metadata")
    pcm_signature = regular_file_signature(pcm_path, "PCM")
    cache_key = str(unit_root.resolve(strict=True))
    cached = CHECKPOINT_FINGERPRINT_CACHE.get(cache_key)
    if (
        cached is not None
        and cached.metadata_signature == metadata_signature
        and cached.pcm_signature == pcm_signature
    ):
        return cached.value
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    sample_count = metadata.get("sampleCount")
    if (
        metadata.get("generationOrdinal") != ordinal
        or not isinstance(sample_count, int)
        or sample_count <= 0
    ):
        raise RuntimeError("Narration checkpoint metadata is invalid")
    pcm_hash = checkpoint_pcm_sha256(pcm_path, sample_count)
    if pcm_hash != metadata.get("pcmFloat32SHA256"):
        raise RuntimeError("Narration checkpoint PCM hash mismatch")
    metadata_hash = hashlib.sha256(metadata_path.read_bytes()).hexdigest()
    value = f"{metadata_hash}:{pcm_hash}"
    CHECKPOINT_FINGERPRINT_CACHE[cache_key] = CachedCheckpointFingerprint(
        metadata_signature=metadata_signature,
        pcm_signature=pcm_signature,
        value=value,
    )
    return value


def checkpoint_inventory(arguments: argparse.Namespace, language: str) -> dict[str, str]:
    identifiers = tuple(f"G{index:02d}" for index in range(1, 43)) if arguments.all else tuple(arguments.practice or ())
    inventory: dict[str, str] = {}
    for identifier in identifiers:
        root = PRIVATE_CANDIDATES / ".unit-cache" / identifier / language
        if root.is_symlink():
            raise RuntimeError("Narration checkpoint root must not be a symlink")
        if root.exists() and not root.is_dir():
            raise RuntimeError("Narration checkpoint root must be a directory")
        if not root.is_dir():
            continue
        unit_roots = sorted(
            path
            for path in root.iterdir()
            if re.fullmatch(r"unit-\d{4}", path.name)
        )
        for expected_ordinal, unit_root in enumerate(unit_roots):
            if unit_root.is_symlink() or not unit_root.is_dir():
                raise RuntimeError("Narration checkpoint unit must be a directory")
            ordinal = int(unit_root.name.removeprefix("unit-"))
            if ordinal != expected_ordinal:
                raise RuntimeError("Narration checkpoints must form a contiguous prefix")
            key = f"{identifier}/{language}/{unit_root.name}"
            inventory[key] = checkpoint_fingerprint(unit_root, ordinal)
    return inventory


def completed_candidate_inventory(
    arguments: argparse.Namespace, language: str
) -> set[str]:
    identifiers = (
        tuple(f"G{index:02d}" for index in range(1, 43))
        if arguments.all
        else tuple(arguments.practice or ())
    )
    completed: set[str] = set()
    for identifier in identifiers:
        track_root = PRIVATE_CANDIDATES / identifier / language
        manifest = track_root / "manifest.json"
        if track_root.is_symlink() or manifest.is_symlink():
            raise RuntimeError("Narration candidate path must not be a symlink")
        if manifest.is_file():
            completed.add(f"{identifier}/{language}")
    return completed


def checkpoint_transition(
    before: dict[str, str],
    after: dict[str, str],
    completed_before: set[str],
    completed_after: set[str],
) -> tuple[bool, int, int, list[str]]:
    common_unchanged = all(after.get(key) == value for key, value in before.items() if key in after)
    added = set(after) - set(before)
    removed = set(before) - set(after)
    finalized = completed_after - completed_before
    removal_tracks = {key.rsplit("/", 1)[0] for key in removed}
    valid = (
        common_unchanged
        and completed_before <= completed_after
        and removal_tracks <= finalized
    )
    return valid, len(added), len(removed), sorted(finalized)


def generation_command(
    arguments: argparse.Namespace,
    language: str,
    probe_report: Path | None = None,
) -> list[str]:
    python = PROJECT / ".venv" / "bin" / "python"
    command = [
        str(python),
        str(GENERATOR),
        "--language",
        language,
        "--device",
        arguments.device,
    ]
    if arguments.all:
        command.append("--all")
    else:
        for practice in arguments.practice:
            command.extend(["--practice", practice])
    if arguments.resume:
        command.append("--resume")
    if arguments.one_new_unit_per_child:
        command.append("--one-new-unit-per-child")
        command.extend(["--new-units-per-child", str(arguments.new_units_per_child)])
    if arguments.probe_first_unit:
        command.append("--probe-first-unit")
        command.extend(["--probe-unit-count", str(arguments.probe_unit_count)])
        if probe_report is not None:
            command.extend(["--probe-report", str(probe_report)])
    if arguments.seed_offset:
        command.extend(["--seed-offset", str(arguments.seed_offset)])
    return command


def wait_for_headroom(
    required_bytes: int,
    timeout_seconds: float,
    poll_seconds: float,
    consecutive_samples: int,
    *,
    phase: str,
    language: str | None,
) -> MemorySample:
    deadline = time.monotonic() + timeout_seconds
    passing = 0
    latest = sample_host_memory()
    while True:
        if latest.available_bytes >= required_bytes:
            passing += 1
            if passing >= consecutive_samples:
                return latest
        else:
            passing = 0
        if time.monotonic() >= deadline:
            raise HeadroomTimeout(
                HeadroomFailure(
                    language=language,
                    phase=phase,
                    required_available_bytes=required_bytes,
                    observed_available_bytes=latest.available_bytes,
                    total_bytes=latest.total_bytes,
                    free_percent=latest.free_percent,
                    wait_seconds=timeout_seconds,
                )
            )
        time.sleep(poll_seconds)
        latest = sample_host_memory()


def terminate_owned_group(child: subprocess.Popen[bytes], grace_seconds: float) -> None:
    if child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=grace_seconds)


def run_child(arguments: argparse.Namespace, language: str) -> ChildMeasurement:
    if not (PROJECT / ".venv" / "bin" / "python").is_file():
        raise RuntimeError("Pinned narration environment is missing its Python executable")
    initial = sample_host_memory()
    floor = minimum_headroom(initial.total_bytes)
    kill_trigger = floor + arguments.kill_buffer_gib * GIB
    required_start = required_start_headroom(
        int(kill_trigger), arguments.start_headroom_gib
    )
    before = wait_for_headroom(
        required_start,
        arguments.wait_seconds,
        arguments.poll_seconds,
        consecutive_samples=2,
        phase="preflight",
        language=language,
    )
    environment = os.environ.copy()
    environment[GUARD_ENVIRONMENT_KEY] = "1"
    attestation_path = getattr(arguments, "integrity_attestation_path", None)
    if attestation_path is not None:
        environment[INTEGRITY_ATTESTATION_ENVIRONMENT_KEY] = str(attestation_path)
    probe_report = None
    if arguments.probe_first_unit:
        probe_report = ROOT / ".evidence" / "audio" / (
            f".narration-probe-{os.getpid()}-{language}-{arguments.probe_unit_count}.json"
        )
        probe_report.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        probe_report.unlink(missing_ok=True)
    checkpoints_before = checkpoint_inventory(arguments, language)
    completed_before = completed_candidate_inventory(arguments, language)
    child = subprocess.Popen(
        generation_command(arguments, language, probe_report),
        cwd=ROOT,
        env=environment,
        start_new_session=True,
    )
    minimum_available = before.available_bytes
    peak_rss = 0
    guard_terminated = False
    try:
        while child.poll() is None:
            peak_rss = max(peak_rss, process_group_rss_bytes(child.pid))
            sample = sample_host_memory()
            minimum_available = min(minimum_available, sample.available_bytes)
            if sample.available_bytes < kill_trigger:
                guard_terminated = True
                terminate_owned_group(child, arguments.grace_seconds)
                break
            time.sleep(arguments.poll_seconds)
    except BaseException:
        terminate_owned_group(child, arguments.grace_seconds)
        raise
    exit_code = child.wait()
    after = wait_for_headroom(
        floor,
        arguments.wait_seconds,
        arguments.poll_seconds,
        consecutive_samples=3,
        phase="post-child-recovery",
        language=language,
    )
    probe_result = None
    if probe_report is not None:
        try:
            if exit_code == 0:
                probe_result = json.loads(probe_report.read_text(encoding="utf-8"))
        finally:
            probe_report.unlink(missing_ok=True)
    checkpoints_after = checkpoint_inventory(arguments, language)
    completed_after = completed_candidate_inventory(arguments, language)
    transition_valid, new_count, removed_count, finalized_tracks = checkpoint_transition(
        checkpoints_before,
        checkpoints_after,
        completed_before,
        completed_after,
    )
    return ChildMeasurement(
        language=language,
        exit_code=exit_code,
        required_start_available_bytes=required_start,
        before_available_bytes=before.available_bytes,
        minimum_available_bytes=minimum_available,
        after_available_bytes=after.available_bytes,
        peak_process_group_rss_bytes=peak_rss,
        guard_floor_bytes=floor,
        kill_trigger_bytes=int(kill_trigger),
        guard_terminated=guard_terminated,
        probe_first_unit=arguments.probe_first_unit,
        probe_unit_count=arguments.probe_unit_count,
        probe_result=probe_result,
        checkpoint_count_before=len(checkpoints_before),
        checkpoint_count_after=len(checkpoints_after),
        checkpoint_existing_unchanged=all(
            checkpoints_after.get(key) == value
            for key, value in checkpoints_before.items()
            if key in checkpoints_after
        ),
        checkpoint_new_count=new_count,
        checkpoint_removed_count=removed_count,
        checkpoint_finalized_tracks=finalized_tracks,
        checkpoint_transition_valid=transition_valid,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", action="append", choices=("en", "de"), required=True)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--practice", action="append", choices=tuple(f"G{i:02d}" for i in range(1, 43)))
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="mps")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--one-new-unit-per-child",
        action="store_true",
        help=(
            "Require the owned worker to exit after one new atomic checkpoint, "
            "then relaunch only after verified progress and headroom recovery."
        ),
    )
    parser.add_argument(
        "--checkpoint-retries",
        type=int,
        default=0,
        help="Relaunch only when a guarded stop created new validated unit checkpoints.",
    )
    parser.add_argument(
        "--checkpoint-continuations",
        type=int,
        default=0,
        help=(
            "Maximum successful one-unit child continuations per language; "
            "separate from memory-stop retries."
        ),
    )
    parser.add_argument(
        "--new-units-per-child",
        type=int,
        choices=(1, 2),
        default=1,
        help="Bound each checkpoint continuation child to one or two new units.",
    )
    parser.add_argument("--probe-first-unit", action="store_true")
    parser.add_argument("--probe-unit-count", type=int, choices=(1, 2, 4), default=1)
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--wait-seconds", type=float, default=300.0)
    parser.add_argument("--grace-seconds", type=float, default=20.0)
    parser.add_argument("--kill-buffer-gib", type=float, default=1.0)
    parser.add_argument(
        "--start-headroom-gib",
        type=float,
        default=0.0,
        help="Optional conservative headroom required before starting the owned worker.",
    )
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args(argv)
    if arguments.probe_first_unit and (arguments.all or len(arguments.practice or []) != 1):
        parser.error("--probe-first-unit requires exactly one --practice")
    if arguments.probe_first_unit and arguments.one_new_unit_per_child:
        parser.error("--one-new-unit-per-child cannot be combined with a probe")
    if not arguments.probe_first_unit and arguments.probe_unit_count != 1:
        parser.error("--probe-unit-count requires --probe-first-unit")
    if arguments.poll_seconds < 0.25 or arguments.kill_buffer_gib < 0.5:
        parser.error("guard polling must be >= 0.25s and kill buffer >= 0.5 GiB")
    if arguments.start_headroom_gib < 0:
        parser.error("--start-headroom-gib must be non-negative")
    if not 0 <= arguments.checkpoint_retries <= 100:
        parser.error("--checkpoint-retries must be between 0 and 100")
    if not 0 <= arguments.checkpoint_continuations <= 10_000:
        parser.error("--checkpoint-continuations must be between 0 and 10000")
    if arguments.one_new_unit_per_child and arguments.checkpoint_continuations == 0:
        parser.error(
            "--one-new-unit-per-child requires positive --checkpoint-continuations"
        )
    if not arguments.one_new_unit_per_child and arguments.checkpoint_continuations:
        parser.error(
            "--checkpoint-continuations requires --one-new-unit-per-child"
        )
    if not arguments.one_new_unit_per_child and arguments.new_units_per_child != 1:
        parser.error("--new-units-per-child requires --one-new-unit-per-child")
    if len(set(arguments.language)) != len(arguments.language):
        parser.error("each language may be requested only once")
    if not 0 <= arguments.seed_offset < 1000:
        parser.error("--seed-offset must be between 0 and 999")
    if arguments.seed_offset and (arguments.all or len(arguments.practice or []) != 1):
        parser.error("--seed-offset requires exactly one --practice")
    return arguments


def write_report(
    path: Path,
    measurements: list[ChildMeasurement],
    headroom_failures: Sequence[HeadroomFailure] = (),
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "guard": "single-lifecycle-owned-worker-host-wide-reservation",
        "measurements": [asdict(item) for item in measurements],
        "headroomFailures": [asdict(item) for item in headroom_failures],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_args(argv)
    lock_path = Path(tempfile.gettempdir()) / LOCK_NAME
    measurements: list[ChildMeasurement] = []
    attestation_path: Path | None = None
    caught_error: BaseException | None = None
    try:
        with lock_path.open("a+", encoding="utf-8") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError("Host MPS accelerator capacity is already reserved") from error
            lock.seek(0)
            lock.truncate()
            lock.write(f"{os.getpid()}\n")
            lock.flush()
            integrity_state: dict[str, Any] | None = None
            if arguments.device == "mps" and not arguments.probe_first_unit:
                attestation_path = ROOT / ".evidence" / "audio" / (
                    f".narration-integrity-attestation-{os.getpid()}.json"
                )
                attestation_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                attestation_path.unlink(missing_ok=True)
                integrity_state = create_integrity_attestation(arguments.language)
                write_integrity_attestation(attestation_path, integrity_state)
                arguments.integrity_attestation_path = attestation_path
            for language in arguments.language:
                retries_remaining = arguments.checkpoint_retries
                continuations_remaining = arguments.checkpoint_continuations
                while True:
                    measurement = run_child(arguments, language)
                    measurements.append(measurement)
                    if integrity_state is not None and attestation_path is not None:
                        refresh_integrity_attestation(integrity_state)
                        write_integrity_attestation(attestation_path, integrity_state)
                    progressed = (
                        measurement.checkpoint_transition_valid
                        and measurement.checkpoint_new_count > 0
                    )
                    if measurement.exit_code == CHECKPOINT_CONTINUATION_EXIT_CODE:
                        bounded_progress = (
                            progressed
                            and measurement.checkpoint_new_count
                            <= arguments.new_units_per_child
                        )
                        if measurement.guard_terminated or not bounded_progress:
                            raise RuntimeError(
                                "Checkpoint continuation exited without bounded new "
                                "validated unit checkpoints"
                            )
                        if not arguments.one_new_unit_per_child:
                            raise RuntimeError(
                                "Unexpected checkpoint continuation status from worker"
                            )
                        if arguments.report:
                            write_report(arguments.report, measurements)
                        if continuations_remaining <= 0:
                            raise RuntimeError(
                                "Checkpoint continuation exhausted its bounded relaunches"
                            )
                        continuations_remaining -= 1
                        print(
                            f"guarded {language}: retained "
                            f"{measurement.checkpoint_new_count} new unit checkpoints; "
                            "waiting to relaunch a fresh owned child",
                            flush=True,
                        )
                        continue
                    if measurement.guard_terminated:
                        if arguments.report:
                            write_report(arguments.report, measurements)
                        if progressed and retries_remaining > 0:
                            retries_remaining -= 1
                            print(
                                f"guarded {language}: retained "
                                f"{measurement.checkpoint_new_count} "
                                "new unit checkpoints; waiting to resume",
                                flush=True,
                            )
                            continue
                        reason = (
                            "without new checkpoint progress"
                            if not progressed
                            else "after exhausting checkpoint retries"
                        )
                        raise RuntimeError(
                            f"Memory guard stopped {language} {reason}"
                        )
                    if measurement.exit_code != 0:
                        if arguments.report:
                            write_report(arguments.report, measurements)
                        return measurement.exit_code
                    break
            final_sample = sample_host_memory()
            final_floor = minimum_headroom(final_sample.total_bytes)
            wait_for_headroom(
                final_floor,
                arguments.wait_seconds,
                arguments.poll_seconds,
                consecutive_samples=3,
                phase="final-recovery",
                language=None,
            )
            if arguments.report:
                write_report(arguments.report, measurements)
    except HeadroomTimeout as error:
        if arguments.report:
            write_report(arguments.report, measurements, [error.failure])
        caught_error = error
        raise
    except BaseException as error:
        caught_error = error
        raise
    finally:
        if attestation_path is not None:
            try:
                attestation_path.unlink(missing_ok=True)
            except OSError:
                if caught_error is None:
                    raise
    for item in measurements:
        print(
            f"guarded {item.language}: exit={item.exit_code} "
            f"peak_group_rss={item.peak_process_group_rss_bytes / GIB:.2f}GiB "
            f"min_headroom={item.minimum_available_bytes / GIB:.2f}GiB "
            f"after={item.after_available_bytes / GIB:.2f}GiB",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)

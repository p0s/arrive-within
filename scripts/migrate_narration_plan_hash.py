#!/usr/bin/env python3
"""Safely migrate unchanged narration metadata to the current plan hash.

The cadence contract became language-specific after the English candidates were
generated.  This tool changes manifest/run metadata only when it can prove that
the English audio itself already satisfies the current no-synthetic-silence
contract.  It never re-encodes, rewrites, or replaces an audio file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


EXPECTED_IDS = tuple(f"G{index:02d}" for index in range(1, 43))
EXPECTED_LANGUAGE = "en"
RATIONALE = "German language-specific cadence ceiling added; English audio contract unchanged"
INTERNAL_SILENCE_MAXIMUM_SECONDS = 0.45


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return document


def write_json_atomic(path: Path, document: dict[str, Any]) -> None:
    """Replace one private JSON file without exposing a partial document."""

    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Refusing to write an unsafe JSON path: {path}")
    mode = path.stat().st_mode & 0o777
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        temporary.write(json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True))
        temporary.write("\n")
    temporary_path.chmod(mode)
    os.replace(temporary_path, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--run-manifest", type=Path, required=True)
    parser.add_argument("--language", default=EXPECTED_LANGUAGE, choices=[EXPECTED_LANGUAGE])
    return parser.parse_args()


def migration_record(previous_hash: str, current_hash: str) -> dict[str, Any]:
    return {
        "audioReencoded": False,
        "currentPlanSHA256": current_hash,
        "previousPlanSHA256": previous_hash,
        "rationale": RATIONALE,
    }


def validate_file_records(track_root: Path, manifest: dict[str, Any]) -> None:
    files = manifest.get("files")
    expected_names = {
        "raw": "assembled.float.wav",
        "master": "master.wav",
        "delivery": "delivery.m4a",
        "transcript": "transcript.vtt",
    }
    if not isinstance(files, dict) or set(files) != set(expected_names):
        raise ValueError(f"{track_root}: unexpected candidate file set")
    for role, expected_name in expected_names.items():
        record = files[role]
        if not isinstance(record, dict) or record.get("name") != expected_name:
            raise ValueError(f"{track_root}: unexpected {role} filename")
        path = track_root / expected_name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"{track_root}: unsafe or missing {role} file")
        if path.stat().st_size != record.get("bytes") or sha256(path) != record.get("sha256"):
            raise ValueError(f"{track_root}: {role} hash or size mismatch")


def validate_track(
    track_root: Path,
    identifier: str,
    current_plan: dict[str, Any],
    current_plan_hash: str,
    catalog_hash: str,
    previous_hashes: set[str],
) -> tuple[dict[str, Any], str]:
    manifest_path = track_root / "manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("contentID") != identifier or manifest.get("language") != EXPECTED_LANGUAGE:
        raise ValueError(f"{identifier}: manifest identity mismatch")
    if manifest.get("productionVersion") != current_plan.get("productionVersion"):
        raise ValueError(f"{identifier}: production version mismatch")
    previous_hash = manifest.get("planSHA256")
    if not isinstance(previous_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", previous_hash):
        raise ValueError(f"{identifier}: invalid previous plan hash")
    previous_hashes.add(previous_hash)
    if previous_hash == current_plan_hash:
        record = manifest.get("planHashMigration")
        if not isinstance(record, dict) or record.get("currentPlanSHA256") != current_plan_hash:
            raise ValueError(f"{identifier}: current plan hash lacks migration provenance")
        return manifest, previous_hash
    assembly = manifest.get("assembly", {})
    if (
        assembly.get("syntheticIntraSentenceSilence") is not False
        or assembly.get("internalSilenceMaximumSeconds") != INTERNAL_SILENCE_MAXIMUM_SECONDS
    ):
        raise ValueError(f"{identifier}: audio does not carry the no-synthetic-silence contract")
    if manifest.get("catalogSHA256") != catalog_hash:
        raise ValueError(f"{identifier}: catalog hash changed; audio is not metadata-only migration")
    if manifest.get("direction") != current_plan["directions"][EXPECTED_LANGUAGE]:
        raise ValueError(f"{identifier}: selected English direction changed")
    speech_wpm = float(assembly.get("speechOnlyWordsPerMinute", 0))
    selected_range = current_plan["generation"]["noSyntheticSpeechOnlyWPMRangeByLanguage"][EXPECTED_LANGUAGE]
    tolerance = float(current_plan["generation"]["aggregateSpeechWPMTolerance"])
    if not selected_range[0] - tolerance <= speech_wpm <= selected_range[1] + tolerance:
        raise ValueError(f"{identifier}: English speech rate {speech_wpm:.2f} is outside current contract")
    validate_file_records(track_root, manifest)
    return manifest, previous_hash


def main() -> int:
    args = parse_args()
    plan_path = args.plan.resolve(strict=True)
    candidate_root = args.candidate_root.resolve(strict=True)
    run_path = args.run_manifest.resolve(strict=True)
    if plan_path.is_symlink() or candidate_root.is_symlink() or run_path.is_symlink():
        raise ValueError("Migration inputs must not be symlinks")
    current_plan = load_json(plan_path)
    current_plan_hash = sha256(plan_path)
    catalog_path = plan_path.parents[1] / "Content" / "guided" / "catalog.json"
    catalog_hash = sha256(catalog_path.resolve(strict=True))
    manifests: dict[str, tuple[Path, dict[str, Any], str]] = {}
    previous_hashes: set[str] = set()
    for identifier in EXPECTED_IDS:
        track_root = candidate_root / identifier / args.language
        if track_root.is_symlink() or not track_root.is_dir():
            raise ValueError(f"Missing or unsafe candidate directory: {track_root}")
        manifest, previous_hash = validate_track(
            track_root,
            identifier,
            current_plan,
            current_plan_hash,
            catalog_hash,
            previous_hashes,
        )
        manifests[identifier] = (track_root / "manifest.json", manifest, previous_hash)
    if len(previous_hashes) != 1 or current_plan_hash in previous_hashes:
        raise ValueError("English candidates do not share one prior plan hash")
    previous_hash = next(iter(previous_hashes))

    run = load_json(run_path)
    if (
        run.get("productionVersion") != current_plan.get("productionVersion")
        or run.get("languageOnly") != args.language
        or run.get("planSHA256") != previous_hash
        or run.get("catalogSHA256") != catalog_hash
    ):
        raise ValueError("English run manifest is not the expected pre-migration manifest")
    tracks = run.get("tracks")
    if not isinstance(tracks, list) or {track.get("contentID") for track in tracks} != set(EXPECTED_IDS):
        raise ValueError("English run manifest does not cover exactly G01 through G42")
    by_id = {track["contentID"]: track for track in tracks}
    for identifier, (manifest_path, manifest, _) in manifests.items():
        migrated = dict(manifest)
        migrated["planSHA256"] = current_plan_hash
        migrated["planHashMigration"] = migration_record(previous_hash, current_plan_hash)
        write_json_atomic(manifest_path, migrated)
        by_id[identifier]["manifestSHA256"] = sha256(manifest_path)
    migrated_run = dict(run)
    migrated_run["planSHA256"] = current_plan_hash
    migrated_run["planHashMigration"] = migration_record(previous_hash, current_plan_hash)
    migrated_run["tracks"] = [by_id[identifier] for identifier in EXPECTED_IDS]
    write_json_atomic(run_path, migrated_run)
    print(
        f"migrated {len(manifests)} unchanged {args.language} manifests and run metadata "
        f"from {previous_hash} to {current_plan_hash}; audioReencoded=false"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

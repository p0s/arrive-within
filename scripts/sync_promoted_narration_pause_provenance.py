#!/usr/bin/env python3
"""Bind reviewed bounded model pauses into promoted public provenance."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from narration_pause_contract import extract_bounded_natural_prosody_pauses


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "Content/guided/catalog.json"
REPORT_PATH = ROOT / "docs/audio/production-candidate-results.json"
PRIVATE_ROOT = ROOT / "ContentProduction/production-candidates"
LANGUAGES = ("en", "de")


class SyncFailure(Exception):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise SyncFailure(f"invalid or missing JSON: {path}") from error
    if not isinstance(value, dict):
        raise SyncFailure(f"expected JSON object: {path}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomically(path: Path, value: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def main() -> int:
    catalog = load_json(CATALOG_PATH)
    report = load_json(REPORT_PATH)
    production_version = report.get("productionVersion")
    tracks = {
        (track.get("id"), track.get("language")): track
        for track in report.get("tracks", [])
    }
    expected_keys = {
        (practice["id"], language)
        for practice in catalog.get("practices", [])
        for language in LANGUAGES
    }
    if len(expected_keys) != 84 or set(tracks) != expected_keys:
        raise SyncFailure("candidate report/catalogue is not the exact 42x2 set")

    updates: list[tuple[Path, dict[str, Any]]] = []
    pause_count = 0
    for identifier, language in sorted(expected_keys):
        track = tracks[(identifier, language)]
        track_root = PRIVATE_ROOT / str(production_version) / identifier / language
        manifest_path = track_root / "manifest.json"
        manifest = load_json(manifest_path)
        shipping_root = ROOT / "Content/guided" / identifier
        audio_path = shipping_root / f"audio.{language}.m4a"
        transcript_path = shipping_root / f"transcript.{language}.vtt"
        provenance_path = shipping_root / f"provenance.{language}.json"
        provenance = load_json(provenance_path)
        exact = {
            "audioSHA256": sha256(audio_path),
            "transcriptSHA256": sha256(transcript_path),
            "productionManifestSHA256": sha256(manifest_path),
        }
        expected = {
            "audioSHA256": track.get("deliverySHA256"),
            "transcriptSHA256": track.get("transcriptSHA256"),
            "productionManifestSHA256": track.get("manifestSHA256"),
        }
        if exact != expected or any(provenance.get(key) != value for key, value in exact.items()):
            raise SyncFailure(f"{identifier}/{language}: promoted hash binding mismatch")
        if (
            manifest.get("contentID") != identifier
            or manifest.get("language") != language
            or provenance.get("productionVersion") != production_version
            or provenance.get("humanListeningState") != "approved"
        ):
            raise SyncFailure(f"{identifier}/{language}: promoted provenance state mismatch")
        pauses = extract_bounded_natural_prosody_pauses(manifest.get("segments", []))
        provenance["boundedNaturalProsodyPauses"] = pauses
        pause_count += len(pauses)
        updates.append((provenance_path, provenance))

    for path, value in updates:
        write_json_atomically(path, value)
    print(f"Bound {pause_count} exact owner-reviewed natural-prosody pauses across 84 tracks.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, TypeError, ValueError, SyncFailure) as error:
        print(f"narration pause provenance sync failed: {error}")
        raise SystemExit(1) from error

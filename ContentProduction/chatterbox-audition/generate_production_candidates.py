#!/usr/bin/env python3
"""Generate private, owner-directed whole-track narration candidates.

One invocation handles exactly one language so English and German model state
never mix. Scripts are assembled completely before two-pass loudness mastering.
No reference voice, network fetch, time stretch, per-chunk normalization, or
shipping-content approval is implied by this production-candidate tool.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
import platform
import random
import re
import shutil
import subprocess
import sys
import tempfile
import weakref
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PLAN = PROJECT_ROOT / "ContentProduction" / "narration-production-plan.json"
DEFAULT_CATALOG = PROJECT_ROOT / "Content" / "guided" / "catalog.json"
PRIVATE_OUTPUT = PROJECT_ROOT / "ContentProduction" / "production-candidates"
EXPECTED_IDS = tuple(f"G{index:02d}" for index in range(1, 43))
PAUSE_PATTERN = re.compile(r"^\[Pause ([0-9]+(?:\.[0-9]+)?) (?:seconds|Sekunden)\]$")
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9„“\"])")
AAC_DELIVERY_SAFETY_GAIN_DB = -0.5
MEMORY_GUARD_ENVIRONMENT_KEY = "ARRIVE_WITHIN_NARRATION_MEMORY_GUARD"
INTEGRITY_ATTESTATION_ENVIRONMENT_KEY = "ARRIVE_WITHIN_NARRATION_INTEGRITY_ATTESTATION"
GENERATION_SEMANTICS_REVISION = (
    "chatterbox-production-v4-list-pressure-semicolon-bounded"
)
COMPATIBLE_SEMANTICS_PREDECESSORS = {
    "chatterbox-production-v1",
    "chatterbox-production-v2-phrase-bounded",
    "chatterbox-production-v3-list-pressure-bounded",
}
LEGACY_COMPLETE_TRACK_SEMANTICS_REVISION = "chatterbox-production-v1"
CHECKPOINT_CONTINUATION_EXIT_CODE = 75
LEGACY_COMPATIBLE_GENERATOR_SHA256 = {
    "42317288f3615200eb9de905d13a7537cec30f643233bd8be7ac1378eb9e9ec3",
}
S3_SPEECH_TOKEN_RATE = 25
PINNED_T3_BACKEND_SHA256 = "2d8407cf500ec1e6b707b060861145bb7802741328d76ec341280c06c7f3f2b5"
MLX_AUDIO_PREDECESSOR_SEMANTICS = {
    "chatterbox-production-v4-mlx-audio-0.4.8",
}
MLX_AUDIO_SEMANTICS_REVISION = (
    "chatterbox-production-v5-mlx-audio-0.4.8-semicolon-bounded"
)
MLX_AUDIO_TAG_COMMIT = "49596ac8b69b9ed377db311a73df838795f38a3d"
MLX_MODEL_INITIALIZATION_SEED = 20260812
MLX_CONDITIONALS = (
    PROJECT_ROOT / "ContentProduction" / "model-cache" / "mlx-audio" / "conds-v3.npz"
)
MLX_CONDITIONALS_SHA256 = "ff2e0cf023d9300faf782fd1205cbc5c0121d454c5c388a43a5f066f4de9734c"


@dataclass(frozen=True)
class SentenceEvent:
    paragraph_index: int
    sentence_index: int
    text: str


@dataclass(frozen=True)
class PauseEvent:
    seconds: float


@dataclass(frozen=True)
class GenerationUnit:
    source_text: str
    generation_text: str
    internal_boundaries: tuple[dict[str, Any], ...]
    gap_after: dict[str, Any] | None


@dataclass(frozen=True)
class GenerationRNGState:
    python: object
    numpy: tuple[Any, ...]
    torch_cpu: Any
    torch_mps: Any


@dataclass(frozen=True)
class CapturedSpeechUnit:
    speech_tokens: Any
    rng_state: GenerationRNGState


class SpeechTokenCaptureComplete(RuntimeError):
    """Internal control flow after T3 has produced one validated token stream."""

    def __init__(self, captured: CapturedSpeechUnit) -> None:
        self.captured = captured
        super().__init__("captured one narration speech-token stream")


def unit_checkpoint_root(output_root: Path, identifier: str, language: str) -> Path:
    if identifier not in EXPECTED_IDS or language not in {"en", "de"}:
        raise ValueError("Invalid narration unit-checkpoint scope")
    return output_root / ".unit-cache" / identifier / language


def unit_checkpoint_identity(
    identifier: str,
    language: str,
    plan_hash: str,
    catalog_hash: str,
    script_hash: str,
    model_hashes: dict[str, str],
    seed_offset: int,
    generation_semantics_revision: str = GENERATION_SEMANTICS_REVISION,
) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "contentID": identifier,
        "language": language,
        "planSHA256": plan_hash,
        "catalogSHA256": catalog_hash,
        "scriptSHA256": script_hash,
        "modelFileSHA256": model_hashes,
        "generationSemanticsRevision": generation_semantics_revision,
        "seedOffset": seed_offset,
    }


def compatible_legacy_checkpoint_identity(
    existing: dict[str, Any], expected: dict[str, Any]
) -> bool:
    if existing.get("schemaVersion") != 1:
        return False
    generator_hash = existing.get("generatorSHA256")
    if generator_hash not in LEGACY_COMPATIBLE_GENERATOR_SHA256:
        return False
    comparable = dict(existing)
    comparable.pop("generatorSHA256", None)
    comparable["schemaVersion"] = 2
    comparable["generationSemanticsRevision"] = GENERATION_SEMANTICS_REVISION
    return comparable == expected


def compatible_semantic_checkpoint_identity(
    existing: dict[str, Any], expected: dict[str, Any]
) -> bool:
    if existing.get("schemaVersion") != 2:
        return False
    expected_revision = expected.get("generationSemanticsRevision")
    predecessors = (
        COMPATIBLE_SEMANTICS_PREDECESSORS
        if expected_revision == GENERATION_SEMANTICS_REVISION
        else MLX_AUDIO_PREDECESSOR_SEMANTICS
        if expected_revision == MLX_AUDIO_SEMANTICS_REVISION
        else set()
    )
    if existing.get("generationSemanticsRevision") not in predecessors:
        return False
    comparable = dict(existing)
    comparable["generationSemanticsRevision"] = expected_revision
    return comparable == expected


def write_checkpoint_identity(path: Path, identity: dict[str, Any]) -> None:
    temporary = path.parent / ".identity.json.tmp"
    temporary.write_text(
        json.dumps(identity, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    os.replace(temporary, path)


def validate_semantic_checkpoint_migration(
    root: Path, expected_units: list[dict[str, Any]] | None
) -> None:
    unit_roots = sorted(root.glob("unit-*"))
    if not unit_roots:
        return
    if expected_units is None:
        raise RuntimeError(
            "Narration unit-checkpoint migration requires exact planned-unit metadata"
        )
    for expected_ordinal, unit_root in enumerate(unit_roots):
        match = re.fullmatch(r"unit-([0-9]{4})", unit_root.name)
        if match is None or unit_root.is_symlink() or not unit_root.is_dir():
            raise RuntimeError("Narration unit-checkpoint migration found an unsafe unit")
        ordinal = int(match.group(1))
        if ordinal != expected_ordinal:
            raise RuntimeError("Narration unit-checkpoint migration is not a contiguous prefix")
        if ordinal >= len(expected_units):
            raise RuntimeError("Narration unit-checkpoint migration has no matching unit")
        metadata_path = unit_root / "metadata.json"
        if metadata_path.is_symlink() or not metadata_path.is_file():
            raise RuntimeError("Narration unit-checkpoint migration metadata is unsafe")
        metadata = load_json(metadata_path)
        if any(metadata.get(key) != value for key, value in expected_units[ordinal].items()):
            raise RuntimeError("Narration unit-checkpoint migration metadata mismatch")


def prepare_unit_checkpoint_cache(
    root: Path,
    identity: dict[str, Any],
    expected_units: list[dict[str, Any]] | None = None,
) -> None:
    if root.is_symlink():
        raise RuntimeError("Narration unit-checkpoint root must not be a symlink")
    identity_path = root / "identity.json"
    if root.exists():
        if not root.is_dir() or not identity_path.is_file() or identity_path.is_symlink():
            raise RuntimeError("Narration unit-checkpoint cache is malformed")
        existing = load_json(identity_path)
        if existing != identity:
            compatible = (
                compatible_legacy_checkpoint_identity(existing, identity)
                or compatible_semantic_checkpoint_identity(existing, identity)
            )
            if not compatible:
                raise RuntimeError("Narration unit-checkpoint identity mismatch")
            validate_semantic_checkpoint_migration(root, expected_units)
            write_checkpoint_identity(identity_path, identity)
        return
    root.mkdir(parents=True, mode=0o700)
    root.chmod(0o700)
    write_checkpoint_identity(identity_path, identity)


def load_unit_checkpoint(
    root: Path,
    ordinal: int,
    expected: dict[str, Any],
    numpy: Any,
) -> Any | None:
    unit_root = root / f"unit-{ordinal:04d}"
    if not unit_root.exists():
        return None
    if unit_root.is_symlink() or not unit_root.is_dir():
        raise RuntimeError("Narration unit checkpoint is unsafe")
    metadata_path = unit_root / "metadata.json"
    pcm_path = unit_root / "pcm.npy"
    if any(path.is_symlink() or not path.is_file() for path in (metadata_path, pcm_path)):
        raise RuntimeError("Narration unit checkpoint is incomplete or unsafe")
    metadata = load_json(metadata_path)
    for key, value in expected.items():
        if metadata.get(key) != value:
            raise RuntimeError("Narration unit checkpoint metadata mismatch")
    samples = numpy.load(pcm_path, allow_pickle=False)
    if samples.dtype != numpy.float32 or samples.ndim != 1:
        raise RuntimeError("Narration unit checkpoint PCM shape or dtype is invalid")
    if (
        int(samples.size) != metadata.get("sampleCount")
        or hashlib.sha256(samples.tobytes()).hexdigest() != metadata.get("pcmFloat32SHA256")
    ):
        raise RuntimeError("Narration unit checkpoint PCM hash mismatch")
    return samples


def write_unit_checkpoint(
    root: Path,
    ordinal: int,
    metadata: dict[str, Any],
    samples: Any,
    numpy: Any,
) -> None:
    final_root = root / f"unit-{ordinal:04d}"
    if final_root.exists() or final_root.is_symlink():
        raise FileExistsError("Refusing to replace a narration unit checkpoint")
    temporary_root = Path(
        tempfile.mkdtemp(prefix=f".unit-{ordinal:04d}.", dir=root)
    )
    temporary_root.chmod(0o700)
    temporary_pcm = temporary_root / "pcm.npy"
    numpy.save(temporary_pcm, samples, allow_pickle=False)
    temporary_pcm.chmod(0o600)
    complete_metadata = {
        **metadata,
        "sampleCount": int(samples.size),
        "pcmFloat32SHA256": hashlib.sha256(samples.tobytes()).hexdigest(),
    }
    temporary_metadata = temporary_root / "metadata.json"
    temporary_metadata.write_text(
        json.dumps(complete_metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary_metadata.chmod(0o600)
    os.replace(temporary_root, final_root)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def integrity_signature(path: Path) -> list[int]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"Integrity-attested file is unsafe: {path.name}")
    metadata = path.lstat()
    return [
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    ]


def load_guard_integrity_attestation() -> dict[str, Any] | None:
    value = os.environ.get(INTEGRITY_ATTESTATION_ENVIRONMENT_KEY)
    if value is None:
        return None
    path = Path(value)
    expected_parent = (PROJECT_ROOT / ".evidence" / "audio").resolve()
    if (
        not path.is_absolute()
        or path.parent.resolve() != expected_parent
        or not path.name.startswith(".narration-integrity-attestation-")
        or path.is_symlink()
        or not path.is_file()
    ):
        raise RuntimeError("Narration integrity attestation path is unsafe")
    document = load_json(path)
    if document.get("schemaVersion") != 1 or not isinstance(document.get("guardPID"), int):
        raise RuntimeError("Narration integrity attestation is invalid")
    return document


def require_attested_regular_file(
    entry: dict[str, Any], expected_path: Path, expected_sha256: str | None = None
) -> str:
    try:
        recorded_path = Path(entry["path"])
        recorded_signature = entry["signature"]
        recorded_sha256 = entry["sha256"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Narration integrity-attested file entry is invalid") from error
    if (
        recorded_path != expected_path.resolve(strict=True)
        or integrity_signature(recorded_path) != recorded_signature
        or not isinstance(recorded_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", recorded_sha256)
        or (expected_sha256 is not None and recorded_sha256 != expected_sha256)
    ):
        raise RuntimeError("Narration integrity-attested file changed or mismatched")
    return recorded_sha256


def require_attested_model_file(
    entry: dict[str, Any], snapshot_path: Path, expected_sha256: str
) -> str:
    try:
        recorded_snapshot = Path(entry["snapshotPath"])
        recorded_snapshot_signature = entry["snapshotSignature"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Narration model attestation entry is invalid") from error
    snapshot_metadata = snapshot_path.lstat()
    actual_snapshot_signature = [
        snapshot_metadata.st_dev,
        snapshot_metadata.st_ino,
        snapshot_metadata.st_mode,
        snapshot_metadata.st_size,
        snapshot_metadata.st_mtime_ns,
        snapshot_metadata.st_ctime_ns,
    ]
    if (
        recorded_snapshot != snapshot_path
        or actual_snapshot_signature != recorded_snapshot_signature
    ):
        raise RuntimeError("Narration model snapshot link changed")
    return require_attested_regular_file(
        entry, snapshot_path.resolve(strict=True), expected_sha256
    )


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def words(value: str) -> list[str]:
    return [
        item.casefold()
        for item in re.findall(r"[^\W_]+(?:[-’'][^\W_]+)*", value, flags=re.UNICODE)
    ]


def load_json(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"Expected a JSON object: {path.name}")
    return document


def load_and_validate_plan(path: Path) -> dict[str, Any]:
    plan = load_json(path)
    if plan.get("schemaVersion") != 1:
        raise ValueError("Unsupported narration production plan schema")
    if plan.get("productionVersion") != "chatterbox-production-candidates-v2":
        raise ValueError("Unexpected narration production version")
    if plan.get("model", {}).get("voiceReference") is not None:
        raise ValueError("Production candidates must not use reference voice material")
    directions = plan.get("directions", {})
    expected_directions = {
        "en": ("en-f2-spacious-slow", "default-en", None, 1700, 2400),
        "de": ("de-c2-accent-stability", "default-de-v3", "de", 750, 1200),
    }
    if set(directions) != set(expected_directions):
        raise ValueError("Production plan must contain exactly English and German directions")
    for language, expected in expected_directions.items():
        direction = directions[language]
        actual = (
            direction.get("id"),
            direction.get("voiceLabel"),
            direction.get("languageID"),
            direction.get("sentenceGapMs"),
            direction.get("paragraphGapMs"),
        )
        if actual != expected or direction.get("ownerState") != "selected":
            raise ValueError(f"Owner-selected {language} direction does not match the locked plan")
    if directions["en"].get("speechOnlyWPMRange") != [105, 120]:
        raise ValueError("English production cadence must match the owner-selected F2 range")
    if directions["en"].get("clausePauseMs") != 1500:
        raise ValueError("English production phrase spacing must match the F2 production proof")
    mastering = plan.get("mastering", {})
    if (
        mastering.get("integratedLUFSTarget") != -19.0
        or mastering.get("deliveryTruePeakMaximumDBTP") != -1.5
        or mastering.get("deliveryEncoder") != "aac_at"
        or mastering.get("deliveryRateControl") != "cbr"
        or mastering.get("deliverySampleRate") != 24000
        or not 56000 <= int(mastering.get("deliveryBitrateBPS", 0)) <= 64000
    ):
        raise ValueError("Mastering targets do not match the product contract")
    generation = plan.get("generation", {})
    if (
        generation.get("scriptPauseAllocation")
        != "preserve-relative-authored-weights-and-hit-catalog-target-duration"
        or generation.get("durationTargetToleranceSeconds") != 1.0
        or generation.get("aggregateSpeechWPMTolerance") != 0.5
    ):
        raise ValueError("Duration and speech-rate tolerances do not match the product contract")
    if plan.get("rights", {}).get("publicRedistribution") != "pending-owner-cc-by-4.0-signoff":
        raise ValueError("Public redistribution must remain an explicit pending human gate")
    return plan


def load_and_validate_catalog(path: Path) -> dict[str, Any]:
    catalog = load_json(path)
    practices = catalog.get("practices")
    if not isinstance(practices, list) or [item.get("id") for item in practices] != list(EXPECTED_IDS):
        raise ValueError("Catalogue must contain exactly ordered G01 through G42")
    for practice in practices:
        localized = practice.get("localized")
        if not isinstance(localized, dict) or set(localized) != {"en", "de"}:
            raise ValueError(f"{practice.get('id')}: exact English/German catalogue parity required")
    return catalog


def parse_front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---\n") or "\n---\n" not in raw[4:]:
        raise ValueError("Guided script is missing simple front matter")
    header, body = raw[4:].split("\n---\n", 1)
    metadata: dict[str, str] = {}
    for line in header.splitlines():
        key, separator, value = line.partition(":")
        if not separator or not key.strip() or not value.strip():
            raise ValueError(f"Invalid front matter line: {line!r}")
        metadata[key.strip()] = value.strip()
    return metadata, body


def split_sentences(paragraph: str) -> list[str]:
    sentences = [item.strip() for item in SENTENCE_BOUNDARY.split(paragraph) if item.strip()]
    if not sentences:
        raise ValueError("Spoken paragraph contains no sentence")
    if [word for sentence in sentences for word in words(sentence)] != words(paragraph):
        raise ValueError("Sentence splitting changed the spoken lexical sequence")
    return sentences


def parse_script(path: Path) -> tuple[dict[str, str], list[SentenceEvent | PauseEvent]]:
    metadata, body = parse_front_matter(path.read_text(encoding="utf-8"))
    events: list[SentenceEvent | PauseEvent] = []
    paragraph_index = 0
    sentence_index = 0
    for raw_paragraph in re.split(r"\n\s*\n", body.strip()):
        lines = [line.strip() for line in raw_paragraph.splitlines() if line.strip()]
        if not lines:
            continue
        if all(line.startswith("#") for line in lines):
            continue
        paragraph = " ".join(line for line in lines if not line.startswith("#")).strip()
        if not paragraph:
            continue
        pause_match = PAUSE_PATTERN.fullmatch(paragraph)
        if pause_match:
            seconds = float(pause_match.group(1))
            if not 0 < seconds <= 120:
                raise ValueError(f"Pause directive outside supported range: {paragraph}")
            events.append(PauseEvent(seconds=seconds))
            continue
        for sentence in split_sentences(paragraph):
            events.append(
                SentenceEvent(
                    paragraph_index=paragraph_index,
                    sentence_index=sentence_index,
                    text=sentence,
                )
            )
            sentence_index += 1
        paragraph_index += 1
    if not events or not any(isinstance(event, SentenceEvent) for event in events):
        raise ValueError(f"Script has no spoken events: {path.name}")
    return metadata, events


def _punctuation_parts(text: str) -> list[tuple[str, str | None]]:
    parts: list[tuple[str, str | None]] = []
    start = 0
    for match in re.finditer(r"[,;:]", text):
        segment = text[start : match.start()].strip()
        if segment:
            parts.append((segment, match.group(0)))
        start = match.end()
    tail = text[start:].strip()
    if tail:
        parts.append((tail, None))
    return parts


def _boundary_kind(delimiter: str, comma_count: int) -> str:
    return "list" if delimiter == "," and comma_count >= 2 else "clause"


def _insert_ellipsis_after_word(text: str, after_word_index: int) -> str:
    matches = list(
        re.finditer(r"[^\W_]+(?:[-’'][^\W_]+)*", text, flags=re.UNICODE)
    )
    if not 0 < after_word_index < len(matches):
        raise ValueError("Calm phrase boundary must remain inside the generation unit")
    offset = matches[after_word_index - 1].end()
    return f"{text[:offset]} …{text[offset:]}"


def _split_after_word(text: str, after_word_index: int) -> tuple[str, str]:
    matches = list(
        re.finditer(r"[^\W_]+(?:[-’'][^\W_]+)*", text, flags=re.UNICODE)
    )
    if not 0 < after_word_index < len(matches):
        raise ValueError("Calm phrase split must remain inside the generation unit")
    offset = matches[after_word_index].start()
    return text[:offset].rstrip(), text[offset:].lstrip()


def _sentence_generation_text(text: str, *, capitalize: bool = False) -> str:
    result = text.strip()
    if capitalize and result:
        result = result[0].upper() + result[1:]
    if not re.search(r"[.!?]$", result):
        result += "."
    return result


def _authored_punctuation_boundaries(
    source_text: str, language: str
) -> list[dict[str, Any]]:
    matches = list(re.finditer(r"[^\W_]+(?:[-’'][^\W_]+)*", source_text, flags=re.UNICODE))
    comma_count = source_text.count(",")
    boundaries: list[dict[str, Any]] = []
    for delimiter in re.finditer(r"[,;:]", source_text):
        after_word_index = sum(match.end() <= delimiter.start() for match in matches)
        if 0 < after_word_index < len(matches):
            boundaries.append(
                {
                    "after": words(source_text)[after_word_index - 1],
                    "kind": (
                        _boundary_kind(delimiter.group(0), comma_count)
                        if language == "en"
                        else "clause"
                    ),
                    "afterWordIndex": after_word_index,
                    "unitWordCount": len(matches),
                }
            )
    return boundaries


def _generation_text_with_boundaries(
    source_text: str,
    boundaries: tuple[dict[str, Any], ...],
    *,
    capitalize: bool,
) -> str:
    result = source_text
    for boundary in sorted(
        boundaries, key=lambda item: int(item["afterWordIndex"]), reverse=True
    ):
        result = _insert_ellipsis_after_word(result, int(boundary["afterWordIndex"]))
    return _sentence_generation_text(result, capitalize=capitalize)


def phrase_bounded_units(
    unit: GenerationUnit,
    maximum_words: int,
    language: str,
    *,
    apply_pressure_splits: bool = True,
    normalize_terminal_delimiters: bool = True,
) -> list[GenerationUnit]:
    """Recursively bound a semantic unit for synchronous S3 waveform decode."""

    if maximum_words < 8:
        raise ValueError("Phrase-bounded generation requires a viable word ceiling")
    word_count = len(words(unit.source_text))
    # Dense authored lists can make one synchronous waveform decode much more
    # memory-intensive even below the ordinary word ceiling. Split only the
    # initial high-boundary unit; each resulting phrase remains semantically
    # intact and keeps its authored list gap.
    dense_list_split = (
        apply_pressure_splits
        and word_count >= 11
        and len(unit.internal_boundaries) >= 4
    )
    # A semicolon joins two independently speakable clauses. On multilingual
    # MLX, an otherwise short 4+4 German clause exhausted even a 300-token cap
    # without EOS. Preserve both clauses and the authored boundary instead of
    # accepting truncation or an abnormally slow/hallucinated continuation.
    source_matches = list(
        re.finditer(
            r"[^\W_]+(?:[-’'][^\W_]+)*", unit.source_text, flags=re.UNICODE
        )
    )
    semicolon_split = apply_pressure_splits and language == "de" and any(
        delimiter.group(0) == ";"
        and 4
        <= sum(
            match.end() <= delimiter.start()
            for match in source_matches
        )
        <= word_count - 4
        for delimiter in re.finditer(r";", unit.source_text)
    )
    force_initial_split = dense_list_split or semicolon_split
    if word_count <= maximum_words and not force_initial_split:
        generation_text = (
            re.sub(r"[,;:]\.$", ".", unit.generation_text)
            if normalize_terminal_delimiters
            else unit.generation_text
        )
        if generation_text == unit.generation_text:
            return [unit]
        return [
            GenerationUnit(
                source_text=unit.source_text,
                generation_text=generation_text,
                internal_boundaries=unit.internal_boundaries,
                gap_after=unit.gap_after,
            )
        ]

    def split(
        source_text: str,
        boundaries: tuple[dict[str, Any], ...],
        final_gap: dict[str, Any] | None,
        capitalize: bool,
        force_split: bool = False,
    ) -> list[GenerationUnit]:
        word_count = len(words(source_text))
        if word_count <= maximum_words and not force_split:
            generation_source = (
                re.sub(r"[,;:]\s*$", "", source_text)
                if normalize_terminal_delimiters
                else source_text
            )
            normalized = tuple(
                {**boundary, "unitWordCount": word_count} for boundary in boundaries
            )
            return [
                GenerationUnit(
                    source_text=source_text,
                    generation_text=_generation_text_with_boundaries(
                        generation_source, normalized, capitalize=capitalize
                    ),
                    internal_boundaries=normalized,
                    gap_after=final_gap,
                )
            ]
        candidates = [
            *boundaries,
            *_authored_punctuation_boundaries(source_text, language),
        ]
        candidates = [
            boundary
            for boundary in candidates
            if 4 <= int(boundary["afterWordIndex"]) <= word_count - 4
        ]
        if candidates:
            boundary = min(
                candidates,
                key=lambda item: abs(int(item["afterWordIndex"]) - word_count / 2),
            )
        else:
            boundary = calm_phrase_boundary(source_text, minimum_phrase_words=4)
        if boundary is None:
            raise ValueError("Long narration phrase has no safe lexical split")
        split_index = int(boundary["afterWordIndex"])
        first, second = _split_after_word(source_text, split_index)
        left_boundaries = tuple(
            item for item in boundaries if int(item["afterWordIndex"]) < split_index
        )
        right_boundaries = tuple(
            {
                **item,
                "afterWordIndex": int(item["afterWordIndex"]) - split_index,
            }
            for item in boundaries
            if int(item["afterWordIndex"]) > split_index
        )
        split_gap = {"after": words(first)[-1], "kind": boundary["kind"]}
        return [
            *split(
                first,
                left_boundaries,
                split_gap,
                capitalize,
            ),
            *split(second, right_boundaries, final_gap, True),
        ]

    units = split(
        unit.source_text,
        unit.internal_boundaries,
        unit.gap_after,
        False,
        force_initial_split,
    )
    if [word for item in units for word in words(item.source_text)] != words(unit.source_text):
        raise ValueError("Phrase-bounded generation changed the lexical sequence")
    if any(not 4 <= len(words(item.source_text)) <= maximum_words for item in units):
        raise ValueError("Phrase-bounded generation produced an unsafe unit")
    return units


def calm_phrase_boundary(
    source_text: str,
    minimum_phrase_words: int = 3,
    minimum_total_words: int = 8,
) -> dict[str, Any] | None:
    """Choose one lexical, non-word-level pause for an unpunctuated English phrase.

    F2's heard cadence came from coherent phrase generation with an ellipsis at a
    semantic boundary. Production uses the same technique for otherwise-rushed
    clauses, preferring a clause introducer and falling back to a content-word
    midpoint only when both phrases remain substantial.
    """

    source_words = words(source_text)
    word_count = len(source_words)
    if word_count < minimum_total_words:
        return None
    if minimum_phrase_words < 3:
        raise ValueError("Calm phrase boundary requires substantial phrases")
    clause_introducers = {
        "after",
        "and",
        "are",
        "as",
        "because",
        "before",
        "but",
        "for",
        "from",
        "if",
        "in",
        "into",
        "or",
        "that",
        "through",
        "to",
        "until",
        "when",
        "where",
        "while",
        "with",
        "without",
    }
    weak_boundary_words = {
        "a",
        "an",
        "and",
        "as",
        "at",
        "but",
        "for",
        "from",
        "he",
        "her",
        "hers",
        "him",
        "his",
        "i",
        "in",
        "into",
        "is",
        "it",
        "its",
        "my",
        "next",
        "of",
        "on",
        "or",
        "our",
        "one",
        "she",
        "that",
        "the",
        "their",
        "them",
        "they",
        "this",
        "to",
        "two",
        "was",
        "we",
        "were",
        "you",
        "your",
    }
    candidates: list[tuple[int, int, int]] = []
    midpoint = word_count / 2
    for after_word_index in range(minimum_phrase_words, word_count - minimum_phrase_words + 1):
        previous_word = source_words[after_word_index - 1]
        following_word = source_words[after_word_index]
        if previous_word in weak_boundary_words:
            continue
        introducer_rank = 0 if following_word in clause_introducers else 1
        candidates.append(
            (introducer_rank, round(abs(after_word_index - midpoint) * 1000), after_word_index)
        )
    if not candidates:
        return None
    _, _, after_word_index = min(candidates)
    return {
        "after": source_words[after_word_index - 1],
        "kind": "clause",
        "afterWordIndex": after_word_index,
        "unitWordCount": word_count,
    }


def _english_context_units(sentence: str) -> list[GenerationUnit]:
    parts = _punctuation_parts(sentence)
    if len(parts) <= 1:
        boundary = calm_phrase_boundary(sentence)
        if boundary is None:
            return [GenerationUnit(sentence, sentence, tuple(), None)]
        return [
            GenerationUnit(
                sentence,
                _insert_ellipsis_after_word(sentence, int(boundary["afterWordIndex"])),
                (boundary,),
                None,
            )
        ]

    comma_count = sentence.count(",")
    groups: list[list[tuple[str, str | None]]] = []
    current: list[tuple[str, str | None]] = []
    current_words = 0
    for index, part in enumerate(parts):
        current.append(part)
        current_words += len(words(part[0]))
        remaining_words = sum(len(words(item[0])) for item in parts[index + 1 :])
        if current_words >= 6 and (remaining_words == 0 or remaining_words >= 4):
            groups.append(current)
            current = []
            current_words = 0
    if current:
        if groups and current_words < 4:
            groups[-1].extend(current)
        else:
            groups.append(current)

    units: list[GenerationUnit] = []
    for group_index, group in enumerate(groups):
        source_chunks: list[str] = []
        generation_chunks: list[str] = []
        boundaries: list[dict[str, Any]] = []
        gap_after: dict[str, Any] | None = None
        unit_word_index = 0
        for part_index, (segment, delimiter) in enumerate(group):
            unit_word_index += len(words(segment))
            source_chunks.append(segment + (delimiter or ""))
            is_group_end = part_index == len(group) - 1
            if delimiter and is_group_end and group_index < len(groups) - 1:
                gap_after = {
                    "after": words(segment)[-1],
                    "kind": _boundary_kind(delimiter, comma_count),
                }
                generation_chunks.append(segment)
            elif delimiter:
                generation_chunks.append(segment)
                generation_chunks.append("…")
                boundaries.append(
                    {
                        "after": words(segment)[-1],
                        "kind": _boundary_kind(delimiter, comma_count),
                        "afterWordIndex": unit_word_index,
                    }
                )
            else:
                generation_chunks.append(segment)
        source_text = " ".join(source_chunks)
        generation_text = " ".join(generation_chunks).strip()
        if not boundaries:
            calm_boundary = calm_phrase_boundary(source_text)
            if calm_boundary is not None:
                generation_text = _insert_ellipsis_after_word(
                    generation_text, int(calm_boundary["afterWordIndex"])
                )
                boundaries.append(calm_boundary)
        if not re.search(r"[.!?]$", generation_text):
            generation_text += "."
        if words(source_text) != words(generation_text):
            raise ValueError("English context-aware unit changed the lexical sequence")
        for boundary in boundaries:
            boundary["unitWordCount"] = len(words(source_text))
        units.append(
            GenerationUnit(
                source_text=source_text,
                generation_text=generation_text,
                internal_boundaries=tuple(boundaries),
                gap_after=gap_after,
            )
        )
    if [word for unit in units for word in words(unit.source_text)] != words(sentence):
        raise ValueError("English context-aware units changed the source sentence")
    if len(words(sentence)) >= 4 and any(len(words(unit.source_text)) < 4 for unit in units):
        raise ValueError("Context-aware generation produced an isolated short unit")
    return units


def english_generation_units(sentence: str) -> list[GenerationUnit]:
    context_units = _english_context_units(sentence)
    units = [
        item
        for unit in context_units
        for item in phrase_bounded_units(unit, 12, "en")
    ]
    if [word for unit in units for word in words(unit.source_text)] != words(sentence):
        raise ValueError("English phrase-bounded units changed the source sentence")
    return units


def generation_units(sentence: str, language: str) -> list[GenerationUnit]:
    if language == "en":
        return english_generation_units(sentence)
    german_unit = GenerationUnit(sentence, sentence, tuple(), None)
    if language == "de":
        return phrase_bounded_units(german_unit, 10, "de")
    raise ValueError("Unsupported narration language")


def legacy_pre_v4_generation_units(
    sentence: str, language: str
) -> list[GenerationUnit]:
    """Reconstruct the v2/v3 bounded plan for immutable retained candidates.

    This is validator-only compatibility for manifests created before the
    list-pressure and semicolon safeguards. New production always uses
    ``generation_units`` above; this path is deliberately not exposed as a
    generation option.
    """
    if language == "en":
        return [
            item
            for unit in _english_context_units(sentence)
            for item in phrase_bounded_units(
                unit,
                12,
                "en",
                apply_pressure_splits=False,
                normalize_terminal_delimiters=False,
            )
        ]
    if language == "de":
        return phrase_bounded_units(
            GenerationUnit(sentence, sentence, tuple(), None),
            10,
            "de",
            apply_pressure_splits=False,
            normalize_terminal_delimiters=False,
        )
    raise ValueError("Unsupported narration language")


def legacy_complete_track_generation_units(
    sentence: str, language: str
) -> list[GenerationUnit]:
    """Reconstruct the exact pre-bounding unit plan for retained v2 candidates.

    This is validation-only compatibility for already complete, hash-bound audio;
    unfinished tracks always use the current bounded planner.
    """
    if language == "en":
        units = _english_context_units(sentence)
        result: list[GenerationUnit] = []
        for unit in units:
            boundaries = unit.internal_boundaries
            generation_text = unit.generation_text
            if not boundaries:
                boundary = calm_phrase_boundary(
                    unit.source_text, minimum_total_words=6
                )
                if boundary is not None:
                    boundaries = (boundary,)
                    generation_text = _insert_ellipsis_after_word(
                        generation_text, int(boundary["afterWordIndex"])
                    )
            result.append(
                GenerationUnit(
                    unit.source_text,
                    generation_text,
                    boundaries,
                    unit.gap_after,
                )
            )
        return result
    if language == "de":
        return [GenerationUnit(sentence, sentence, tuple(), None)]
    raise ValueError("Unsupported narration language")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backend",
        choices=("pytorch-mps", "mlx-audio"),
        default="pytorch-mps",
    )
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--language", choices=("en", "de"), required=True)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--practice", action="append", choices=EXPECTED_IDS)
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--one-new-unit-per-child",
        action="store_true",
        help=(
            "Exit with a dedicated continuation status after one new atomic unit "
            "checkpoint so the owning guard can relaunch a fresh process."
        ),
    )
    parser.add_argument(
        "--new-units-per-child",
        type=int,
        choices=(1, 2, 4, 8, 16),
        default=1,
        help=(
            "Bound checkpoint-only continuation to a proved number of new "
            "atomic units per owned child."
        ),
    )
    parser.add_argument(
        "--mps-residency-strategy",
        choices=("phase-per-unit", "phase-batched"),
        default="phase-per-unit",
        help=(
            "Select the guarded MPS model-residency strategy. Alternatives are "
            "eligible for production only after exact-PCM and memory benchmarks."
        ),
    )
    parser.add_argument(
        "--probe-first-unit",
        action="store_true",
        help="Load the selected model and generate only the first semantic unit for a guard probe.",
    )
    parser.add_argument(
        "--probe-unit-count",
        type=int,
        choices=(1, 2, 4, 8, 16),
        default=1,
        help="For a nonpersisting guard probe, reuse one loaded model for this many seeded units.",
    )
    parser.add_argument("--probe-report", type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--seed-offset",
        type=int,
        default=0,
        help="Bounded deterministic retry offset for one practice (0-999).",
    )
    return parser.parse_args(argv)


def select_device(requested: str, torch: Any) -> str:
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    if requested != "auto":
        return requested
    return "mps" if torch.backends.mps.is_available() else "cpu"


def require_memory_guard(device: str, environment: dict[str, str] | None = None) -> None:
    values = os.environ if environment is None else environment
    if device in {"mps", "mlx"} and values.get(MEMORY_GUARD_ENVIRONMENT_KEY) != "1":
        raise RuntimeError(
            "Accelerated narration must run through scripts/run_narration_guarded.py"
        )


def install_memory_efficient_t3_backend(
    torch: Any,
    backend_class: Any,
    output_class: Any,
) -> str:
    """Retain only T3's final transformer state under the exact pinned backend.

    Chatterbox asks Hugging Face to return every transformer layer even though
    its sampling path consumes only the final state, projected logits, and KV
    cache. Keeping all layers adds avoidable MPS pressure. This compatibility
    patch fails closed if the installed upstream source differs from the
    audited pin and leaves sampling inputs, logits, seeds, and model precision
    unchanged.
    """
    source_name = inspect.getsourcefile(backend_class)
    if not source_name:
        raise RuntimeError("Unable to locate the pinned Chatterbox T3 backend")
    source_path = Path(source_name).resolve()
    actual_hash = sha256(source_path)
    if actual_hash != PINNED_T3_BACKEND_SHA256:
        raise RuntimeError("Pinned Chatterbox T3 backend hash mismatch")
    if getattr(backend_class.forward, "_arrive_within_final_state_only", False):
        return actual_hash

    @torch.inference_mode()
    def final_state_only_forward(
        self: Any,
        inputs_embeds: Any,
        past_key_values: Any = None,
        use_cache: bool = True,
        output_attentions: bool = False,
        output_hidden_states: bool = True,
        return_dict: bool = True,
    ) -> Any:
        is_large_input = inputs_embeds.size(1) != 1
        has_cache = past_key_values is not None and len(past_key_values) > 0
        if is_large_input and has_cache:
            raise AssertionError("Large T3 input cannot be combined with a KV cache")
        if not return_dict or not output_hidden_states:
            raise AssertionError("Unexpected T3 backend output contract")
        transformer_output = self.model(
            inputs_embeds=inputs_embeds,
            past_key_values=past_key_values,
            use_cache=use_cache,
            output_attentions=output_attentions,
            output_hidden_states=False,
            return_dict=True,
        )
        logits = self.speech_head(transformer_output.last_hidden_state)
        return output_class(
            logits=logits,
            past_key_values=transformer_output.past_key_values,
            hidden_states=None,
            attentions=transformer_output.attentions,
        )

    final_state_only_forward._arrive_within_final_state_only = True
    backend_class.forward = final_state_only_forward
    return actual_hash


def release_accelerator_cache(model: Any, device: str, torch: Any) -> None:
    """Release per-call Chatterbox and allocator state after one generation unit."""
    if device == "mps":
        t3 = getattr(model, "t3", None)
        if t3 is not None and hasattr(t3, "patched_model"):
            t3.patched_model = None
            t3.compiled = False
        gc.collect()
        torch.mps.synchronize()
        torch.mps.empty_cache()


def should_reload_model(device: str, generation_calls_since_load: int) -> bool:
    return device == "mps" and generation_calls_since_load >= 2


def process_boundary_evidence(
    language: str,
    logical_generation_calls: int,
    generation_calls_in_process: int,
    model_reload_count: int,
    one_new_unit_per_child: bool,
    new_units_per_child: int = 1,
    mps_residency_strategy: str = "phase-per-unit",
) -> dict[str, Any]:
    """Describe logical coverage separately from the final assembly process."""
    return {
        "languageOnly": language,
        "otherLanguageGenerationCalls": 0,
        "languageIDExplicitOnEveryGermanCall": language == "de",
        "generationCallCount": logical_generation_calls,
        "logicalGenerationCallCount": logical_generation_calls,
        "activeInvocationLifecycle": (
            (
                "one-new-unit-per-owned-process"
                if new_units_per_child == 1
                else "bounded-checkpoint-batch-per-owned-process"
            )
            if one_new_unit_per_child
            else "bounded-model-reuse-in-owned-process"
        ),
        "assemblyProcessGenerationCallCount": generation_calls_in_process,
        "assemblyProcessMPSModelReloadCount": model_reload_count,
        "configuredMaximumNewGenerationCallsPerOwnedProcess": (
            new_units_per_child if one_new_unit_per_child else None
        ),
        "maximumGenerationCallsPerMPSModel": (
            new_units_per_child if one_new_unit_per_child else 2
        ),
        "mpsResidencyStrategy": mps_residency_strategy,
        "referenceVoiceUsed": False,
        "runtimeNetworkUsed": False,
    }


def release_inactive_mps_cache(device: str, torch: Any) -> None:
    """Release only unoccupied T3 cache before Chatterbox enters S3 waveform decode."""
    if device == "mps":
        torch.mps.synchronize()
        torch.mps.empty_cache()


def run_preserving_generation_rng(
    action: Callable[[], Any], torch: Any, numpy: Any
) -> Any:
    """Load a model phase without consuming any deterministic generation RNG stream."""
    python_state = random.getstate()
    numpy_state = numpy.random.get_state()
    cpu_state = torch.random.get_rng_state()
    mps_state = torch.mps.get_rng_state()
    try:
        return action()
    finally:
        random.setstate(python_state)
        numpy.random.set_state(numpy_state)
        torch.random.set_rng_state(cpu_state)
        torch.mps.set_rng_state(mps_state)


def capture_generation_rng(torch: Any, numpy: Any) -> GenerationRNGState:
    """Capture the exact post-T3 stream consumed by the S3 decoder."""
    return GenerationRNGState(
        python=random.getstate(),
        numpy=numpy.random.get_state(),
        torch_cpu=torch.random.get_rng_state(),
        torch_mps=torch.mps.get_rng_state(),
    )


def restore_generation_rng(
    state: GenerationRNGState, torch: Any, numpy: Any
) -> None:
    random.setstate(state.python)
    numpy.random.set_state(state.numpy)
    torch.random.set_rng_state(state.torch_cpu)
    torch.mps.set_rng_state(state.torch_mps)


def load_safetensor_phase_direct(
    module_factory: Callable[[], Any],
    checkpoint: Path,
    load_safetensors: Callable[..., dict[str, Any]],
    torch: Any,
    device: str,
    *,
    strict: bool,
    allowed_missing: tuple[str, ...] = (),
    materialize_meta: Callable[[Any, tuple[str, ...]], None] | None = None,
) -> Any:
    """Assign pinned tensors directly into a meta module on the target device.

    This avoids simultaneously retaining random CPU parameters, a full CPU
    checkpoint dictionary, and the MPS parameters. Every omission remains
    explicit and all state must be materialized before inference.
    """
    with torch.device("meta"):
        module = module_factory()
    state = load_safetensors(checkpoint, device=device)
    if "model" in state:
        state = state["model"][0]
    incompatible = module.load_state_dict(state, assign=True, strict=strict)
    del state
    missing = tuple(sorted(incompatible.missing_keys))
    unexpected = tuple(sorted(incompatible.unexpected_keys))
    if missing != tuple(sorted(allowed_missing)) or unexpected:
        raise RuntimeError(
            f"Safetensor phase state mismatch: missing={missing}, unexpected={unexpected}"
        )
    if missing and materialize_meta is None:
        raise RuntimeError("Safetensor phase has no missing-state materializer")
    if materialize_meta is not None:
        materialize_meta(module, missing)
    remaining_meta = {
        name
        for name, value in (*module.named_parameters(), *module.named_buffers())
        if getattr(value, "is_meta", False)
    }
    for module_name, child in module.named_modules():
        for attribute, value in vars(child).items():
            if getattr(value, "is_meta", False):
                remaining_meta.add(
                    ".".join(part for part in (module_name, attribute) if part)
                )
    if remaining_meta:
        raise RuntimeError(
            f"Safetensor phase retained meta state: {tuple(sorted(remaining_meta))}"
        )
    return module.eval()


def materialize_t3_nonpersistent_state(
    t3: Any, missing: tuple[str, ...], device: str
) -> None:
    if missing:
        raise RuntimeError("Unexpected T3 phase missing state")
    rotary = t3.tfmr.rotary_emb
    reference = type(rotary)(rotary.config, device="cpu")
    rotary.inv_freq = reference.inv_freq.to(device)
    rotary.original_inv_freq = reference.original_inv_freq.to(device)
    rotary.attention_scaling = reference.attention_scaling


def materialize_s3_nonpersistent_state(
    s3gen: Any,
    missing: tuple[str, ...],
    torch: Any,
    device: str,
    precompute_freqs_cis: Callable[[int, int], Any],
) -> None:
    if missing != ("tokenizer.window",):
        raise RuntimeError("Unexpected S3 phase missing state")
    s3gen.tokenizer.window = torch.hann_window(s3gen.tokenizer.n_fft).to(device)
    n_trim = int(s3gen.trim_fade.shape[0]) // 2
    trim_fade = torch.zeros(2 * n_trim)
    trim_fade[n_trim:] = (
        torch.cos(torch.linspace(torch.pi, 0, n_trim)) + 1
    ) / 2
    s3gen.trim_fade = trim_fade.to(device)
    freqs_shape = s3gen.tokenizer.encoder.freqs_cis.shape
    s3gen.tokenizer.encoder.freqs_cis = precompute_freqs_cis(
        int(freqs_shape[1]), int(freqs_shape[0])
    ).to(device)
    for positional in (
        s3gen.flow.encoder.embed.pos_enc,
        s3gen.flow.encoder.up_embed.pos_enc,
    ):
        maximum_length = (int(positional.pe.shape[1]) + 1) // 2
        reference = type(positional)(
            positional.d_model,
            positional.dropout.p,
            max_len=maximum_length,
        )
        positional.pe = reference.pe.to(device)


class _SpeechTokenCaptureS3:
    def __init__(self, torch: Any, numpy: Any) -> None:
        self.torch = torch
        self.numpy = numpy

    def inference(self, *, speech_tokens: Any, ref_dict: dict[str, Any]) -> Any:
        del ref_dict
        state = capture_generation_rng(self.torch, self.numpy)
        tokens = speech_tokens.detach().cpu()
        raise SpeechTokenCaptureComplete(CapturedSpeechUnit(tokens, state))


class MPSPhaseManagedChatterbox:
    """Keep only the active T3 or S3Gen phase resident in unified memory."""

    def __init__(
        self,
        shell: Any,
        t3_factory: Callable[[], Any],
        s3_factory: Callable[[], Any],
        torch: Any,
        numpy: Any,
        language: str = "de",
        phase_batched: bool = False,
    ) -> None:
        self.shell = shell
        self.t3_factory = t3_factory
        self.s3_factory = s3_factory
        self.torch = torch
        self.numpy = numpy
        self.language = language
        self.phase_batched = phase_batched
        self.residency_strategy = "phase-batched" if phase_batched else "phase-per-unit"
        self.phase = "empty"

    @property
    def t3(self) -> Any:
        return self.shell.t3

    def prepare_t3_phase(self) -> None:
        if self.phase != "empty" or self.shell.t3 is not None or self.shell.s3gen is not None:
            raise RuntimeError("Narration phase loader expected an empty model shell")
        self.shell.t3 = run_preserving_generation_rng(
            self.t3_factory, self.torch, self.numpy
        )
        self.shell.conds.t3 = self.shell.conds.t3.to(device="mps")
        self.phase = "t3"

    def transition_to_s3_phase(self) -> None:
        if self.phase != "t3" or self.shell.t3 is None:
            raise RuntimeError("Narration phase loader expected the T3 phase")
        self.torch.mps.synchronize()
        if hasattr(self.shell.t3, "patched_model"):
            self.shell.t3.patched_model = None
            self.shell.t3.compiled = False
        self.shell.conds.t3 = self.shell.conds.t3.to(device="cpu")
        self.shell.t3.to_empty(device="meta")
        self.shell.t3 = None
        gc.collect()
        self.torch.mps.empty_cache()
        self.shell.s3gen = run_preserving_generation_rng(
            self.s3_factory, self.torch, self.numpy
        )
        for key, value in self.shell.conds.gen.items():
            if self.torch.is_tensor(value):
                self.shell.conds.gen[key] = value.to(device="mps")
        self.phase = "s3"

    def release_all_phases(self) -> None:
        if self.shell.s3gen is not None:
            for key, value in self.shell.conds.gen.items():
                if self.torch.is_tensor(value):
                    self.shell.conds.gen[key] = value.to(device="cpu")
            self.shell.s3gen.to_empty(device="meta")
            self.shell.s3gen = None
        if self.shell.t3 is not None:
            if hasattr(self.shell.t3, "patched_model"):
                self.shell.t3.patched_model = None
                self.shell.t3.compiled = False
            self.shell.conds.t3 = self.shell.conds.t3.to(device="cpu")
            self.shell.t3.to_empty(device="meta")
            self.shell.t3 = None
        self.phase = "empty"
        gc.collect()
        self.torch.mps.synchronize()
        self.torch.mps.empty_cache()

    def generate(self, **kwargs: Any) -> Any:
        if self.phase != "t3":
            raise RuntimeError("Narration generation requires a prepared T3 phase")
        try:
            return self.shell.generate(**kwargs)
        finally:
            self.release_all_phases()

    def _capture_one_speech_unit(
        self, kwargs: dict[str, Any], token_limit: int
    ) -> CapturedSpeechUnit:
        if self.phase != "t3" or self.shell.t3 is None or self.shell.s3gen is not None:
            raise RuntimeError("Speech-token capture requires only the T3 phase")
        active_t3 = self.shell.t3
        original_inference = active_t3.inference
        stop_speech_token = int(active_t3.hp.stop_speech_token)

        def bounded_inference(*args: Any, **inference_kwargs: Any) -> Any:
            requested = int(inference_kwargs.get("max_new_tokens") or token_limit)
            inference_kwargs["max_new_tokens"] = min(requested, token_limit)
            tokens = original_inference(*args, **inference_kwargs)
            token_count = int(tokens.shape[-1])
            last_token = int(tokens.reshape(-1)[-1].item())
            if token_count >= token_limit and last_token != stop_speech_token:
                raise RuntimeError(
                    f"Chatterbox decode reached {token_limit} speech tokens without EOS"
                )
            return tokens

        active_t3.inference = bounded_inference
        self.shell.s3gen = _SpeechTokenCaptureS3(self.torch, self.numpy)
        try:
            self.shell.generate(**kwargs)
        except SpeechTokenCaptureComplete as completed:
            return completed.captured
        else:
            raise RuntimeError("T3 phase completed without capturing speech tokens")
        finally:
            self.shell.s3gen = None
            active_t3.inference = original_inference
            if hasattr(active_t3, "patched_model"):
                active_t3.patched_model = None
                active_t3.compiled = False
            gc.collect()
            self.torch.mps.synchronize()
            self.torch.mps.empty_cache()

    def generate_phase_batch(
        self, items: list[dict[str, Any]]
    ) -> list[Any]:
        """Run several exact seeds with one T3 load followed by one S3 load."""
        if not self.phase_batched:
            raise RuntimeError("Phase batching was not selected for this model")
        if not items:
            return []
        captured: list[CapturedSpeechUnit] = []
        waveforms: list[Any] = []
        self.prepare_t3_phase()
        try:
            for item in items:
                seed_everything(int(item["seed"]), self.torch, self.numpy)
                captured.append(
                    self._capture_one_speech_unit(item["kwargs"], int(item["tokenLimit"]))
                )
            self.transition_to_s3_phase()
            for unit in captured:
                restore_generation_rng(unit.rng_state, self.torch, self.numpy)
                speech_tokens = unit.speech_tokens.to(device="mps")
                wav, _ = self.shell.s3gen.inference(
                    speech_tokens=speech_tokens,
                    ref_dict=self.shell.conds.gen,
                )
                raw = wav.squeeze(0).detach().cpu().numpy()
                if self.language == "de":
                    token_count = int(speech_tokens.shape[-1])
                    speech_length = max(1, token_count - 1)
                    raw = raw[: speech_length * (int(self.shell.sr) // S3_SPEECH_TOKEN_RATE)]
                watermarked = self.shell.watermarker.apply_watermark(
                    raw, sample_rate=self.shell.sr
                )
                waveforms.append(self.torch.from_numpy(watermarked).unsqueeze(0))
                del speech_tokens, wav, raw, watermarked
                gc.collect()
                self.torch.mps.synchronize()
                self.torch.mps.empty_cache()
            return waveforms
        finally:
            captured.clear()
            self.release_all_phases()


class CheckpointContinuation(RuntimeError):
    """Signal that one atomic unit checkpoint is ready for a fresh owned child."""

    def __init__(self, identifier: str, language: str, generation_ordinal: int) -> None:
        self.identifier = identifier
        self.language = language
        self.generation_ordinal = generation_ordinal
        super().__init__(
            f"{identifier}/{language}: checkpointed unit {generation_ordinal + 1}"
        )


def prepare_generation_phase(model: Any) -> None:
    if isinstance(model, MPSPhaseManagedChatterbox):
        model.prepare_t3_phase()


def transition_after_token_generation(model: Any, device: str, torch: Any) -> None:
    if isinstance(model, MPSPhaseManagedChatterbox):
        model.transition_to_s3_phase()
    else:
        release_inactive_mps_cache(device, torch)


def speech_token_limit(word_count: int, minimum_wpm: float) -> int:
    if word_count <= 0 or minimum_wpm <= 0:
        raise ValueError("Speech token limit requires positive words and cadence")
    expected_tokens = word_count * 60 / minimum_wpm * S3_SPEECH_TOKEN_RATE
    return max(192, min(600, math.ceil(expected_tokens * 1.6 + S3_SPEECH_TOKEN_RATE)))


def generate_with_token_limit(
    model: Any,
    kwargs: dict[str, Any],
    token_limit: int,
    after_token_generation: Callable[[], None] | None = None,
) -> Any:
    """Clamp Chatterbox's hardcoded 1,000-token decode and reject missing EOS."""
    if isinstance(model, MPSPhaseManagedChatterbox):
        active_t3 = model.t3
        t3_reference = weakref.ref(active_t3)
        unbound_inference = type(active_t3).inference
        stop_speech_token = int(active_t3.hp.stop_speech_token)

        def phase_bounded_inference(*args: Any, **inference_kwargs: Any) -> Any:
            requested = int(inference_kwargs.get("max_new_tokens") or token_limit)
            inference_kwargs["max_new_tokens"] = min(requested, token_limit)
            t3 = t3_reference()
            if t3 is None:
                raise RuntimeError("T3 phase ended before token generation")
            tokens = unbound_inference(t3, *args, **inference_kwargs)
            del t3
            token_count = int(tokens.shape[-1])
            last_token = int(tokens.reshape(-1)[-1].item())
            if token_count >= token_limit and last_token != stop_speech_token:
                raise RuntimeError(
                    f"Chatterbox decode reached {token_limit} speech tokens without EOS"
                )
            if after_token_generation is not None:
                after_token_generation()
            return tokens

        active_t3.inference = phase_bounded_inference
        del active_t3
        return model.generate(**kwargs)

    active_t3 = model.t3
    original_inference = active_t3.inference

    def bounded_inference(*args: Any, **inference_kwargs: Any) -> Any:
        requested = int(inference_kwargs.get("max_new_tokens") or token_limit)
        inference_kwargs["max_new_tokens"] = min(requested, token_limit)
        tokens = original_inference(*args, **inference_kwargs)
        token_count = int(tokens.shape[-1])
        last_token = int(tokens.reshape(-1)[-1].item())
        if token_count >= token_limit and last_token != int(model.t3.hp.stop_speech_token):
            raise RuntimeError(
                f"Chatterbox decode reached {token_limit} speech tokens without EOS"
            )
        if after_token_generation is not None:
            after_token_generation()
        return tokens

    active_t3.inference = bounded_inference
    try:
        return model.generate(**kwargs)
    finally:
        active_t3.inference = original_inference


def cleanup_stale_staging(output_root: Path, language: str) -> list[Path]:
    """Remove only interrupted, unpromoted staging directories for one language."""
    if output_root.is_symlink():
        raise RuntimeError("Narration output root must not be a symbolic link")
    if not output_root.exists():
        return []
    if not output_root.is_dir():
        raise RuntimeError("Narration output root must be a directory")
    pattern = re.compile(r"^\.(G(?:0[1-9]|[1-3][0-9]|4[0-2]))\.(en|de)\.[A-Za-z0-9_-]+$")
    resolved_root = output_root.resolve()
    removed: list[Path] = []
    for candidate in output_root.iterdir():
        match = pattern.fullmatch(candidate.name)
        if match is None or match.group(2) != language:
            continue
        if candidate.is_symlink() or not candidate.is_dir():
            raise RuntimeError(f"Unsafe narration staging entry: {candidate.name}")
        if candidate.parent.resolve() != resolved_root:
            raise RuntimeError(f"Narration staging entry escaped its output root: {candidate.name}")
        shutil.rmtree(candidate)
        removed.append(candidate)
    return removed


def seed_everything(seed: int, torch: Any, numpy: Any) -> None:
    random.seed(seed)
    numpy.random.seed(seed)
    torch.manual_seed(seed)
    if torch.backends.mps.is_available() and hasattr(torch, "mps"):
        torch.mps.manual_seed(seed)


def production_seed(
    direction: dict[str, Any],
    practice_ordinal: int,
    generation_ordinal: int,
    seed_offset: int = 0,
) -> int:
    if (
        not 1 <= practice_ordinal <= len(EXPECTED_IDS)
        or generation_ordinal < 0
        or not 0 <= seed_offset < 1000
    ):
        raise ValueError("Invalid production seed coordinates")
    return (
        int(direction["seedBase"])
        + (practice_ordinal - 1) * 1000
        + generation_ordinal
        + seed_offset
    )


def model_allow_patterns(language: str) -> list[str]:
    if language == "en":
        return [
            "ve.safetensors",
            "t3_cfg.safetensors",
            "s3gen.safetensors",
            "tokenizer.json",
            "conds.pt",
        ]
    return [
        "ve.pt",
        "t3_mtl23ls_v3.safetensors",
        "s3gen.pt",
        "conds.pt",
        "tokenizer.json",
        "Cangjie5_TC.json",
        "grapheme_mtl_merged_expanded_v1.json",
    ]


def silence_runs(samples: Any, sample_rate: int, numpy: Any) -> list[tuple[int, int]]:
    frame_size = max(1, round(sample_rate * 0.01))
    frame_count = samples.size // frame_size
    if frame_count < 10:
        return []
    framed = samples[: frame_count * frame_size].reshape(frame_count, frame_size)
    rms = numpy.sqrt(numpy.mean(numpy.square(framed), axis=1))
    peak_rms = float(numpy.max(rms))
    threshold = max(10 ** (-45.0 / 20.0), peak_rms * 0.055)
    quiet = rms <= threshold
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, is_quiet in enumerate(quiet):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if index - start >= 6:
                runs.append((start * frame_size, index * frame_size))
            start = None
    if start is not None and frame_count - start >= 6:
        runs.append((start * frame_size, frame_count * frame_size))
    edge = round(sample_rate * 0.16)
    return [(start, end) for start, end in runs if start > edge and end < samples.size - edge]


def semantic_pause_runs(samples: Any, sample_rate: int, numpy: Any) -> list[tuple[int, int]]:
    """Return short low-energy gaps suitable for punctuation-bound pause extension."""

    frame_size = max(1, round(sample_rate * 0.005))
    frame_count = samples.size // frame_size
    if frame_count < 20:
        return []
    framed = samples[: frame_count * frame_size].reshape(frame_count, frame_size)
    rms = numpy.sqrt(numpy.mean(numpy.square(framed), axis=1))
    peak_rms = float(numpy.max(rms))
    threshold = max(10 ** (-50.0 / 20.0), peak_rms * 0.12)
    quiet = rms <= threshold
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, is_quiet in enumerate(quiet):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if index - start >= 2:
                runs.append((start * frame_size, index * frame_size))
            start = None
    if start is not None and frame_count - start >= 2:
        runs.append((start * frame_size, frame_count * frame_size))
    edge = round(sample_rate * 0.08)
    return [(start, end) for start, end in runs if start > edge and end < samples.size - edge]


def match_semantic_pauses(
    samples: Any,
    boundaries: tuple[dict[str, Any], ...],
    sample_rate: int,
    numpy: Any,
) -> list[tuple[int, int]]:
    """Match ordered lexical boundaries to nearby low-energy waveform gaps."""

    candidates = semantic_pause_runs(samples, sample_rate, numpy)
    if not boundaries:
        return []
    candidate_centers = [
        (candidate[0] + candidate[1]) / 2 for candidate in candidates
    ]
    rows: list[dict[int, tuple[tuple[float, int, tuple[int, ...]], tuple[int, ...]]]] = []
    for boundary_index, boundary in enumerate(boundaries):
        after_word_index = int(boundary["afterWordIndex"])
        word_count = int(boundary["unitWordCount"])
        if not 0 < after_word_index < word_count:
            raise ValueError("Invalid semantic word-boundary metadata")
        expected_center = samples.size * after_word_index / word_count
        maximum_distance = max(sample_rate * 0.9, samples.size * 0.22)
        row: dict[int, tuple[tuple[float, int, tuple[int, ...]], tuple[int, ...]]] = {}
        for candidate_index, candidate in enumerate(candidates):
            distance = abs(candidate_centers[candidate_index] - expected_center)
            if distance > maximum_distance:
                continue
            duration = candidate[1] - candidate[0]
            if boundary_index == 0:
                path = (candidate_index,)
                row[candidate_index] = ((distance, -duration, path), path)
                continue
            compatible = [
                previous
                for previous_index, previous in rows[-1].items()
                if candidates[previous_index][1] <= candidate[0]
            ]
            if not compatible:
                continue
            previous_cost, previous_path = min(compatible, key=lambda item: item[0])
            path = (*previous_path, candidate_index)
            row[candidate_index] = (
                (
                    previous_cost[0] + distance,
                    previous_cost[1] - duration,
                    path,
                ),
                path,
            )
        if not row:
            raise ValueError(
                f"No low-energy gap found near semantic boundary after {boundary['after']!r}"
            )
        rows.append(row)
    _, chosen_indices = min(rows[-1].values(), key=lambda item: item[0])
    return [candidates[index] for index in chosen_indices]


def extend_semantic_pauses(
    samples: Any,
    boundaries: tuple[dict[str, Any], ...],
    direction: dict[str, Any],
    sample_rate: int,
    numpy: Any,
) -> tuple[Any, list[dict[str, Any]]]:
    if not boundaries:
        return samples, []
    chosen = match_semantic_pauses(samples, boundaries, sample_rate, numpy)
    records: list[dict[str, Any]] = []
    adjusted = samples
    added_before = 0
    for boundary, (start, end) in zip(boundaries, chosen, strict=True):
        target_key = "listPauseMs" if boundary["kind"] == "list" else "clausePauseMs"
        target_ms = int(direction[target_key])
        original_frames = end - start
        target_frames = round(sample_rate * target_ms / 1000)
        added_frames = max(0, target_frames - original_frames)
        insertion = end + added_before
        if added_frames:
            adjusted = numpy.concatenate(
                [
                    adjusted[:insertion],
                    numpy.zeros(added_frames, dtype=numpy.float32),
                    adjusted[insertion:],
                ]
            )
            added_before += added_frames
        realized_end_frame = insertion + added_frames
        records.append(
            {
                **boundary,
                "method": "lexically-expected-low-energy-gap-bounded-extension",
                "originalPauseMs": round(original_frames / sample_rate * 1000, 2),
                "addedSilenceMs": round(added_frames / sample_rate * 1000, 2),
                "realizedPauseMs": round(
                    (original_frames + added_frames) / sample_rate * 1000, 2
                ),
                "targetPauseMs": target_ms,
                "pauseEndFrame": realized_end_frame,
            }
        )
    return adjusted, records


def aggregate_cadence_padding_frames(
    spoken_word_count: int,
    speech_frames: int,
    sample_rate: int,
    maximum_wpm: float,
    boundary_count: int,
    maximum_per_boundary_ms: int = 250,
) -> list[int]:
    """Return bounded semantic-boundary padding for a slightly rushed full take.

    This never stretches speech. It only extends already aligned clause/list
    pauses, and refuses corrections too large to preserve natural prosody.
    """

    if boundary_count <= 0:
        return []
    target_wpm = maximum_wpm - 0.5
    target_frames = math.ceil(spoken_word_count * 60 * sample_rate / target_wpm)
    required_frames = max(0, target_frames - speech_frames)
    maximum_frames = round(sample_rate * maximum_per_boundary_ms / 1000)
    if required_frames > boundary_count * maximum_frames:
        return []
    base, remainder = divmod(required_frames, boundary_count)
    return [base + (1 if index < remainder else 0) for index in range(boundary_count)]


def signal_measurements(samples: Any, sample_rate: int, numpy: Any) -> dict[str, Any]:
    nonfinite = int((~numpy.isfinite(samples)).sum())
    if nonfinite:
        raise ValueError(f"Generated waveform contains {nonfinite} non-finite samples")
    peak = float(numpy.max(numpy.abs(samples))) if samples.size else 0.0
    rms = float(numpy.sqrt(numpy.mean(numpy.square(samples)))) if samples.size else 0.0
    runs = silence_runs(samples, sample_rate, numpy)
    longest = max((end - start for start, end in runs), default=0) / sample_rate
    return {
        "frames": int(samples.size),
        "durationSeconds": round(float(samples.size) / sample_rate, 6),
        "peakLinear": round(peak, 8),
        "peakDBFS": round(20 * math.log10(max(peak, 1e-12)), 3),
        "rmsDBFS": round(20 * math.log10(max(rms, 1e-12)), 3),
        "clippedInputSamples": int(((samples < -1.0) | (samples > 1.0)).sum()),
        "longestInternalSilenceSeconds": round(longest, 4),
    }


def run_checked(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            arguments,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()[-4000:]
        raise RuntimeError(f"Command failed: {arguments[0]}\n{detail}") from error


def preflight_delivery_encoder(
    plan: dict[str, Any], ffmpeg: str, ffprobe: str
) -> None:
    mastering = plan["mastering"]
    with tempfile.TemporaryDirectory(prefix="arrive-narration-encoder-") as directory:
        probe_path = Path(directory) / "probe.m4a"
        run_checked(
            [
                ffmpeg,
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=r={mastering['deliverySampleRate']}:cl=mono",
                "-t",
                "0.25",
                "-c:a",
                mastering["deliveryEncoder"],
                "-aac_at_mode",
                mastering["deliveryRateControl"],
                "-b:a",
                str(mastering["deliveryBitrateBPS"]),
                str(probe_path),
            ]
        )
        probe = probe_audio(probe_path, ffprobe)
        if (
            probe["codec"] != mastering["deliveryCodec"]
            or probe["sampleRate"] != mastering["deliverySampleRate"]
            or probe["channels"] != 1
        ):
            raise RuntimeError("Delivery encoder preflight returned an unexpected format")


def loudness_measurements(path: Path, ffmpeg: str) -> dict[str, float]:
    completed = run_checked(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "loudnorm=I=-19:TP=-2:LRA=7:print_format=json",
            "-f",
            "null",
            "-",
        ]
    )
    candidates = re.findall(r"\{\s*\"input_i\".*?\}", completed.stderr, flags=re.DOTALL)
    if not candidates:
        raise RuntimeError(f"FFmpeg did not return loudness JSON for {path.name}")
    measured = json.loads(candidates[-1])
    return {
        "integratedLUFS": float(measured["input_i"]),
        "truePeakDBTP": float(measured["input_tp"]),
        "loudnessRangeLU": float(measured["input_lra"]),
        "thresholdLUFS": float(measured["input_thresh"]),
        "targetOffsetLU": float(measured["target_offset"]),
    }


def probe_audio(path: Path, ffprobe: str) -> dict[str, Any]:
    completed = run_checked(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,duration,bit_rate",
            "-show_entries",
            "format=duration,bit_rate",
            "-of",
            "json",
            str(path),
        ]
    )
    document = json.loads(completed.stdout)
    streams = document.get("streams", [])
    if len(streams) != 1:
        raise ValueError(f"Expected one audio stream in {path.name}")
    stream = streams[0]
    return {
        "codec": stream.get("codec_name"),
        "sampleRate": int(stream.get("sample_rate", 0)),
        "channels": int(stream.get("channels", 0)),
        "durationSeconds": round(float(stream.get("duration") or document["format"]["duration"]), 6),
        "bitrateBPS": int(stream.get("bit_rate") or document["format"].get("bit_rate") or 0),
    }


def master_and_encode(
    raw_path: Path,
    master_path: Path,
    delivery_path: Path,
    plan: dict[str, Any],
    ffmpeg: str,
    ffprobe: str,
) -> dict[str, Any]:
    mastering = plan["mastering"]
    first = loudness_measurements(raw_path, ffmpeg)
    target_i = float(mastering["integratedLUFSTarget"])
    target_tp = float(mastering["masterTruePeakTargetDBTP"])
    target_lra = float(mastering["loudnessRangeTargetLU"])
    loudnorm = (
        f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}:"
        f"measured_I={first['integratedLUFS']}:measured_TP={first['truePeakDBTP']}:"
        f"measured_LRA={first['loudnessRangeLU']}:measured_thresh={first['thresholdLUFS']}:"
        f"offset={first['targetOffsetLU']}:linear=true:print_format=summary"
    )
    run_checked(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(raw_path),
            "-map_metadata",
            "-1",
            "-af",
            loudnorm,
            "-ar",
            str(plan["generation"]["sampleRate"]),
            "-ac",
            "1",
            "-c:a",
            mastering["masterCodec"],
            str(master_path),
        ]
    )
    def encode_delivery(gain_db: float) -> None:
        gain_text = f"{gain_db:.3f}".rstrip("0").rstrip(".")
        run_checked(
            [
                ffmpeg,
                "-hide_banner",
                "-nostdin",
                "-y",
                "-i",
                str(master_path),
                "-map_metadata",
                "-1",
                "-af",
                f"volume={gain_text}dB",
                "-ar",
                str(mastering["deliverySampleRate"]),
                "-ac",
                "1",
                "-c:a",
                mastering["deliveryEncoder"],
                "-aac_at_mode",
                mastering["deliveryRateControl"],
                "-b:a",
                str(mastering["deliveryBitrateBPS"]),
                "-movflags",
                "+faststart",
                str(delivery_path),
            ]
        )
        delivery_path.chmod(0o600)

    master_path.chmod(0o600)
    delivery_gain_db = AAC_DELIVERY_SAFETY_GAIN_DB
    encode_delivery(delivery_gain_db)
    master_probe = probe_audio(master_path, ffprobe)
    master_loudness = loudness_measurements(master_path, ffmpeg)
    delivery_loudness = loudness_measurements(delivery_path, ffmpeg)
    minimum = float(mastering["integratedLUFSMinimum"])
    maximum = float(mastering["integratedLUFSMaximum"])
    peak_maximum = float(mastering["deliveryTruePeakMaximumDBTP"])
    if delivery_loudness["truePeakDBTP"] > peak_maximum:
        overshoot_db = delivery_loudness["truePeakDBTP"] - peak_maximum
        delivery_gain_db -= overshoot_db + 0.1
        encode_delivery(delivery_gain_db)
        delivery_loudness = loudness_measurements(delivery_path, ffmpeg)
    delivery_probe = probe_audio(delivery_path, ffprobe)
    if not minimum <= master_loudness["integratedLUFS"] <= maximum:
        raise ValueError("Master integrated loudness is outside the accepted band")
    if not minimum <= delivery_loudness["integratedLUFS"] <= maximum:
        raise ValueError("Delivery integrated loudness is outside the accepted band")
    if master_loudness["truePeakDBTP"] > peak_maximum:
        raise ValueError("Master true peak exceeds the delivery ceiling")
    if delivery_loudness["truePeakDBTP"] > peak_maximum:
        raise ValueError("AAC delivery true peak exceeds the delivery ceiling")
    bitrate = delivery_probe["bitrateBPS"]
    if not int(mastering["deliveryBitrateMinimumBPS"]) <= bitrate <= int(
        mastering["deliveryBitrateMaximumBPS"]
    ):
        raise ValueError(f"AAC bitrate outside the accepted range: {bitrate}")
    if abs(master_probe["durationSeconds"] - delivery_probe["durationSeconds"]) > 0.12:
        raise ValueError("Master and AAC delivery durations disagree")
    return {
        "firstPass": first,
        "master": {**master_probe, **master_loudness},
        "delivery": {**delivery_probe, **delivery_loudness},
        "deliveryCodecSafetyGainDB": round(delivery_gain_db, 3),
    }


def format_vtt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{milliseconds:03d}"


def write_vtt(path: Path, cues: list[dict[str, Any]]) -> None:
    lines = ["WEBVTT", ""]
    for index, cue in enumerate(cues, start=1):
        lines.extend(
            [
                str(index),
                f"{format_vtt_time(cue['startSeconds'])} --> {format_vtt_time(cue['endSeconds'])}",
                cue["text"],
                "",
            ]
        )
    path.write_text("\n".join(lines), encoding="utf-8")
    path.chmod(0o600)


def existing_track_is_valid(
    track_root: Path,
    plan_hash: str,
    catalog_hash: str,
    script_hash: str,
    attested_track: dict[str, Any] | None = None,
) -> bool:
    manifest_path = track_root / "manifest.json"
    if not manifest_path.is_file():
        return False
    try:
        manifest = load_json(manifest_path)
        if (
            manifest.get("planSHA256") != plan_hash
            or manifest.get("catalogSHA256") != catalog_hash
            or manifest.get("scriptSHA256") != script_hash
        ):
            return False
        if attested_track is not None:
            require_attested_regular_file(
                attested_track.get("manifest", {}), manifest_path
            )
        for role, record in manifest.get("files", {}).items():
            path = track_root / record["name"]
            actual = (
                require_attested_regular_file(
                    attested_track.get("files", {}).get(role, {}),
                    path,
                    record["sha256"],
                )
                if attested_track is not None
                else sha256(path)
            )
            if actual != record["sha256"]:
                return False
        return True
    except (KeyError, OSError, ValueError, json.JSONDecodeError):
        return False


def gap_after_sentence(
    events: list[SentenceEvent | PauseEvent], index: int, direction: dict[str, Any]
) -> int:
    if index >= len(events) - 1 or not isinstance(events[index + 1], SentenceEvent):
        return 0
    current = events[index]
    following = events[index + 1]
    if not isinstance(current, SentenceEvent):
        return 0
    key = "sentenceGapMs" if current.paragraph_index == following.paragraph_index else "paragraphGapMs"
    return int(direction[key])


def proportional_pause_allocation(
    original_frames: list[int], required_total_frames: int
) -> list[int]:
    if not original_frames or any(frames <= 0 for frames in original_frames):
        raise ValueError("Authored pause allocation requires positive source pauses")
    if required_total_frames <= 0:
        raise ValueError("Authored pause allocation requires a positive target")
    original_total = sum(original_frames)
    allocated: list[int] = []
    cumulative_original = 0
    cumulative_allocated = 0
    for frames in original_frames:
        cumulative_original += frames
        cumulative_target = round(
            required_total_frames * cumulative_original / original_total
        )
        allocated.append(cumulative_target - cumulative_allocated)
        cumulative_allocated = cumulative_target
    if sum(allocated) != required_total_frames or any(frames <= 0 for frames in allocated):
        raise ValueError("Authored pause allocation could not preserve positive pauses")
    return allocated


def planned_checkpoint_units(
    events: list[SentenceEvent | PauseEvent],
    language: str,
    direction: dict[str, Any],
    practice_ordinal: int,
    seed_offset: int,
    generation_plan: list[tuple[SentenceEvent, int, GenerationUnit]] | None = None,
) -> list[dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    minimum_wpm = float(direction["speechOnlyWPMRange"][0])
    resolved_plan = generation_plan or planned_generation_units(events, language)
    for generation_ordinal, (event, unit_index, unit) in enumerate(resolved_plan):
        planned.append(
            {
                "generationOrdinal": generation_ordinal,
                "sentenceIndex": event.sentence_index,
                "unitIndex": unit_index,
                "seed": production_seed(
                    direction,
                    practice_ordinal,
                    generation_ordinal,
                    seed_offset,
                ),
                "sourceTextSHA256": text_sha256(unit.source_text),
                "generationTextSHA256": text_sha256(unit.generation_text),
                "speechTokenLimit": speech_token_limit(
                    len(words(unit.source_text)), minimum_wpm
                ),
            }
        )
    return planned


def planned_generation_units(
    events: list[SentenceEvent | PauseEvent], language: str
) -> list[tuple[SentenceEvent, int, GenerationUnit]]:
    return [
        (event, unit_index, unit)
        for event in events
        if isinstance(event, SentenceEvent)
        for unit_index, unit in enumerate(generation_units(event.text, language))
    ]


def checkpoint_prefix_length(
    root: Path, expected_units: list[dict[str, Any]]
) -> int:
    """Validate an immutable contiguous prefix without replaying its PCM payload.

    The lifecycle guard hashes every checkpoint immediately before and after the
    child. This child-side pass independently binds paths and metadata to the
    exact generation plan, then lets a continuation child generate only the
    first missing unit. Full PCM loading and waveform assembly still happen once
    when the prefix is complete.
    """

    unit_roots = sorted(root.glob("unit-*"))
    if len(unit_roots) > len(expected_units):
        raise RuntimeError("Narration checkpoint prefix exceeds the generation plan")
    for ordinal, unit_root in enumerate(unit_roots):
        if (
            unit_root.name != f"unit-{ordinal:04d}"
            or unit_root.is_symlink()
            or not unit_root.is_dir()
        ):
            raise RuntimeError("Narration checkpoint prefix is not contiguous and safe")
        metadata_path = unit_root / "metadata.json"
        pcm_path = unit_root / "pcm.npy"
        if any(path.is_symlink() or not path.is_file() for path in (metadata_path, pcm_path)):
            raise RuntimeError("Narration checkpoint prefix contains an unsafe file")
        metadata = load_json(metadata_path)
        if any(metadata.get(key) != value for key, value in expected_units[ordinal].items()):
            raise RuntimeError("Narration checkpoint prefix metadata mismatch")
        if (
            not isinstance(metadata.get("sampleCount"), int)
            or metadata["sampleCount"] <= 0
            or not isinstance(metadata.get("pcmFloat32SHA256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", metadata["pcmFloat32SHA256"]) is None
        ):
            raise RuntimeError("Narration checkpoint prefix metadata is incomplete")
    return len(unit_roots)


def generate_next_checkpoint_only(
    generation_plan: list[tuple[SentenceEvent, int, GenerationUnit]],
    planned_units: list[dict[str, Any]],
    checkpoint_root: Path,
    identifier: str,
    language: str,
    model_factory: Callable[[], Any],
    plan: dict[str, Any],
    environment: dict[str, str],
    torch: Any,
    numpy: Any,
    new_units_per_child: int = 1,
) -> None:
    prefix_length = checkpoint_prefix_length(checkpoint_root, planned_units)
    if prefix_length == len(planned_units):
        return
    direction = plan["directions"][language]
    model = model_factory()
    generated_count = min(new_units_per_child, len(planned_units) - prefix_length)
    last_ordinal = prefix_length
    try:
        ordinals = list(range(prefix_length, prefix_length + generated_count))
        if isinstance(model, MPSPhaseManagedChatterbox) and model.phase_batched:
            batch: list[dict[str, Any]] = []
            for ordinal in ordinals:
                _, _, unit = generation_plan[ordinal]
                checkpoint_metadata = planned_units[ordinal]
                kwargs: dict[str, Any] = {
                    "text": unit.generation_text,
                    "repetition_penalty": plan["generation"]["repetitionPenalty"],
                    "min_p": plan["generation"]["minP"],
                    "top_p": plan["generation"]["topP"],
                    "exaggeration": direction["exaggeration"],
                    "cfg_weight": direction["cfgWeight"],
                    "temperature": direction["temperature"],
                }
                if language == "de":
                    kwargs["language_id"] = "de"
                batch.append(
                    {
                        "seed": checkpoint_metadata["seed"],
                        "kwargs": kwargs,
                        "tokenLimit": checkpoint_metadata["speechTokenLimit"],
                    }
                )
            waveforms = model.generate_phase_batch(batch)
        else:
            waveforms = []
        for batch_index, ordinal in enumerate(ordinals):
            _, _, unit = generation_plan[ordinal]
            checkpoint_metadata = planned_units[ordinal]
            kwargs: dict[str, Any] = {
                "text": unit.generation_text,
                "repetition_penalty": plan["generation"]["repetitionPenalty"],
                "min_p": plan["generation"]["minP"],
                "top_p": plan["generation"]["topP"],
                "exaggeration": direction["exaggeration"],
                "cfg_weight": direction["cfgWeight"],
                "temperature": direction["temperature"],
            }
            if language == "de":
                kwargs["language_id"] = "de"
            waveform: Any | None = None
            try:
                if waveforms:
                    waveform = waveforms[batch_index]
                else:
                    seed_everything(checkpoint_metadata["seed"], torch, numpy)
                    prepare_generation_phase(model)
                    waveform = generate_with_token_limit(
                        model,
                        kwargs,
                        checkpoint_metadata["speechTokenLimit"],
                        lambda: transition_after_token_generation(
                            model, environment["device"], torch
                        ),
                    )
                raw = waveform.detach().cpu().float().reshape(-1).numpy()
                write_unit_checkpoint(
                    checkpoint_root,
                    ordinal,
                    checkpoint_metadata,
                    raw,
                    numpy,
                )
                print(
                    f"checkpointed {identifier}/{language} unit {ordinal + 1} "
                    f"after validating {prefix_length} prefix units without PCM replay",
                    flush=True,
                )
                del raw
                last_ordinal = ordinal
            finally:
                if waveform is not None:
                    del waveform
                if not waveforms:
                    release_accelerator_cache(model, environment["device"], torch)
        waveforms.clear()
    finally:
        if hasattr(model, "release_all_phases"):
            model.release_all_phases()
        del model
        gc.collect()
    raise CheckpointContinuation(identifier, language, last_ordinal)


def generate_track(
    practice: dict[str, Any],
    language: str,
    model_factory: Callable[[], Any],
    plan: dict[str, Any],
    plan_hash: str,
    catalog_hash: str,
    model_hashes: dict[str, str],
    environment: dict[str, str],
    output_root: Path,
    ffmpeg: str,
    ffprobe: str,
    torch: Any,
    numpy: Any,
    soundfile: Any,
    seed_offset: int,
    one_new_unit_per_child: bool,
    new_units_per_child: int,
) -> dict[str, Any]:
    identifier = practice["id"]
    localized = practice["localized"][language]
    script_path = PROJECT_ROOT / localized["scriptPath"]
    script_hash = sha256(script_path)
    metadata, events = parse_script(script_path)
    expected_metadata = {
        "id": identifier,
        "language": language,
        "revision": str(localized["scriptRevision"]),
        "status": localized["editorialState"],
        "target_minutes": str(practice["targetMinutes"]),
    }
    for key, value in expected_metadata.items():
        if metadata.get(key) != value:
            raise ValueError(f"{identifier}/{language}: script metadata mismatch for {key}")

    direction = plan["directions"][language]
    sample_rate = int(plan["generation"]["sampleRate"])
    practice_ordinal = int(identifier[1:])
    assembled: list[Any] = []
    cues: list[dict[str, Any]] = []
    segment_records: list[dict[str, Any]] = []
    pause_records: list[dict[str, Any]] = []
    script_pause_components: list[dict[str, Any]] = []
    semantic_boundaries: list[dict[str, Any]] = []
    current_frames = 0
    speech_frames = 0
    spoken_word_count = 0
    generation_ordinal = 0
    generation_calls_since_load = 0
    generation_calls_in_process = 0
    model_reload_count = 0
    model: Any | None = None
    raw_clipping_attention = False
    dropout_attention = False
    checkpoint_root = unit_checkpoint_root(output_root, identifier, language)
    generation_plan = planned_generation_units(events, language)
    planned_units = planned_checkpoint_units(
        events,
        language,
        direction,
        practice_ordinal,
        seed_offset,
        generation_plan,
    )
    prepare_unit_checkpoint_cache(
        checkpoint_root,
        unit_checkpoint_identity(
            identifier,
            language,
            plan_hash,
            catalog_hash,
            script_hash,
            model_hashes,
            seed_offset,
            str(
                environment.get(
                    "generationSemanticsRevision", GENERATION_SEMANTICS_REVISION
                )
            ),
        ),
        planned_units,
    )
    if one_new_unit_per_child:
        if load_guard_integrity_attestation() is None:
            raise RuntimeError(
                "Checkpoint-only continuation requires guard integrity attestation"
            )
        generate_next_checkpoint_only(
            generation_plan,
            planned_units,
            checkpoint_root,
            identifier,
            language,
            model_factory,
            plan,
            environment,
            torch,
            numpy,
            new_units_per_child,
        )

    for event_index, event in enumerate(events):
        if isinstance(event, PauseEvent):
            frames = round(sample_rate * event.seconds)
            assembled.append(numpy.zeros(frames, dtype=numpy.float32))
            record = {
                "kind": "script-directive",
                "startFrame": current_frames,
                "originalDurationSeconds": event.seconds,
                "durationSeconds": event.seconds,
            }
            pause_records.append(record)
            script_pause_components.append(
                {
                    "assembledIndex": len(assembled) - 1,
                    "originalStartFrame": current_frames,
                    "originalFrames": frames,
                    "record": record,
                }
            )
            current_frames += frames
            continue

        sentence_start = current_frames
        sentence_words = words(event.text)
        spoken_word_count += len(sentence_words)
        units = generation_units(event.text, language)
        for unit_index, unit in enumerate(units):
            seed = production_seed(
                direction,
                practice_ordinal,
                generation_ordinal,
                seed_offset,
            )
            kwargs: dict[str, Any] = {
                "text": unit.generation_text,
                "repetition_penalty": plan["generation"]["repetitionPenalty"],
                "min_p": plan["generation"]["minP"],
                "top_p": plan["generation"]["topP"],
                "exaggeration": direction["exaggeration"],
                "cfg_weight": direction["cfgWeight"],
                "temperature": direction["temperature"],
            }
            if language == "de":
                kwargs["language_id"] = "de"
            minimum_wpm = float(direction["speechOnlyWPMRange"][0])
            unit_token_limit = speech_token_limit(len(words(unit.source_text)), minimum_wpm)
            checkpoint_metadata = {
                "generationOrdinal": generation_ordinal,
                "sentenceIndex": event.sentence_index,
                "unitIndex": unit_index,
                "seed": seed,
                "sourceTextSHA256": text_sha256(unit.source_text),
                "generationTextSHA256": text_sha256(unit.generation_text),
                "speechTokenLimit": unit_token_limit,
            }
            raw = load_unit_checkpoint(
                checkpoint_root,
                generation_ordinal,
                checkpoint_metadata,
                numpy,
            )
            if raw is None:
                if model is None:
                    model = model_factory()
                seed_everything(seed, torch, numpy)
                prepare_generation_phase(model)
                waveform = generate_with_token_limit(
                    model,
                    kwargs,
                    unit_token_limit,
                    lambda: transition_after_token_generation(
                        model, environment["device"], torch
                    ),
                )
                raw = waveform.detach().cpu().float().reshape(-1).numpy()
                del waveform
                write_unit_checkpoint(
                    checkpoint_root,
                    generation_ordinal,
                    checkpoint_metadata,
                    raw,
                    numpy,
                )
                print(
                    f"checkpointed {identifier}/{language} unit {generation_ordinal + 1}",
                    flush=True,
                )
                release_accelerator_cache(model, environment["device"], torch)
                generation_calls_since_load += 1
                generation_calls_in_process += 1
                if one_new_unit_per_child:
                    raise CheckpointContinuation(
                        identifier, language, generation_ordinal
                    )
                if should_reload_model(environment["device"], generation_calls_since_load):
                    loaded_model = model
                    model = None
                    del loaded_model
                    gc.collect()
                    torch.mps.synchronize()
                    torch.mps.empty_cache()
                    generation_calls_since_load = 0
                    model_reload_count += 1
            else:
                print(
                    f"resumed {identifier}/{language} unit {generation_ordinal + 1}",
                    flush=True,
                )
            unit_start_frame = current_frames
            adjusted, internal_pauses = extend_semantic_pauses(
                raw,
                unit.internal_boundaries,
                direction,
                sample_rate,
                numpy,
            )
            measurements = signal_measurements(adjusted, sample_rate, numpy)
            unit_word_count = len(words(unit.source_text))
            unit_wpm = unit_word_count / measurements["durationSeconds"] * 60.0
            minimum_wpm, maximum_wpm = direction["speechOnlyWPMRange"]
            wpm_attention = not minimum_wpm * 0.65 <= unit_wpm <= maximum_wpm * 1.35
            permitted_internal_silence = max(
                [record["targetPauseMs"] / 1000 for record in internal_pauses] or [0.0]
            )
            segment_dropout = measurements["longestInternalSilenceSeconds"] > max(
                3.0, permitted_internal_silence + 1.25
            )
            raw_clipping_attention = raw_clipping_attention or measurements["clippedInputSamples"] > 0
            dropout_attention = dropout_attention or segment_dropout
            assembled.append(adjusted)
            for record in internal_pauses:
                semantic_boundaries.append(
                    {
                        "originalFrame": unit_start_frame + int(record.pop("pauseEndFrame")),
                        "record": record,
                    }
                )
            current_frames += int(adjusted.size)
            speech_frames += int(adjusted.size)
            segment_records.append(
                {
                    "sentenceIndex": event.sentence_index,
                    "unitIndex": unit_index,
                    "seed": seed,
                    "languageID": "de" if language == "de" else None,
                    "sourceTextSHA256": text_sha256(unit.source_text),
                    "generationTextSHA256": text_sha256(unit.generation_text),
                    "wordCount": unit_word_count,
                    "speechTokenLimit": unit_token_limit,
                    "wordsPerMinute": round(unit_wpm, 2),
                    "wpmAttention": wpm_attention,
                    "dropoutAttention": segment_dropout,
                    "internalSemanticPauses": internal_pauses,
                    **measurements,
                }
            )
            generation_ordinal += 1
            if unit.gap_after:
                target_key = (
                    "listPauseMs" if unit.gap_after["kind"] == "list" else "clausePauseMs"
                )
                gap_ms = int(direction[target_key])
                frames = round(sample_rate * gap_ms / 1000)
                assembled.append(numpy.zeros(frames, dtype=numpy.float32))
                current_frames += frames
                speech_frames += frames
                record = {
                        **unit.gap_after,
                        "kind": f"semantic-{unit.gap_after['kind']}",
                        "method": "explicit-aligned-unit-boundary",
                        "durationSeconds": round(gap_ms / 1000, 3),
                    }
                pause_records.append(record)
                semantic_boundaries.append(
                    {
                        "originalFrame": current_frames,
                        "record": record,
                    }
                )

        sentence_end = current_frames
        cues.append(
            {
                "sentenceIndex": event.sentence_index,
                "startFrame": sentence_start,
                "endFrame": sentence_end,
                "text": event.text,
                "textSHA256": text_sha256(event.text),
            }
        )
        gap_ms = gap_after_sentence(events, event_index, direction)
        if gap_ms:
            frames = round(sample_rate * gap_ms / 1000)
            assembled.append(numpy.zeros(frames, dtype=numpy.float32))
            current_frames += frames
            pause_records.append(
                {
                    "kind": "sentence-or-paragraph",
                    "durationSeconds": round(gap_ms / 1000, 3),
                }
            )

    if model is not None:
        release_accelerator_cache(model, environment["device"], torch)
        loaded_model = model
        model = None
        del loaded_model
        gc.collect()
        if environment["device"] == "mps":
            torch.mps.synchronize()
            torch.mps.empty_cache()

    if dropout_attention:
        raise ValueError(f"{identifier}/{language}: generated speech contains dropout attention")
    speech_seconds = speech_frames / sample_rate
    speech_wpm = spoken_word_count / speech_seconds * 60.0
    minimum_wpm, maximum_wpm = direction["speechOnlyWPMRange"]
    cadence_insertions: list[dict[str, Any]] = []
    if language == "en" and speech_wpm > maximum_wpm:
        padding = aggregate_cadence_padding_frames(
            spoken_word_count,
            speech_frames,
            sample_rate,
            float(maximum_wpm),
            len(semantic_boundaries),
        )
        if padding:
            for boundary, frames in zip(semantic_boundaries, padding, strict=True):
                if frames <= 0:
                    continue
                record = boundary["record"]
                added_ms = frames / sample_rate * 1000
                record["cadenceCorrectionAddedMs"] = round(added_ms, 2)
                record["method"] = f"{record['method']}-plus-bounded-aggregate-cadence-correction"
                if "realizedPauseMs" in record:
                    record["realizedPauseMs"] = round(
                        float(record["realizedPauseMs"]) + added_ms, 2
                    )
                else:
                    record["durationSeconds"] = round(
                        float(record["durationSeconds"]) + frames / sample_rate, 6
                    )
                cadence_insertions.append(
                    {"originalFrame": int(boundary["originalFrame"]), "frames": frames}
                )
            added_frames = sum(int(item["frames"]) for item in cadence_insertions)
            speech_frames += added_frames
            current_frames += added_frames
            speech_seconds = speech_frames / sample_rate
            speech_wpm = spoken_word_count / speech_seconds * 60.0
    if not minimum_wpm <= speech_wpm <= maximum_wpm:
        raise ValueError(
            f"{identifier}/{language}: speech-only cadence {speech_wpm:.2f} WPM "
            f"misses selected direction range {minimum_wpm}-{maximum_wpm} WPM"
        )
    target_frames = int(practice["targetMinutes"]) * 60 * sample_rate
    original_script_frames = sum(
        int(component["originalFrames"]) for component in script_pause_components
    )
    non_script_frames = current_frames - original_script_frames
    required_script_frames = target_frames - non_script_frames
    if original_script_frames <= 0 or required_script_frames <= 0:
        raise ValueError(
            f"{identifier}/{language}: spoken content and selected cadence leave no "
            "positive authored-pause allocation inside the catalog duration"
        )

    allocated_pauses = proportional_pause_allocation(
        [int(component["originalFrames"]) for component in script_pause_components],
        required_script_frames,
    )
    for component, allocated_frames in zip(
        script_pause_components, allocated_pauses, strict=True
    ):
        component["allocatedFrames"] = allocated_frames
        assembled[int(component["assembledIndex"])] = numpy.zeros(
            allocated_frames, dtype=numpy.float32
        )
        record = component["record"]
        record["durationSeconds"] = round(allocated_frames / sample_rate, 6)
        record["allocationScale"] = round(
            required_script_frames / original_script_frames, 8
        )

    def remap_frame(original_frame: int) -> int:
        delta = 0
        for component in script_pause_components:
            original_end = int(component["originalStartFrame"]) + int(
                component["originalFrames"]
            )
            if original_end > original_frame:
                break
            delta += int(component["allocatedFrames"]) - int(component["originalFrames"])
        return original_frame + delta

    def remap_with_cadence(original_frame: int) -> int:
        return remap_frame(original_frame) + sum(
            int(item["frames"])
            for item in cadence_insertions
            if int(item["originalFrame"]) <= original_frame
        )

    for cue in cues:
        cue["startSeconds"] = round(
            remap_with_cadence(int(cue.pop("startFrame"))) / sample_rate, 6
        )
        cue["endSeconds"] = round(
            remap_with_cadence(int(cue.pop("endFrame"))) / sample_rate, 6
        )
    for component in script_pause_components:
        record = component["record"]
        record["startSeconds"] = round(
            remap_with_cadence(int(record.pop("startFrame"))) / sample_rate, 6
        )

    current_frames = target_frames
    joined = numpy.concatenate(assembled)
    if cadence_insertions:
        pieces: list[Any] = []
        previous_frame = 0
        for insertion in sorted(cadence_insertions, key=lambda item: int(item["originalFrame"])):
            frame = remap_frame(int(insertion["originalFrame"]))
            pieces.append(joined[previous_frame:frame])
            pieces.append(numpy.zeros(int(insertion["frames"]), dtype=numpy.float32))
            previous_frame = frame
        pieces.append(joined[previous_frame:])
        joined = numpy.concatenate(pieces)
    if int(joined.size) != target_frames:
        raise ValueError(f"{identifier}/{language}: deterministic pause allocation drifted")
    track_root = output_root / identifier / language
    if track_root.exists():
        raise FileExistsError(f"Refusing to replace existing candidate: {identifier}/{language}")
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_root.chmod(0o700)
    temporary_root = Path(
        tempfile.mkdtemp(prefix=f".{identifier}.{language}.", dir=output_root)
    )
    temporary_root.chmod(0o700)
    raw_path = temporary_root / "assembled.float.wav"
    master_path = temporary_root / "master.wav"
    delivery_path = temporary_root / "delivery.m4a"
    transcript_path = temporary_root / "transcript.vtt"
    manifest_path = temporary_root / "manifest.json"
    soundfile.write(raw_path, joined, sample_rate, format="WAV", subtype="FLOAT")
    raw_path.chmod(0o600)
    raw_measurements = {
        **signal_measurements(joined, sample_rate, numpy),
        "sha256": sha256(raw_path),
        "bytes": raw_path.stat().st_size,
    }
    mastered = master_and_encode(
        raw_path, master_path, delivery_path, plan, ffmpeg, ffprobe
    )
    write_vtt(transcript_path, cues)
    target_seconds = int(practice["targetMinutes"]) * 60
    delivery_duration = mastered["delivery"]["durationSeconds"]
    if abs(delivery_duration - target_seconds) > float(
        plan["generation"]["durationTargetToleranceSeconds"]
    ):
        raise ValueError(
            f"{identifier}/{language}: {delivery_duration:.1f}s misses the catalog duration"
        )
    overall_wpm = spoken_word_count / delivery_duration * 60.0
    files = {
        "raw": raw_path,
        "master": master_path,
        "delivery": delivery_path,
        "transcript": transcript_path,
    }
    file_records = {
        key: {
            "name": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        for key, path in files.items()
    }
    manifest = {
        "schemaVersion": 1,
        "productionVersion": plan["productionVersion"],
        "generationSeedOffset": seed_offset,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "contentID": identifier,
        "language": language,
        "title": localized["title"],
        "targetMinutes": practice["targetMinutes"],
        "scriptRevision": localized["scriptRevision"],
        "editorialState": localized["editorialState"],
        "scriptSHA256": script_hash,
        "catalogSHA256": catalog_hash,
        "planSHA256": plan_hash,
        "direction": direction,
        "rights": plan["rights"],
        "humanGates": plan["humanGates"],
        "source": plan["source"],
        "model": plan["model"],
        "modelFileSHA256": model_hashes,
        "environment": environment,
        "processBoundary": process_boundary_evidence(
            language,
            generation_ordinal,
            generation_calls_in_process,
            model_reload_count,
            one_new_unit_per_child,
            new_units_per_child,
            str(environment.get("mpsResidencyStrategy", "phase-per-unit")),
        ),
        "assembly": {
            "wholeTrackBeforeMastering": True,
            "timeStretch": "none",
            "perChunkNormalization": "none",
            "sampleRate": sample_rate,
            "channels": 1,
            "wordCount": spoken_word_count,
            "speechDurationSeconds": round(speech_seconds, 6),
            "durationSeconds": delivery_duration,
            "speechOnlyWordsPerMinute": round(speech_wpm, 2),
            "overallWordsPerMinute": round(overall_wpm, 2),
            "rawClippingAttention": raw_clipping_attention,
            "dropoutAttention": dropout_attention,
            "scriptPauseAllocation": plan["generation"]["scriptPauseAllocation"],
            "scriptPauseOriginalSeconds": round(original_script_frames / sample_rate, 6),
            "scriptPauseAllocatedSeconds": round(required_script_frames / sample_rate, 6),
            "scriptPauseAllocationScale": round(
                required_script_frames / original_script_frames, 8
            ),
        },
        "rawMeasurements": raw_measurements,
        "mastering": mastered,
        "segments": segment_records,
        "pauses": pause_records,
        "cues": cues,
        "alignmentState": "deterministic-generation-boundaries-human-review-pending",
        "files": file_records,
        "automatedState": "production-candidate-objective-checks-passed",
        "productionMasterApproval": False,
        "finishedTrackApproval": False,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    manifest_path.chmod(0o600)
    track_root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    track_root.parent.chmod(0o700)
    os.replace(temporary_root, track_root)
    shutil.rmtree(checkpoint_root)
    return {
        "contentID": identifier,
        "language": language,
        "manifestSHA256": sha256(track_root / "manifest.json"),
        "durationSeconds": delivery_duration,
        "speechOnlyWordsPerMinute": round(speech_wpm, 2),
        "overallWordsPerMinute": round(overall_wpm, 2),
        "deliveryBytes": (track_root / "delivery.m4a").stat().st_size,
        "rawClippingAttention": raw_clipping_attention,
    }


def memory_probe_inputs(
    practice: dict[str, Any],
    language: str,
    plan: dict[str, Any],
    unit_count: int,
    start_ordinal: int = 0,
) -> list[dict[str, Any]]:
    if unit_count not in (1, 2, 4, 8, 16):
        raise ValueError("Memory probe must request 1, 2, 4, 8, or 16 generation units")
    if start_ordinal < 0:
        raise ValueError("Memory probe start ordinal must be non-negative")
    script_path = PROJECT_ROOT / practice["localized"][language]["scriptPath"]
    _, events = parse_script(script_path)
    direction = plan["directions"][language]
    inputs: list[dict[str, Any]] = []
    generation_ordinal = 0
    for event in events:
        if not isinstance(event, SentenceEvent):
            continue
        for unit in generation_units(event.text, language):
            seed = production_seed(
                direction,
                int(practice["id"][1:]),
                generation_ordinal,
            )
            kwargs: dict[str, Any] = {
                "text": unit.generation_text,
                "repetition_penalty": plan["generation"]["repetitionPenalty"],
                "min_p": plan["generation"]["minP"],
                "top_p": plan["generation"]["topP"],
                "exaggeration": direction["exaggeration"],
                "cfg_weight": direction["cfgWeight"],
                "temperature": direction["temperature"],
            }
            if language == "de":
                kwargs["language_id"] = "de"
            if generation_ordinal >= start_ordinal:
                inputs.append(
                    {
                        "generationOrdinal": generation_ordinal,
                        "unit": unit,
                        "seed": seed,
                        "kwargs": kwargs,
                        "tokenLimit": speech_token_limit(
                            len(words(unit.source_text)),
                            float(direction["speechOnlyWPMRange"][0]),
                        ),
                    }
                )
            generation_ordinal += 1
            if len(inputs) == unit_count:
                return inputs
    raise ValueError(
        f"{practice['id']}/{language}: fewer than {unit_count} probe units "
        f"from ordinal {start_ordinal}"
    )


def generate_memory_probe(
    practice: dict[str, Any],
    language: str,
    model: Any,
    plan: dict[str, Any],
    torch: Any,
    numpy: Any,
    unit_count: int,
    device: str,
) -> dict[str, Any]:
    units: list[dict[str, Any]] = []
    inputs = memory_probe_inputs(practice, language, plan, unit_count)
    if isinstance(model, MPSPhaseManagedChatterbox) and model.phase_batched:
        generated = model.generate_phase_batch(inputs)
    else:
        generated = []
    for index, item in enumerate(inputs):
        unit = item["unit"]
        waveform: Any | None = None
        try:
            if generated:
                waveform = generated[index]
            else:
                seed_everything(item["seed"], torch, numpy)
                prepare_generation_phase(model)
                waveform = generate_with_token_limit(
                    model,
                    item["kwargs"],
                    item["tokenLimit"],
                    lambda: transition_after_token_generation(model, device, torch),
                )
            samples = waveform.detach().cpu().float().reshape(-1).numpy()
            measurements = signal_measurements(
                samples,
                int(plan["generation"]["sampleRate"]),
                numpy,
            )
            units.append(
                {
                    "unitTextSHA256": text_sha256(unit.source_text),
                    "generationTextSHA256": text_sha256(unit.generation_text),
                    "seed": item["seed"],
                    "speechTokenLimit": item["tokenLimit"],
                    "sampleCount": int(samples.size),
                    "pcmFloat32SHA256": hashlib.sha256(samples.tobytes()).hexdigest(),
                    "durationSeconds": measurements["durationSeconds"],
                }
            )
            del samples
        finally:
            if waveform is not None:
                del waveform
            if not generated:
                release_accelerator_cache(model, device, torch)
    generated.clear()
    result = {
        "contentID": practice["id"],
        "language": language,
        "unitCountRequested": unit_count,
        "modelLoads": 1,
        "generationCalls": len(units),
        "units": units,
        "languageIDExplicit": language == "de",
        "outputPersisted": False,
        "mpsResidencyStrategy": getattr(model, "residency_strategy", "not-applicable"),
    }
    return result


class MLXWaveform:
    """Present immutable MLX-produced PCM through the pipeline's tensor subset."""

    def __init__(self, samples: Any) -> None:
        self.samples = samples

    def detach(self) -> "MLXWaveform":
        return self

    def cpu(self) -> "MLXWaveform":
        return self

    def float(self) -> "MLXWaveform":
        return self

    def reshape(self, *shape: int) -> "MLXWaveform":
        return MLXWaveform(self.samples.reshape(*shape))

    def numpy(self) -> Any:
        return self.samples


class MLXSeedShim:
    """Route the generic per-unit seeding contract to MLX without PyTorch."""

    class _MPS:
        @staticmethod
        def is_available() -> bool:
            return False

    class _Backends:
        mps = None

    def __init__(self, mx: Any) -> None:
        self.mx = mx
        self.backends = self._Backends()
        self.backends.mps = self._MPS()

    def manual_seed(self, seed: int) -> None:
        self.mx.random.seed(seed)


class MLXProductionAdapter:
    """Adapt mlx-audio's generator result to the established production pipeline."""

    def __init__(self, model: Any, mx: Any, numpy: Any) -> None:
        self.model = model
        self.mx = mx
        self.numpy = numpy
        self.t3 = model.t3

    def generate(self, **kwargs: Any) -> MLXWaveform:
        if "language_id" in kwargs:
            kwargs["lang_code"] = kwargs.pop("language_id")
        results = list(self.model.generate(**kwargs, verbose=False))
        if len(results) != 1:
            raise RuntimeError("MLX Chatterbox returned an unexpected segment count")
        result = results[0]
        self.mx.eval(result.audio)
        samples = self.numpy.asarray(result.audio, dtype=self.numpy.float32).reshape(-1)
        if samples.size == 0 or not self.numpy.isfinite(samples).all():
            raise RuntimeError("MLX Chatterbox produced invalid PCM")
        del result, results
        self.mx.clear_cache()
        return MLXWaveform(samples)

    def release_all_phases(self) -> None:
        self.mx.clear_cache()


def load_mlx_conditionals(mx: Any, numpy: Any, plan: dict[str, Any]) -> Any:
    from mlx_audio.tts.models.chatterbox.chatterbox import Conditionals
    from mlx_audio.tts.models.chatterbox.t3.cond_enc import T3Cond

    if sha256(MLX_CONDITIONALS) != MLX_CONDITIONALS_SHA256:
        raise RuntimeError("Pinned derived MLX conditionals hash mismatch")
    with numpy.load(MLX_CONDITIONALS, allow_pickle=False) as archive:
        metadata = json.loads(bytes(archive["metadata.json"].tolist()).decode("utf-8"))
        if metadata != {
            "schemaVersion": 1,
            "sourceRepository": plan["model"]["repository"],
            "sourceRevision": plan["model"]["revision"],
            "sourceFile": "conds.pt",
            "sourceSHA256": plan["modelFileSHA256"]["conds.pt"],
        }:
            raise RuntimeError("MLX conditionals provenance mismatch")
        t3 = T3Cond(
            speaker_emb=mx.array(archive["t3.speaker_emb"]),
            cond_prompt_speech_tokens=mx.array(
                archive["t3.cond_prompt_speech_tokens"]
            ),
            emotion_adv=mx.array(archive["t3.emotion_adv"]),
        )
        gen = {
            name.removeprefix("gen."): mx.array(archive[name])
            for name in archive.files
            if name.startswith("gen.")
        }
    mx.eval(t3.speaker_emb, t3.cond_prompt_speech_tokens, t3.emotion_adv, *gen.values())
    return Conditionals(t3=t3, gen=gen)


def load_mlx_production_model(
    language: str,
    plan: dict[str, Any],
    snapshot: Path,
    mx: Any,
    numpy: Any,
) -> MLXProductionAdapter:
    from mlx_audio.tts.models.chatterbox.chatterbox import Model
    from mlx_audio.tts.models.chatterbox.config import ModelConfig, T3Config
    from mlx_audio.tts.models.chatterbox.s3gen import S3Token2Wav
    from mlx_audio.tts.models.chatterbox.scripts.convert import load_s3gen_strict
    from mlx_audio.tts.models.chatterbox.t3 import T3
    from mlx_audio.tts.models.chatterbox.tokenizer import EnTokenizer, MTLTokenizer

    if language == "en":
        config = ModelConfig(
            t3_config=T3Config.english_only(),
            multilingual=False,
            t3_model="english",
            text_preprocessing="legacy",
        )
        t3_name = "t3_cfg.safetensors"
        tokenizer_name = "tokenizer.json"
    else:
        config = ModelConfig(
            t3_config=T3Config.multilingual(),
            multilingual=True,
            t3_model="v3",
            text_preprocessing="NFKD,fullcase",
        )
        t3_name = plan["model"]["germanT3Model"]
        tokenizer_name = "grapheme_mtl_merged_expanded_v1.json"

    t3 = T3(config.t3_config)
    s3gen = S3Token2Wav()
    model = Model(
        t3,
        s3gen=s3gen,
        ve=None,
        conds=load_mlx_conditionals(mx, numpy, plan),
    )
    model._s3_tokenizer = None
    model.config = config
    if language == "en":
        model.tokenizer = EnTokenizer(snapshot / tokenizer_name)
        model.mtl_tokenizer = None
    else:
        model.tokenizer = None
        model.mtl_tokenizer = MTLTokenizer(
            snapshot / tokenizer_name,
            text_preprocessing=config.text_preprocessing,
        )

    t3_weights = mx.load(str(snapshot / t3_name))
    t3_weights = model.t3.sanitize(t3_weights)
    model.t3.load_weights(list(t3_weights.items()), strict=False)
    mx.eval(model.t3.parameters())
    del t3_weights
    mx.clear_cache()

    s3_weights = mx.load(str(snapshot / "s3gen.safetensors"))
    s3_weights = {
        key: value
        for key, value in s3_weights.items()
        if not key.startswith("tokenizer.")
    }
    s3_weights = model.s3gen.sanitize(s3_weights)
    load_s3gen_strict(model.s3gen, s3_weights)
    mx.eval(model.s3gen.parameters())
    del s3_weights
    mx.clear_cache()
    model.eval()
    return MLXProductionAdapter(model, mx, numpy)


def run_mlx_generation(
    args: argparse.Namespace,
    plan: dict[str, Any],
    practices: list[dict[str, Any]],
    plan_path: Path,
    catalog_path: Path,
    output_root: Path,
    ffmpeg: str,
    ffprobe: str,
    integrity_attestation: dict[str, Any] | None,
) -> int:
    import mlx.core as mx
    import numpy
    import soundfile

    require_memory_guard("mlx")
    if args.mps_residency_strategy != "phase-per-unit":
        raise ValueError("MLX uses one fully native resident model")
    revision = plan["model"]["revision"]
    snapshot = (
        PROJECT_ROOT
        / "ContentProduction"
        / "model-cache"
        / "huggingface"
        / "models--ResembleAI--chatterbox"
        / "snapshots"
        / revision
    )
    t3_name = "t3_cfg.safetensors" if args.language == "en" else plan["model"]["germanT3Model"]
    tokenizer_name = (
        "tokenizer.json"
        if args.language == "en"
        else "grapheme_mtl_merged_expanded_v1.json"
    )
    names = (t3_name, "s3gen.safetensors", tokenizer_name, "conds.pt")
    attested_models = (
        integrity_attestation.get("modelFiles", {})
        if integrity_attestation is not None
        else {}
    )
    model_hashes: dict[str, str] = {}
    for name in names:
        path = snapshot / name
        expected = plan["modelFileSHA256"][name]
        actual = (
            require_attested_model_file(attested_models.get(name, {}), path, expected)
            if integrity_attestation is not None
            else sha256(path)
        )
        if actual != expected:
            raise RuntimeError(f"Pinned model hash mismatch: {name}")
        model_hashes[name] = actual
    model_hashes["derived:conds-v3.npz"] = MLX_CONDITIONALS_SHA256

    def model_factory() -> Any:
        mx.random.seed(MLX_MODEL_INITIALIZATION_SEED)
        return load_mlx_production_model(args.language, plan, snapshot, mx, numpy)

    torch = MLXSeedShim(mx)
    environment = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "mlx": importlib.metadata.version("mlx"),
        "mlxAudio": importlib.metadata.version("mlx-audio"),
        "mlxAudioTagCommit": MLX_AUDIO_TAG_COMMIT,
        "modelInitializationSeed": MLX_MODEL_INITIALIZATION_SEED,
        "device": "mlx",
        "backend": "mlx-audio-full-native",
        "mpsResidencyStrategy": "not-applicable",
        "generationSemanticsRevision": MLX_AUDIO_SEMANTICS_REVISION,
        "ffmpeg": run_checked([ffmpeg, "-version"]).stdout.splitlines()[0],
    }
    plan_hash = sha256(plan_path)
    catalog_hash = sha256(catalog_path)
    results: list[dict[str, Any]] = []
    for practice in practices:
        identifier = practice["id"]
        localized = practice["localized"][args.language]
        script_hash = sha256(PROJECT_ROOT / localized["scriptPath"])
        track_root = output_root / identifier / args.language
        if track_root.exists():
            attested_track = (
                integrity_attestation.get("candidateTracks", {}).get(
                    f"{identifier}/{args.language}"
                )
                if integrity_attestation is not None
                else None
            )
            if integrity_attestation is not None and attested_track is None:
                raise RuntimeError("Completed narration candidate lacks guard attestation")
            valid = existing_track_is_valid(
                track_root,
                plan_hash,
                catalog_hash,
                script_hash,
                attested_track,
            )
            if args.resume and valid:
                manifest = load_json(track_root / "manifest.json")
                results.append(
                    {
                        "contentID": identifier,
                        "language": args.language,
                        "manifestSHA256": sha256(track_root / "manifest.json"),
                        "durationSeconds": manifest["assembly"]["durationSeconds"],
                        "speechOnlyWordsPerMinute": manifest["assembly"][
                            "speechOnlyWordsPerMinute"
                        ],
                        "overallWordsPerMinute": manifest["assembly"]["overallWordsPerMinute"],
                        "deliveryBytes": manifest["files"]["delivery"]["bytes"],
                        "rawClippingAttention": manifest["assembly"]["rawClippingAttention"],
                        "resumed": True,
                    }
                )
                print(f"validated existing candidate: {identifier}/{args.language}", flush=True)
                continue
            state = "invalid" if not valid else "already exists"
            raise FileExistsError(
                f"Refusing to replace {state} candidate {identifier}/{args.language}; "
                "inspect it before choosing a new production version"
            )
        result = generate_track(
            practice,
            args.language,
            model_factory,
            plan,
            plan_hash,
            catalog_hash,
            model_hashes,
            environment,
            output_root,
            ffmpeg,
            ffprobe,
            torch,
            numpy,
            soundfile,
            args.seed_offset,
            args.one_new_unit_per_child,
            args.new_units_per_child,
        )
        results.append(result)
        print(
            f"generated {identifier}/{args.language}: "
            f"{result['durationSeconds']:.1f}s, "
            f"speech {result['speechOnlyWordsPerMinute']:.1f} WPM, "
            f"overall {result['overallWordsPerMinute']:.1f} WPM",
            flush=True,
        )
        gc.collect()
        mx.clear_cache()

    run_manifest = {
        "schemaVersion": 1,
        "productionVersion": plan["productionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "languageOnly": args.language,
        "otherLanguageGenerationCalls": 0,
        "ownerSelectedDirection": plan["directions"][args.language]["id"],
        "generationSeedOffset": args.seed_offset,
        "planSHA256": plan_hash,
        "catalogSHA256": catalog_hash,
        "environment": environment,
        "modelFileSHA256": model_hashes,
        "tracks": results,
        "humanGates": plan["humanGates"],
        "finishedLibraryApproval": False,
    }
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_path = output_root / f"run.{args.language}.json"
    run_path.write_text(
        json.dumps(run_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    run_path.chmod(0o600)
    print(f"Wrote private {args.language}-only run manifest for {len(results)} tracks")
    return 0


def main() -> int:
    args = parse_args()
    if not 0 <= args.seed_offset < 1000:
        raise ValueError("--seed-offset must be between 0 and 999")
    if args.all and args.seed_offset != 0:
        raise ValueError("--seed-offset is allowed only with an explicit --practice")
    if args.probe_first_unit and (args.all or len(args.practice or []) != 1):
        raise ValueError("--probe-first-unit requires exactly one explicit practice")
    if args.probe_first_unit and args.one_new_unit_per_child:
        raise ValueError("--one-new-unit-per-child cannot be combined with a probe")
    if not args.one_new_unit_per_child and args.new_units_per_child != 1:
        raise ValueError("--new-units-per-child requires --one-new-unit-per-child")
    if not args.probe_first_unit and (args.probe_unit_count != 1 or args.probe_report):
        raise ValueError("--probe-unit-count/--probe-report require --probe-first-unit")
    plan_path = args.plan.resolve()
    catalog_path = args.catalog.resolve()
    integrity_attestation = load_guard_integrity_attestation()
    if integrity_attestation is not None:
        require_attested_regular_file(
            integrity_attestation.get("plan", {}), plan_path
        )
        require_attested_regular_file(
            integrity_attestation.get("generator", {}), Path(__file__).resolve()
        )
    plan = load_and_validate_plan(plan_path)
    catalog = load_and_validate_catalog(catalog_path)
    selected_ids = set(EXPECTED_IDS if args.all else args.practice or [])
    practices = [item for item in catalog["practices"] if item["id"] in selected_ids]
    for practice in practices:
        script_path = PROJECT_ROOT / practice["localized"][args.language]["scriptPath"]
        metadata, events = parse_script(script_path)
        if metadata.get("id") != practice["id"] or metadata.get("language") != args.language:
            raise ValueError(f"{practice['id']}/{args.language}: script identity mismatch")
        for event in events:
            if isinstance(event, SentenceEvent):
                generation_units(event.text, args.language)
    if args.validate_only:
        print(
            f"Validated production plan and {len(practices)} {args.language} whole-track scripts"
        )
        return 0

    output_root = PRIVATE_OUTPUT / plan["productionVersion"]
    for removed in cleanup_stale_staging(output_root, args.language):
        print(f"removed interrupted staging directory: {removed.name}", flush=True)

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg and FFprobe are required")
    if not args.probe_first_unit:
        preflight_delivery_encoder(plan, ffmpeg, ffprobe)
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    os.environ["TQDM_DISABLE"] = "1"
    if args.backend == "mlx-audio":
        if args.device == "cpu":
            raise ValueError("MLX narration requires the guarded Metal device")
        if args.probe_first_unit:
            raise ValueError("MLX probes use benchmark_production_backend.py")
        return run_mlx_generation(
            args,
            plan,
            practices,
            plan_path,
            catalog_path,
            output_root,
            ffmpeg,
            ffprobe,
            integrity_attestation,
        )
    import numpy
    import soundfile
    import torch
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.t3 import T3
    from chatterbox.models.t3.inference.t3_hf_backend import T3HuggingfaceBackend
    from chatterbox.models.t3.modules.t3_config import T3Config
    from chatterbox.models.tokenizers import EnTokenizer, MTLTokenizer
    from chatterbox.mtl_tts import (
        ChatterboxMultilingualTTS,
        Conditionals as GermanConditionals,
    )
    from chatterbox.tts import ChatterboxTTS, Conditionals as EnglishConditionals
    from huggingface_hub import snapshot_download
    from safetensors.torch import load_file as load_safetensors
    from s3tokenizer.model_v2 import precompute_freqs_cis
    from transformers.modeling_outputs import CausalLMOutputWithCrossAttentions

    torch.use_deterministic_algorithms(True, warn_only=True)
    device = select_device(args.device, torch)
    require_memory_guard(device)
    if device != "mps" and args.mps_residency_strategy != "phase-per-unit":
        raise ValueError("MPS residency alternatives require the MPS device")
    t3_backend_patch_hash = None
    if device == "mps":
        t3_backend_patch_hash = install_memory_efficient_t3_backend(
            torch,
            T3HuggingfaceBackend,
            CausalLMOutputWithCrossAttentions,
        )
    patterns = model_allow_patterns(args.language)
    snapshot = Path(
        snapshot_download(
            repo_id=plan["model"]["repository"],
            repo_type="model",
            revision=plan["model"]["revision"],
            allow_patterns=patterns,
            cache_dir=PROJECT_ROOT / "ContentProduction" / "model-cache" / "huggingface",
            max_workers=2,
            local_files_only=True,
        )
    )
    attested_models = (
        integrity_attestation.get("modelFiles", {})
        if integrity_attestation is not None
        else {}
    )
    model_hashes: dict[str, str] = {}
    for name in patterns:
        path = snapshot / name
        if not path.is_file():
            raise FileNotFoundError(f"Pinned local model file is missing: {name}")
        expected = plan["modelFileSHA256"].get(name)
        actual = (
            require_attested_model_file(attested_models.get(name, {}), path, expected)
            if integrity_attestation is not None
            else sha256(path)
        )
        if actual != expected:
            raise ValueError(f"Pinned local model hash mismatch: {name}")
        model_hashes[name] = actual
    def model_factory() -> Any:
        if device == "mps":
            if args.language == "en":
                conditionals = EnglishConditionals.load(
                    snapshot / "conds.pt", map_location="cpu"
                )
                shell = ChatterboxTTS(
                    None,
                    None,
                    None,
                    EnTokenizer(str(snapshot / "tokenizer.json")),
                    device,
                    conds=conditionals,
                )

                def t3_factory() -> Any:
                    return load_safetensor_phase_direct(
                        T3,
                        snapshot / "t3_cfg.safetensors",
                        load_safetensors,
                        torch,
                        device,
                        strict=True,
                        materialize_meta=lambda t3, missing: materialize_t3_nonpersistent_state(
                            t3, missing, device
                        ),
                    )

                def s3_factory() -> Any:
                    return load_safetensor_phase_direct(
                        S3Gen,
                        snapshot / "s3gen.safetensors",
                        load_safetensors,
                        torch,
                        device,
                        strict=False,
                        allowed_missing=("tokenizer.window",),
                        materialize_meta=lambda s3gen, missing: materialize_s3_nonpersistent_state(
                            s3gen,
                            missing,
                            torch,
                            device,
                            precompute_freqs_cis,
                        ),
                    )

            else:
                conditionals = GermanConditionals.load(
                    snapshot / "conds.pt", map_location="cpu"
                )
                shell = ChatterboxMultilingualTTS(
                    None,
                    None,
                    None,
                    MTLTokenizer(
                        str(snapshot / "grapheme_mtl_merged_expanded_v1.json")
                    ),
                    device,
                    conds=conditionals,
                )

                def t3_factory() -> Any:
                    return load_safetensor_phase_direct(
                        lambda: T3(T3Config.multilingual()),
                        snapshot / plan["model"]["germanT3Model"],
                        load_safetensors,
                        torch,
                        device,
                        strict=True,
                        materialize_meta=lambda t3, missing: materialize_t3_nonpersistent_state(
                            t3, missing, device
                        ),
                    )

                def s3_factory() -> Any:
                    s3gen = S3Gen()
                    state = torch.load(
                        snapshot / "s3gen.pt",
                        map_location="cpu",
                        weights_only=True,
                    )
                    s3gen.load_state_dict(state, strict=False)
                    del state
                    return s3gen.to(device).eval()

            return MPSPhaseManagedChatterbox(
                shell,
                t3_factory,
                s3_factory,
                torch,
                numpy,
                language=args.language,
                phase_batched=args.mps_residency_strategy == "phase-batched",
            )
        if args.language == "en":
            return ChatterboxTTS.from_local(snapshot, device)
        return ChatterboxMultilingualTTS.from_local(
            snapshot,
            device,
            t3_model=plan["model"]["germanT3Model"],
        )
    environment = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": torch.__version__,
        "chatterboxTTS": importlib.metadata.version("chatterbox-tts"),
        "device": device,
        "mpsResidencyStrategy": (
            args.mps_residency_strategy if device == "mps" else "not-applicable"
        ),
        "t3BackendFinalStateOnlySHA256": t3_backend_patch_hash,
        "ffmpeg": run_checked([ffmpeg, "-version"]).stdout.splitlines()[0],
    }
    if args.probe_first_unit:
        model = model_factory()
        try:
            probe = generate_memory_probe(
                practices[0],
                args.language,
                model,
                plan,
                torch,
                numpy,
                args.probe_unit_count,
                device,
            )
            if args.probe_report:
                report = args.probe_report.resolve()
                private_root = (PROJECT_ROOT / ".evidence" / "audio").resolve()
                if report.parent != private_root or not report.name.startswith(".narration-probe-"):
                    raise ValueError("Memory probe report must be a private guard-owned audio evidence file")
                report.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                report.write_text(json.dumps(probe, sort_keys=True) + "\n", encoding="utf-8")
                report.chmod(0o600)
            print(json.dumps({"memoryProbe": probe}, sort_keys=True), flush=True)
        finally:
            if hasattr(model, "release_all_phases"):
                model.release_all_phases()
            del model
            gc.collect()
            if device == "mps":
                torch.mps.empty_cache()
        return 0
    plan_hash = sha256(plan_path)
    catalog_hash = sha256(catalog_path)
    results: list[dict[str, Any]] = []
    for practice in practices:
        identifier = practice["id"]
        localized = practice["localized"][args.language]
        script_hash = sha256(PROJECT_ROOT / localized["scriptPath"])
        track_root = output_root / identifier / args.language
        if track_root.exists():
            attested_track = (
                integrity_attestation.get("candidateTracks", {}).get(
                    f"{identifier}/{args.language}"
                )
                if integrity_attestation is not None
                else None
            )
            if integrity_attestation is not None and attested_track is None:
                raise RuntimeError("Completed narration candidate lacks guard attestation")
            valid = existing_track_is_valid(
                track_root,
                plan_hash,
                catalog_hash,
                script_hash,
                attested_track,
            )
            if args.resume and valid:
                manifest = load_json(track_root / "manifest.json")
                results.append(
                    {
                        "contentID": identifier,
                        "language": args.language,
                        "manifestSHA256": sha256(track_root / "manifest.json"),
                        "durationSeconds": manifest["assembly"]["durationSeconds"],
                        "speechOnlyWordsPerMinute": manifest["assembly"][
                            "speechOnlyWordsPerMinute"
                        ],
                        "overallWordsPerMinute": manifest["assembly"]["overallWordsPerMinute"],
                        "deliveryBytes": manifest["files"]["delivery"]["bytes"],
                        "rawClippingAttention": manifest["assembly"]["rawClippingAttention"],
                        "resumed": True,
                    }
                )
                print(f"validated existing candidate: {identifier}/{args.language}", flush=True)
                continue
            state = "invalid" if not valid else "already exists"
            raise FileExistsError(
                f"Refusing to replace {state} candidate {identifier}/{args.language}; "
                "inspect it before choosing a new production version"
            )
        result = generate_track(
            practice,
            args.language,
            model_factory,
            plan,
            plan_hash,
            catalog_hash,
            model_hashes,
            environment,
            output_root,
            ffmpeg,
            ffprobe,
            torch,
            numpy,
            soundfile,
            args.seed_offset,
            args.one_new_unit_per_child,
            args.new_units_per_child,
        )
        results.append(result)
        print(
            f"generated {identifier}/{args.language}: "
            f"{result['durationSeconds']:.1f}s, "
            f"speech {result['speechOnlyWordsPerMinute']:.1f} WPM, "
            f"overall {result['overallWordsPerMinute']:.1f} WPM",
            flush=True,
        )
        gc.collect()
        if device == "mps":
            torch.mps.empty_cache()
    run_manifest = {
        "schemaVersion": 1,
        "productionVersion": plan["productionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "languageOnly": args.language,
        "otherLanguageGenerationCalls": 0,
        "ownerSelectedDirection": plan["directions"][args.language]["id"],
        "generationSeedOffset": args.seed_offset,
        "planSHA256": plan_hash,
        "catalogSHA256": catalog_hash,
        "environment": environment,
        "modelFileSHA256": model_hashes,
        "tracks": results,
        "humanGates": plan["humanGates"],
        "finishedLibraryApproval": False,
    }
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_path = output_root / f"run.{args.language}.json"
    run_path.write_text(
        json.dumps(run_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    run_path.chmod(0o600)
    print(f"Wrote private {args.language}-only run manifest for {len(results)} tracks")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CheckpointContinuation as continuation:
        print(f"checkpoint continuation: {continuation}", flush=True)
        raise SystemExit(CHECKPOINT_CONTINUATION_EXIT_CODE) from None
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise

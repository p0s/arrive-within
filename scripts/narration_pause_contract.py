#!/usr/bin/env python3
"""Shared, dependency-free checks for spoken-cue pause boundaries.

The pause contract treats the space between VTT cues as intentional sentence,
paragraph, or authored meditation space.  Only a near-digital-silence run that
is wholly inside one spoken cue is an unresolved internal blank.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any


INTERNAL_SILENCE_MAXIMUM_SECONDS = 0.45
BOUNDED_NATURAL_PROSODY_MAXIMUM_SECONDS = 0.75
BOUNDED_NATURAL_PROSODY_METHOD = "bounded-model-prosody-owner-listening-required"
# A spoken cue shorter than this is not a credible narration unit.  It catches
# near-empty model output (for example a one-sample "Two." cue) before it can
# be rounded to a zero-duration VTT interval.
MINIMUM_SPOKEN_CUE_SECONDS = 0.05
SILENCE_NOISE_DB = -45
EDGE_TOLERANCE_SECONDS = 0.08
_SILENCE_START = re.compile(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)")
_SILENCE_END = re.compile(
    r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?)"
)
_WORD = re.compile(r"[^\W_]+(?:[-’'][^\W_]+)*", flags=re.UNICODE)
_AUTHORED_PUNCTUATION = re.compile(r"[,;:]")


def is_authored_punctuation_pause(
    run_start: float,
    run_end: float,
    cue_start: float,
    cue_end: float,
    text: str,
) -> bool:
    """Return whether a long quiet run aligns with authored punctuation.

    Chatterbox naturally renders some comma/list breaths at about half a
    second. Those are desired cadence, not the unexplained mid-phrase blanks
    this gate targets. Word-position matching keeps the exception tied to
    literal authored punctuation without requiring synthetic pause metadata.
    """

    duration = cue_end - cue_start
    if duration <= 0 or run_end <= run_start:
        return False
    word_matches = list(_WORD.finditer(text))
    if len(word_matches) < 2:
        return False
    authored_fractions = []
    for delimiter in _AUTHORED_PUNCTUATION.finditer(text):
        after_word_count = sum(
            match.end() <= delimiter.start() for match in word_matches
        )
        if 0 < after_word_count < len(word_matches):
            authored_fractions.append(after_word_count / len(word_matches))
    if not authored_fractions:
        return False
    observed_fraction = ((run_start + run_end) / 2 - cue_start) / duration
    # Permit ordinary speech-rate variation while keeping the exception local
    # to the authored lexical boundary. The absolute component is important
    # for short cues; the cap prevents matching an unrelated distant blank.
    tolerance = min(0.18, max(0.08, 0.75 / duration))
    return any(
        abs(observed_fraction - expected_fraction) <= tolerance
        for expected_fraction in authored_fractions
    )


def is_bounded_natural_prosody_pause(duration_seconds: float) -> bool:
    """Classify a modest model-rendered hesitation for owner listening.

    This is deliberately narrower than a general silence exemption. The
    generator must record the exact range, and packaged-audio validation only
    accepts it when that record matches the decoded AAC run. Longer blanks stay
    unresolved even before human review.
    """

    return (
        INTERNAL_SILENCE_MAXIMUM_SECONDS
        < duration_seconds
        <= BOUNDED_NATURAL_PROSODY_MAXIMUM_SECONDS
    )


def extract_bounded_natural_prosody_pauses(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return the exact owner-reviewed bounded pauses for public provenance."""

    pauses: list[dict[str, Any]] = []
    for cue_index, segment in enumerate(segments, start=1):
        for record in segment.get("naturalProsodyPauses", []):
            if record.get("method") != BOUNDED_NATURAL_PROSODY_METHOD:
                continue
            start = float(record.get("startSeconds", -1.0))
            end = float(record.get("endSeconds", -1.0))
            duration = float(record.get("durationSeconds", -1.0))
            if (
                start < 0
                or end <= start
                or abs((end - start) - duration) > 0.011
                or not is_bounded_natural_prosody_pause(duration)
            ):
                raise ValueError(f"invalid bounded natural-prosody pause in cue {cue_index}")
            pauses.append(
                {
                    "cueIndex": cue_index,
                    "startSeconds": start,
                    "endSeconds": end,
                    "durationSeconds": duration,
                    "method": BOUNDED_NATURAL_PROSODY_METHOD,
                }
            )
    return pauses


def resolve_bounded_natural_prosody_pauses(
    cues: list[dict[str, Any]],
    records: Any,
) -> list[list[dict[str, float]]]:
    """Validate relative provenance records and resolve them to track time."""

    if not isinstance(records, list):
        raise ValueError("bounded natural-prosody pauses must be a list")
    allowed: list[list[dict[str, float]]] = [[] for _ in cues]
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("bounded natural-prosody pause must be an object")
        cue_index = record.get("cueIndex")
        if isinstance(cue_index, bool) or not isinstance(cue_index, int):
            raise ValueError("bounded natural-prosody cue index must be an integer")
        if not 1 <= cue_index <= len(cues):
            raise ValueError("bounded natural-prosody cue index is out of range")
        if record.get("method") != BOUNDED_NATURAL_PROSODY_METHOD:
            raise ValueError("bounded natural-prosody method is invalid")
        start = float(record.get("startSeconds", -1.0))
        end = float(record.get("endSeconds", -1.0))
        duration = float(record.get("durationSeconds", -1.0))
        cue = cues[cue_index - 1]
        cue_duration = float(cue["endSeconds"]) - float(cue["startSeconds"])
        if (
            start < 0
            or end <= start
            or end > cue_duration + 0.011
            or abs((end - start) - duration) > 0.011
            or not is_bounded_natural_prosody_pause(duration)
        ):
            raise ValueError(f"invalid bounded natural-prosody pause in cue {cue_index}")
        cue_start = float(cue["startSeconds"])
        allowed[cue_index - 1].append(
            {
                "startSeconds": cue_start + start,
                "endSeconds": cue_start + end,
            }
        )
    return allowed


def parse_silencedetect_runs(output: str) -> list[tuple[float, float]]:
    """Pair FFmpeg silencedetect starts/ends, rejecting malformed streams."""

    runs: list[tuple[float, float]] = []
    pending_start: float | None = None
    for line in output.splitlines():
        start_match = _SILENCE_START.search(line)
        if start_match:
            if pending_start is not None:
                raise ValueError("silencedetect emitted a second start before an end")
            pending_start = float(start_match.group(1))
            continue
        end_match = _SILENCE_END.search(line)
        if end_match:
            if pending_start is None:
                raise ValueError("silencedetect emitted an end without a start")
            end = float(end_match.group(1))
            duration = float(end_match.group(2))
            if end <= pending_start or duration <= 0:
                raise ValueError("silencedetect emitted a non-positive run")
            runs.append((pending_start, end))
            pending_start = None
    if pending_start is not None:
        # A final silence run may have no explicit end when the source ends.
        # It cannot be internal to a cue without a known end, so ignore it.
        return runs
    return runs


def scan_internal_cue_silence(
    audio_path: Path,
    cues: list[dict[str, Any]],
    *,
    ffmpeg: str = "ffmpeg",
    maximum_seconds: float = INTERNAL_SILENCE_MAXIMUM_SECONDS,
    allowed_internal_pauses: list[list[dict[str, float]]] | None = None,
) -> list[dict[str, Any]]:
    """Return unresolved digital-silence runs wholly inside spoken VTT cues."""

    if maximum_seconds <= 0:
        raise ValueError("internal silence maximum must be positive")
    if allowed_internal_pauses is not None and len(allowed_internal_pauses) != len(cues):
        raise ValueError("allowed internal pause records must match the cue count")
    command = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-i",
        str(audio_path),
        "-af",
        f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={maximum_seconds}",
        "-f",
        "null",
        "-",
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise RuntimeError(f"required executable is unavailable: {ffmpeg}") from error
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()[-2000:]
        raise RuntimeError(f"FFmpeg silence scan failed for {audio_path.name}: {detail}") from error

    runs = parse_silencedetect_runs(completed.stderr)
    findings: list[dict[str, Any]] = []
    for cue_index, cue in enumerate(cues, start=1):
        cue_start = float(cue["startSeconds"])
        cue_end = float(cue["endSeconds"])
        for run_start, run_end in runs:
            if run_start < cue_start + EDGE_TOLERANCE_SECONDS:
                continue
            if run_end > cue_end - EDGE_TOLERANCE_SECONDS:
                continue
            duration = run_end - run_start
            if duration + 1e-6 < maximum_seconds:
                continue
            if is_authored_punctuation_pause(
                run_start,
                run_end,
                cue_start,
                cue_end,
                str(cue.get("text", "")),
            ):
                continue
            allowed = (
                allowed_internal_pauses[cue_index - 1]
                if allowed_internal_pauses is not None
                else []
            )
            if any(
                abs(run_start - float(record["startSeconds"])) <= 0.12
                and abs(run_end - float(record["endSeconds"])) <= 0.12
                for record in allowed
            ):
                continue
            findings.append(
                {
                    "cueIndex": cue_index,
                    "startSeconds": round(run_start, 6),
                    "endSeconds": round(run_end, 6),
                    "durationSeconds": round(duration, 6),
                    "text": str(cue.get("text", "")),
                }
            )
    return findings

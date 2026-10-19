#!/usr/bin/env python3
"""Fast regression gates for the no-synthetic-intra-sentence pause contract."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "ContentProduction/chatterbox-audition/generate_production_candidates.py"
SPEC = importlib.util.spec_from_file_location("pause_contract_generator", GENERATOR)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load narration production generator")
generator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = generator
SPEC.loader.exec_module(generator)

from narration_pause_contract import (
    BOUNDED_NATURAL_PROSODY_METHOD,
    extract_bounded_natural_prosody_pauses,
    is_authored_punctuation_pause,
    parse_silencedetect_runs,
    resolve_bounded_natural_prosody_pauses,
    scan_internal_cue_silence,
)
from validate_guided_content import parse_vtt_cues


class NarrationPauseContractTests(unittest.TestCase):
    def test_g02_only_if_sentence_is_generated_without_ellipsis(self) -> None:
        _, events = generator.parse_script(ROOT / "Content/guided/G02/script.en.md")
        sentence = next(
            event.text
            for event in events
            if isinstance(event, generator.SentenceEvent) and "only if" in event.text
        )
        units = generator.english_generation_units(sentence)
        rendered = " ".join(unit.generation_text for unit in units)
        self.assertIn("only if", rendered)
        self.assertNotIn("…", rendered)
        self.assertEqual(
            [word for unit in units for word in generator.words(unit.source_text)],
            generator.words(sentence),
        )

    def test_unpunctuated_sentence_has_no_automatic_pause_metadata(self) -> None:
        units = generator.english_generation_units(
            "Notice that the ground is already meeting you."
        )
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0].internal_boundaries, ())
        self.assertNotIn("…", units[0].generation_text)

    def test_semantic_pause_extension_is_disabled(self) -> None:
        samples = [0.25, -0.25]
        adjusted, records = generator.extend_semantic_pauses(
            samples,
            ({"after": "only", "kind": "clause", "afterWordIndex": 2, "unitWordCount": 4},),
            {"listPauseMs": 0, "clausePauseMs": 0},
            24_000,
            None,
        )
        self.assertIs(adjusted, samples)
        self.assertEqual(records, [])

    def test_silencedetect_runs_are_pairwise_and_cue_internal_only(self) -> None:
        output = """
        silence_start: 2.000
        silence_end: 2.700 | silence_duration: 0.700
        silence_start: 5.000
        silence_end: 5.600 | silence_duration: 0.600
        """
        self.assertEqual(parse_silencedetect_runs(output), [(2.0, 2.7), (5.0, 5.6)])
        cues = [
            {"startSeconds": 0.0, "endSeconds": 3.0, "text": "first"},
            {"startSeconds": 3.0, "endSeconds": 8.0, "text": "second"},
        ]
        completed = subprocess.CompletedProcess(
            ["ffmpeg"], 0, stdout="", stderr=output
        )
        with mock.patch(
            "narration_pause_contract.subprocess.run", return_value=completed
        ):
            findings = scan_internal_cue_silence(Path("track.m4a"), cues)
        self.assertEqual([finding["cueIndex"] for finding in findings], [1, 2])

    def test_between_cue_pause_is_not_an_internal_blank(self) -> None:
        output = """
        silence_start: 3.000
        silence_end: 4.000 | silence_duration: 1.000
        """
        cues = [
            {"startSeconds": 0.0, "endSeconds": 3.0, "text": "first"},
            {"startSeconds": 4.0, "endSeconds": 8.0, "text": "second"},
        ]
        completed = subprocess.CompletedProcess(
            ["ffmpeg"], 0, stdout="", stderr=output
        )
        with mock.patch(
            "narration_pause_contract.subprocess.run", return_value=completed
        ):
            self.assertEqual(scan_internal_cue_silence(Path("track.m4a"), cues), [])

    def test_natural_list_pause_is_classified_by_authored_punctuation(self) -> None:
        text = (
            "It may be long or short, smooth or uneven, easy to feel or barely "
            "noticeable."
        )
        self.assertTrue(is_authored_punctuation_pause(3.29, 3.79, 0.0, 5.8, text))
        output = """
        silence_start: 3.290
        silence_end: 3.790 | silence_duration: 0.500
        """
        cues = [{"startSeconds": 0.0, "endSeconds": 5.8, "text": text}]
        completed = subprocess.CompletedProcess(
            ["ffmpeg"], 0, stdout="", stderr=output
        )
        with mock.patch(
            "narration_pause_contract.subprocess.run", return_value=completed
        ):
            self.assertEqual(scan_internal_cue_silence(Path("track.m4a"), cues), [])

    def test_g02_vtt_preserves_text_needed_to_classify_natural_pause(self) -> None:
        cues = parse_vtt_cues(ROOT / "Content/guided/G02/transcript.en.vtt")
        cue = cues[6]
        self.assertEqual(
            cue["text"],
            "It may be long or short, smooth or uneven, easy to feel or barely noticeable.",
        )
        output = """
        silence_start: 38.778
        silence_end: 39.278 | silence_duration: 0.500
        """
        completed = subprocess.CompletedProcess(
            ["ffmpeg"], 0, stdout="", stderr=output
        )
        with mock.patch(
            "narration_pause_contract.subprocess.run", return_value=completed
        ):
            self.assertEqual(scan_internal_cue_silence(Path("track.m4a"), [cue]), [])

    def test_mid_phrase_blank_is_not_misclassified_without_punctuation(self) -> None:
        text = "Let your eyes close only if that feels comfortable."
        self.assertFalse(
            is_authored_punctuation_pause(2.0, 3.5, 0.0, 5.0, text)
        )

    def test_recorded_bounded_prosody_pause_is_rechecked_against_aac(self) -> None:
        output = """
        silence_start: 3.100
        silence_end: 3.720 | silence_duration: 0.620
        """
        cues = [
            {
                "startSeconds": 0.0,
                "endSeconds": 5.37,
                "text": "Trauer hat keine Ziellinie, und diese Übung ist keine Behandlung.",
            }
        ]
        completed = subprocess.CompletedProcess(
            ["ffmpeg"], 0, stdout="", stderr=output
        )
        with mock.patch(
            "narration_pause_contract.subprocess.run", return_value=completed
        ):
            self.assertEqual(
                scan_internal_cue_silence(
                    Path("track.m4a"),
                    cues,
                    allowed_internal_pauses=[
                        [{"startSeconds": 3.1, "endSeconds": 3.72}]
                    ],
                ),
                [],
            )

    def test_bounded_prosody_manifest_record_round_trips_through_provenance(self) -> None:
        cues = [
            {
                "startSeconds": 70.317,
                "endSeconds": 73.957,
                "text": "As the next exhale ends, silently say one.",
            }
        ]
        segments = [
            {
                "naturalProsodyPauses": [
                    {
                        "startSeconds": 2.74,
                        "endSeconds": 3.24,
                        "durationSeconds": 0.5,
                        "method": BOUNDED_NATURAL_PROSODY_METHOD,
                    }
                ]
            }
        ]
        records = extract_bounded_natural_prosody_pauses(segments)
        self.assertEqual(records[0]["cueIndex"], 1)
        resolved = resolve_bounded_natural_prosody_pauses(cues, records)
        self.assertAlmostEqual(resolved[0][0]["startSeconds"], 73.057)
        self.assertAlmostEqual(resolved[0][0]["endSeconds"], 73.557)

    def test_bounded_prosody_provenance_rejects_unreviewed_method(self) -> None:
        cues = [{"startSeconds": 0.0, "endSeconds": 4.0, "text": "Example."}]
        with self.assertRaisesRegex(ValueError, "method is invalid"):
            resolve_bounded_natural_prosody_pauses(
                cues,
                [
                    {
                        "cueIndex": 1,
                        "startSeconds": 1.0,
                        "endSeconds": 1.5,
                        "durationSeconds": 0.5,
                        "method": "unreviewed",
                    }
                ],
            )


if __name__ == "__main__":
    unittest.main()

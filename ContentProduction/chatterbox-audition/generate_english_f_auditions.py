#!/usr/bin/env python3
"""Generate exactly two owner-directed private English F auditions.

The default English Chatterbox voice is retained. Each candidate is regenerated
from context-aware sentence/phrase units. No reference voice, time stretch,
compression, or per-chunk normalization is used. Bounded silence is added only
at explicit sentence/practice boundaries or by extending detected natural
pauses at lexical clause/list boundaries.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import random
import re
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PLAN = PROJECT_ROOT / "ContentProduction" / "english-f-audition-plan.json"
EXPECTED_IDS = {"en-f1-calm-slow", "en-f2-spacious-slow"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def words(text: str) -> list[str]:
    return [value.casefold() for value in re.findall(r"[^\W_]+(?:[-’'][^\W_]+)*", text, flags=re.UNICODE)]


def load_and_validate_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != 1 or plan.get("auditionVersion") != "chatterbox-english-f-v4":
        raise ValueError("Unsupported English F audition plan")
    if plan["model"].get("voiceReference") is not None:
        raise ValueError("English F auditions must use the default voice without reference audio")
    variants = plan.get("variants", [])
    if len(variants) != 2 or {item["id"] for item in variants} != EXPECTED_IDS:
        raise ValueError("Plan must contain exactly F1 and F2")
    expected = {
        "en-f1-calm-slow": ([125, 135], 450, 1400, 2000),
        "en-f2-spacious-slow": ([105, 120], 650, 1700, 2400),
    }
    for variant in variants:
        actual = (
            variant["speechOnlyWPMRange"],
            variant["listPauseMs"],
            variant["sentenceGapMs"],
            variant["practiceTransitionGapMs"],
        )
        if actual != expected[variant["id"]]:
            raise ValueError(f"Owner target mismatch for {variant['id']}")

    for excerpt in plan["excerpts"]:
        if excerpt.get("language") != "en":
            raise ValueError("English F plan contains a non-English excerpt")
        script_path = PROJECT_ROOT / "Content" / "guided" / excerpt["id"] / "script.en.md"
        if sha256(script_path) != excerpt["scriptSHA256"]:
            raise ValueError(f"Script hash mismatch for {excerpt['id']}.en")
        script = script_path.read_text(encoding="utf-8")
        for sentence in excerpt["sentences"]:
            if sentence["sourceText"] not in script:
                raise ValueError(f"Non-literal source sentence in {excerpt['id']}.en")
            source_words = words(sentence["sourceText"])
            unit_source_words = [word for unit in sentence["units"] for word in words(unit["sourceText"])]
            generation_words = [word for unit in sentence["units"] for word in words(unit["generationText"])]
            if unit_source_words != source_words or generation_words != source_words:
                raise ValueError(f"Lexical drift in context-aware units for {excerpt['id']}.en")
            for unit in sentence["units"]:
                boundaries = unit.get("internalBoundaries", [])
                if len({item["after"] for item in boundaries}) != len(boundaries):
                    raise ValueError("Duplicate internal semantic boundary")
                if any(item["kind"] not in {"list", "clause"} for item in boundaries):
                    raise ValueError("Unsupported internal semantic boundary kind")
    return plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def select_device(requested: str, torch: Any) -> str:
    if requested != "auto":
        if requested == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("MPS was requested but is unavailable")
        return requested
    return "mps" if torch.backends.mps.is_available() else "cpu"


def seed_everything(seed: int, torch: Any, numpy: Any) -> None:
    random.seed(seed)
    numpy.random.seed(seed)
    torch.manual_seed(seed)
    if torch.backends.mps.is_available() and hasattr(torch, "mps"):
        torch.mps.manual_seed(seed)


def model_allow_patterns() -> list[str]:
    return ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"]


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


def extend_semantic_pauses(
    samples: Any,
    boundaries: list[dict[str, str]],
    variant: dict[str, Any],
    sample_rate: int,
    numpy: Any,
) -> tuple[Any, list[dict[str, Any]]]:
    if not boundaries:
        return samples, []
    candidates = silence_runs(samples, sample_rate, numpy)
    if len(candidates) < len(boundaries):
        raise ValueError(
            f"Generated phrase exposed only {len(candidates)} internal pauses for "
            f"{len(boundaries)} semantic boundaries"
        )
    chosen = sorted(sorted(candidates, key=lambda value: value[1] - value[0], reverse=True)[: len(boundaries)])
    records: list[dict[str, Any]] = []
    adjusted = samples
    added_before = 0
    for boundary, (start, end) in zip(boundaries, chosen, strict=True):
        target_ms = variant["listPauseMs"] if boundary["kind"] == "list" else variant["clausePauseMs"]
        original_frames = end - start
        target_frames = round(sample_rate * target_ms / 1000)
        added_frames = max(0, target_frames - original_frames)
        insertion = end + added_before
        if added_frames:
            adjusted = numpy.concatenate(
                [adjusted[:insertion], numpy.zeros(added_frames, dtype=numpy.float32), adjusted[insertion:]]
            )
            added_before += added_frames
        realized_frames = original_frames + added_frames
        records.append(
            {
                "after": boundary["after"],
                "kind": boundary["kind"],
                "method": "detected-natural-pause-bounded-extension",
                "originalPauseMs": round(original_frames / sample_rate * 1000, 2),
                "addedSilenceMs": round(added_frames / sample_rate * 1000, 2),
                "realizedPauseMs": round(realized_frames / sample_rate * 1000, 2),
                "targetPauseMs": target_ms,
            }
        )
    return adjusted, records


def write_pcm16(path: Path, samples: Any, sample_rate: int, numpy: Any) -> dict[str, Any]:
    nonfinite = int((~numpy.isfinite(samples)).sum())
    if nonfinite:
        raise ValueError(f"Assembled waveform contains {nonfinite} non-finite samples")
    clipped = int(((samples < -1.0) | (samples > 1.0)).sum())
    pcm = (numpy.clip(samples, -1.0, 1.0) * 32767.0).round().astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())
    return {
        "sampleRate": sample_rate,
        "channels": 1,
        "sampleFormat": "pcm_s16le",
        "frames": int(pcm.size),
        "durationSeconds": round(float(pcm.size) / sample_rate, 6),
        "clippedInputSamples": clipped,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def main() -> int:
    args = parse_args()
    plan_path = args.plan.resolve()
    plan = load_and_validate_plan(plan_path)
    if args.validate_only:
        print("Validated exact English F1/F2 private audition plan")
        return 0

    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    import numpy
    import torch
    from chatterbox.tts import ChatterboxTTS
    from huggingface_hub import snapshot_download

    device = select_device(args.device, torch)
    snapshot = Path(
        snapshot_download(
            repo_id=plan["model"]["repository"],
            repo_type="model",
            revision=plan["model"]["revision"],
            allow_patterns=model_allow_patterns(),
            cache_dir=PROJECT_ROOT / "ContentProduction" / "model-cache" / "huggingface",
            max_workers=2,
            local_files_only=True,
        )
    )
    model_hashes = {name: sha256(snapshot / name) for name in model_allow_patterns() if (snapshot / name).is_file()}
    model = ChatterboxTTS.from_local(snapshot, device)
    generation = plan["generation"]
    sample_rate = int(generation["sampleRate"])
    excerpt_map = {item["id"]: item for item in plan["excerpts"]}
    output_root = PROJECT_ROOT / "ContentProduction" / "auditions" / plan["auditionVersion"]
    manifest_path = output_root / "manifest.json"
    if manifest_path.exists() and not args.overwrite:
        raise FileExistsError(f"Refusing to overwrite private manifest: {manifest_path}")

    results: list[dict[str, Any]] = []
    for variant in plan["variants"]:
        output = output_root / "raw" / f"{variant['id']}.G01-G30.wav"
        if output.exists() and not args.overwrite:
            raise FileExistsError(f"Refusing to overwrite private audition: {output}")
        assembled: list[Any] = []
        unit_records: list[dict[str, Any]] = []
        pause_records: list[dict[str, Any]] = []
        source_texts: list[str] = []
        speech_frames = 0
        generation_ordinal = 0
        for excerpt_position, excerpt_id in enumerate(variant["excerptIDs"]):
            excerpt = excerpt_map[excerpt_id]
            for sentence_position, sentence in enumerate(excerpt["sentences"]):
                source_texts.append(sentence["sourceText"])
                for unit_position, unit in enumerate(sentence["units"]):
                    seed = int(variant["seed"]) + generation_ordinal
                    seed_everything(seed, torch, numpy)
                    waveform = model.generate(
                        text=unit["generationText"],
                        repetition_penalty=generation["repetitionPenalty"],
                        min_p=generation["minP"],
                        top_p=generation["topP"],
                        exaggeration=variant["exaggeration"],
                        cfg_weight=variant["cfgWeight"],
                        temperature=variant["temperature"],
                    )
                    raw = waveform.detach().cpu().float().reshape(-1).numpy()
                    adjusted, internal = extend_semantic_pauses(
                        raw,
                        unit.get("internalBoundaries", []),
                        variant,
                        sample_rate,
                        numpy,
                    )
                    assembled.append(adjusted)
                    speech_frames += int(adjusted.size)
                    for record in internal:
                        pause_records.append(
                            {
                                "excerptID": excerpt_id,
                                "sentenceIndex": sentence_position,
                                "unitIndex": unit_position,
                                **record,
                            }
                        )
                    unit_records.append(
                        {
                            "excerptID": excerpt_id,
                            "sentenceIndex": sentence_position,
                            "unitIndex": unit_position,
                            "seed": seed,
                            "sourceTextSHA256": hashlib.sha256(unit["sourceText"].encode("utf-8")).hexdigest(),
                            "generationTextSHA256": hashlib.sha256(unit["generationText"].encode("utf-8")).hexdigest(),
                            "wordCount": len(words(unit["sourceText"])),
                            "rawFrames": int(raw.size),
                            "assembledSpeechFrames": int(adjusted.size),
                            "rawDurationSeconds": round(raw.size / sample_rate, 6),
                            "assembledSpeechDurationSeconds": round(adjusted.size / sample_rate, 6),
                            "internalSemanticPauses": internal,
                        }
                    )
                    generation_ordinal += 1
                    gap_after = unit.get("gapAfter")
                    if gap_after:
                        target_ms = variant["listPauseMs"] if gap_after["kind"] == "list" else variant["clausePauseMs"]
                        frames = round(sample_rate * target_ms / 1000)
                        assembled.append(numpy.zeros(frames, dtype=numpy.float32))
                        speech_frames += frames
                        pause_records.append(
                            {
                                "excerptID": excerpt_id,
                                "sentenceIndex": sentence_position,
                                "unitIndex": unit_position,
                                "after": gap_after["after"],
                                "kind": gap_after["kind"],
                                "method": "explicit-aligned-unit-boundary",
                                "originalPauseMs": 0.0,
                                "addedSilenceMs": float(target_ms),
                                "realizedPauseMs": float(target_ms),
                                "targetPauseMs": target_ms,
                            }
                        )
                if sentence_position < len(excerpt["sentences"]) - 1:
                    frames = round(sample_rate * variant["sentenceGapMs"] / 1000)
                    assembled.append(numpy.zeros(frames, dtype=numpy.float32))
            if excerpt_position < len(variant["excerptIDs"]) - 1:
                frames = round(sample_rate * variant["practiceTransitionGapMs"] / 1000)
                assembled.append(numpy.zeros(frames, dtype=numpy.float32))

        joined = numpy.concatenate(assembled)
        details = write_pcm16(output, joined, sample_rate, numpy)
        word_count = len(words(" ".join(source_texts)))
        speech_seconds = speech_frames / sample_rate
        sentence_transition_seconds = (int(details["frames"]) - speech_frames) / sample_rate
        speech_wpm = word_count / speech_seconds * 60.0
        overall_wpm = word_count / details["durationSeconds"] * 60.0
        results.append(
            {
                "id": variant["id"],
                "label": variant["label"],
                "language": "en",
                "voiceLabel": plan["model"]["voiceLabel"],
                "deliveryClaim": variant["deliveryClaim"],
                "excerptIDs": variant["excerptIDs"],
                "sourceScriptSHA256": [excerpt_map[value]["scriptSHA256"] for value in variant["excerptIDs"]],
                "promptSHA256": hashlib.sha256("\n\n".join(source_texts).encode("utf-8")).hexdigest(),
                "wordCount": word_count,
                "speechDurationSeconds": round(speech_seconds, 6),
                "explicitSentenceAndTransitionSilenceSeconds": round(sentence_transition_seconds, 6),
                "speechOnlyWordsPerMinute": round(speech_wpm, 2),
                "overallWordsPerMinute": round(overall_wpm, 2),
                "speechOnlyWPMRange": variant["speechOnlyWPMRange"],
                "listPauseMs": variant["listPauseMs"],
                "clausePauseMs": variant["clausePauseMs"],
                "sentenceGapMs": variant["sentenceGapMs"],
                "practiceTransitionGapMs": variant["practiceTransitionGapMs"],
                "seed": variant["seed"],
                "exaggeration": variant["exaggeration"],
                "cfgWeight": variant["cfgWeight"],
                "temperature": variant["temperature"],
                "assembly": "context-aware-phrase-generation-plus-bounded-semantic-pause-extension-no-time-stretch-no-normalization",
                "units": unit_records,
                "semanticPauses": pause_records,
                "relativePath": str(output.relative_to(output_root)),
                **details,
            }
        )
        print(
            f"generated {variant['id']}: {details['durationSeconds']:.2f}s, "
            f"speech-only {speech_wpm:.2f} WPM, overall {overall_wpm:.2f} WPM",
            flush=True,
        )

    manifest = {
        "schemaVersion": 1,
        "auditionVersion": plan["auditionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "processBoundary": {
            "scope": "english-default-voice-F1-F2-only",
            "selectedVariantIDs": [item["id"] for item in plan["variants"]],
            "generationInputLanguage": "en",
            "otherLanguageGenerationCalls": 0,
            "modelLoadedFreshForThisProcess": True,
            "generationCallCount": sum(len(item["units"]) for excerpt in plan["excerpts"] for item in excerpt["sentences"]) * 2,
        },
        "rightsState": plan["rightsState"],
        "releaseRightsState": plan["releaseRightsState"],
        "ownerDirection": plan["ownerDirection"],
        "source": plan["source"],
        "model": plan["model"],
        "generation": generation,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "torch": torch.__version__,
            "chatterboxTTS": importlib.metadata.version("chatterbox-tts"),
            "device": device,
        },
        "modelFileSHA256": model_hashes,
        "results": results,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote private exact-two manifest: {manifest_path.name}", flush=True)

    del model
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise

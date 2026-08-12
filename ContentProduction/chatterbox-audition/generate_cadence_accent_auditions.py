#!/usr/bin/env python3
"""Generate the bounded owner-directed cadence/accent audition revision.

Invoke English once with ``--scope english``. Invoke each German candidate in
its own OS process with ``--scope german --variant ID``. German model calls
always receive ``language_id="de"`` and no reference audio is permitted.
Raw WAVs and process manifests remain under the ignored auditions directory.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
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
DEFAULT_PLAN = PROJECT_ROOT / "ContentProduction" / "cadence-accent-audition-plan.json"
ENGLISH_IDS = {"en-e1-slower-fluid-1100", "en-e2-slower-fluid-1350"}
GERMAN_IDS = {
    "de-c1-accent-stability",
    "de-c2-accent-stability",
    "de-c3-accent-stability",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def word_count(text: str) -> int:
    return len(re.findall(r"[^\W_]+(?:[-’'][^\W_]+)*", text, flags=re.UNICODE))


def load_and_validate_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != 1:
        raise ValueError("Unsupported cadence/accent plan schema")
    if plan["model"].get("voiceReference") is not None:
        raise ValueError("Cadence/accent auditions must not use reference audio")

    excerpt_keys: set[tuple[str, str]] = set()
    for excerpt in plan["excerpts"]:
        key = (excerpt["id"], excerpt["language"])
        if key in excerpt_keys:
            raise ValueError(f"Duplicate excerpt: {key}")
        script_path = (
            PROJECT_ROOT
            / "Content"
            / "guided"
            / excerpt["id"]
            / f"script.{excerpt['language']}.md"
        )
        if sha256(script_path) != excerpt["scriptSHA256"]:
            raise ValueError(f"Script hash mismatch for {key}")
        script = script_path.read_text(encoding="utf-8")
        if any(sentence not in script for sentence in excerpt["sentences"]):
            raise ValueError(f"Non-literal source sentence in {key}")
        excerpt_keys.add(key)

    variants = plan["variants"]
    variant_ids = {variant["id"] for variant in variants}
    if variant_ids != ENGLISH_IDS | GERMAN_IDS or len(variants) != 5:
        raise ValueError("Plan must contain the exact corrected two English and three German variants")
    for variant in variants:
        language = variant["language"]
        expected_ids = ENGLISH_IDS if language == "en" else GERMAN_IDS
        if variant["id"] not in expected_ids:
            raise ValueError(f"Variant language mismatch: {variant['id']}")
        for excerpt_id in variant["excerptIDs"]:
            if (excerpt_id, language) not in excerpt_keys:
                raise ValueError(f"Unknown excerpt {excerpt_id}.{language}")

    english = [variant for variant in variants if variant["language"] == "en"]
    if {variant["sentenceGapMs"] for variant in english} != {1100, 1350}:
        raise ValueError("English sentence gaps must be exactly 1100 and 1350 ms")
    if {variant["practiceTransitionGapMs"] for variant in english} != {1600, 1900}:
        raise ValueError("English transition gaps must be exactly 1600 and 1900 ms")
    cadence_keys = ("seed", "exaggeration", "cfgWeight", "temperature")
    if any(english[0][key] != english[1][key] for key in cadence_keys):
        raise ValueError("E1 and E2 must share the same regenerated sentence delivery")

    german = [variant for variant in variants if variant["language"] == "de"]
    if len({variant["seed"] for variant in german}) != 3:
        raise ValueError("German accent-stability candidates require three distinct seeds")
    if any(
        variant["sentenceGapMs"] != 750 or variant["practiceTransitionGapMs"] != 1200
        for variant in german
    ):
        raise ValueError("German candidates must preserve C-like 750/1200 ms pacing")
    return plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--scope", choices=("english", "german"), required=True)
    parser.add_argument("--variant", choices=sorted(GERMAN_IDS))
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    arguments = parser.parse_args()
    if arguments.scope == "english" and arguments.variant:
        parser.error("--variant is forbidden for the English two-clip process")
    if arguments.scope == "german" and not arguments.variant:
        parser.error("one exact --variant is required for each isolated German process")
    return arguments


def select_device(requested: str, torch: Any) -> str:
    if requested != "auto":
        if requested == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("MPS was requested but is not available")
        return requested
    return "mps" if torch.backends.mps.is_available() else "cpu"


def seed_everything(seed: int, torch: Any, numpy: Any) -> None:
    random.seed(seed)
    numpy.random.seed(seed)
    torch.manual_seed(seed)
    if torch.backends.mps.is_available() and hasattr(torch, "mps"):
        torch.mps.manual_seed(seed)


def model_allow_patterns(plan: dict[str, Any]) -> list[str]:
    return [
        "ve.safetensors",
        "t3_cfg.safetensors",
        "s3gen.safetensors",
        "tokenizer.json",
        "conds.pt",
        "ve.pt",
        plan["model"]["germanT3Model"],
        "s3gen.pt",
        "grapheme_mtl_merged_expanded_v1.json",
        "Cangjie5_TC.json",
    ]


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
    if args.scope == "english":
        variants = [variant for variant in plan["variants"] if variant["id"] in ENGLISH_IDS]
        fragment_name = "manifest.english.json"
        language = "en"
    else:
        variants = [variant for variant in plan["variants"] if variant["id"] == args.variant]
        fragment_name = f"manifest.{args.variant}.json"
        language = "de"
    if args.validate_only:
        print(f"Validated isolated {args.scope} scope: {', '.join(v['id'] for v in variants)}")
        return 0

    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    import numpy
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.tts import ChatterboxTTS
    from huggingface_hub import snapshot_download

    device = select_device(args.device, torch)
    patterns = model_allow_patterns(plan)
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
    model_hashes = {
        name: sha256(snapshot / name) for name in patterns if (snapshot / name).is_file()
    }
    if language == "en":
        model = ChatterboxTTS.from_local(snapshot, device)
    else:
        model = ChatterboxMultilingualTTS.from_local(
            snapshot, device, t3_model=plan["model"]["germanT3Model"]
        )

    excerpt_map = {(item["id"], item["language"]): item for item in plan["excerpts"]}
    generation = plan["generation"]
    output_root = PROJECT_ROOT / "ContentProduction" / "auditions" / plan["auditionVersion"]
    fragment_path = output_root / fragment_name
    if fragment_path.exists() and not args.overwrite:
        raise FileExistsError(f"Refusing to overwrite private process manifest: {fragment_path}")

    results: list[dict[str, Any]] = []
    segment_cache: dict[tuple[Any, ...], Any] = {}
    generation_call_count = 0
    for variant_index, variant in enumerate(variants):
        output = output_root / "raw" / f"{variant['id']}.G01-G30.wav"
        if output.exists() and not args.overwrite:
            raise FileExistsError(f"Refusing to overwrite private audition: {output}")
        assembled: list[Any] = []
        segment_records: list[dict[str, Any]] = []
        all_text: list[str] = []
        sentence_ordinal = 0
        speech_frames = 0
        for excerpt_position, excerpt_id in enumerate(variant["excerptIDs"]):
            excerpt = excerpt_map[(excerpt_id, language)]
            for sentence_position, sentence in enumerate(excerpt["sentences"]):
                seed = int(variant["seed"]) + sentence_ordinal
                cache_key = (
                    language,
                    sentence,
                    seed,
                    variant["exaggeration"],
                    variant["cfgWeight"],
                    variant["temperature"],
                )
                reused = cache_key in segment_cache
                if not reused:
                    seed_everything(seed, torch, numpy)
                    kwargs: dict[str, Any] = {
                        "text": sentence,
                        "repetition_penalty": generation["repetitionPenalty"],
                        "min_p": generation["minP"],
                        "top_p": generation["topP"],
                        "exaggeration": variant["exaggeration"],
                        "cfg_weight": variant["cfgWeight"],
                        "temperature": variant["temperature"],
                    }
                    if language == "de":
                        kwargs["language_id"] = "de"
                    waveform = model.generate(**kwargs)
                    segment_cache[cache_key] = waveform.detach().cpu().float().reshape(-1).numpy()
                    generation_call_count += 1
                samples = segment_cache[cache_key]
                segment_words = word_count(sentence)
                segment_seconds = float(samples.size) / generation["sampleRate"]
                assembled.append(samples)
                all_text.append(sentence)
                speech_frames += int(samples.size)
                segment_records.append(
                    {
                        "excerptID": excerpt_id,
                        "sentenceIndex": sentence_position,
                        "seed": seed,
                        "textSHA256": hashlib.sha256(sentence.encode("utf-8")).hexdigest(),
                        "wordCount": segment_words,
                        "frames": int(samples.size),
                        "durationSeconds": round(segment_seconds, 6),
                        "sentenceUnitWordsPerMinute": round(segment_words / segment_seconds * 60, 2),
                        "languageID": "de" if language == "de" else None,
                        "newModelGenerationCall": not reused,
                    }
                )
                sentence_ordinal += 1
                if sentence_position < len(excerpt["sentences"]) - 1:
                    gap_frames = round(
                        generation["sampleRate"] * variant["sentenceGapMs"] / 1000
                    )
                    assembled.append(numpy.zeros(gap_frames, dtype=numpy.float32))
            if excerpt_position < len(variant["excerptIDs"]) - 1:
                transition_frames = round(
                    generation["sampleRate"]
                    * variant["practiceTransitionGapMs"]
                    / 1000
                )
                assembled.append(numpy.zeros(transition_frames, dtype=numpy.float32))

        joined = numpy.concatenate(assembled)
        details = write_pcm16(output, joined, int(generation["sampleRate"]), numpy)
        words = word_count(" ".join(all_text))
        speech_seconds = float(speech_frames) / generation["sampleRate"]
        inserted_seconds = (int(details["frames"]) - speech_frames) / generation["sampleRate"]
        results.append(
            {
                "id": variant["id"],
                "language": language,
                "label": variant["label"],
                "voiceLabel": plan["model"]["voiceLabels"][language],
                "deliveryClaim": variant["deliveryClaim"],
                "excerptIDs": variant["excerptIDs"],
                "sourceScriptSHA256": [
                    excerpt_map[(value, language)]["scriptSHA256"]
                    for value in variant["excerptIDs"]
                ],
                "promptSHA256": hashlib.sha256(
                    "\n\n".join(all_text).encode("utf-8")
                ).hexdigest(),
                "wordCount": words,
                "speechDurationSeconds": round(speech_seconds, 6),
                "explicitInsertedSilenceSeconds": round(inserted_seconds, 6),
                "speechOnlyWordsPerMinute": round(words / speech_seconds * 60.0, 2),
                "overallWordsPerMinute": round(words / details["durationSeconds"] * 60.0, 2),
                "sentenceGapMs": variant["sentenceGapMs"],
                "practiceTransitionGapMs": variant["practiceTransitionGapMs"],
                "seed": variant["seed"],
                "exaggeration": variant["exaggeration"],
                "cfgWeight": variant["cfgWeight"],
                "temperature": variant["temperature"],
                "assembly": "complete-sentence-units-then-explicit-silence-no-time-stretch-no-normalization",
                "segments": segment_records,
                "relativePath": str(output.relative_to(output_root)),
                **details,
            }
        )
        print(
            f"generated: {variant['id']} {details['durationSeconds']:.2f}s "
            f"speech {results[-1]['speechOnlyWordsPerMinute']:.1f} WPM / "
            f"overall {results[-1]['overallWordsPerMinute']:.1f} WPM",
            flush=True,
        )

    fragment = {
        "schemaVersion": 1,
        "auditionVersion": plan["auditionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "processBoundary": {
            "scope": f"{args.scope}-only",
            "selectedVariantIDs": [variant["id"] for variant in variants],
            "modelLoadedFreshForThisProcess": True,
            "generationInputLanguage": language,
            "otherLanguageGenerationCalls": 0,
            "languageIDExplicitOnEveryGermanCall": language == "de",
            "generationCallCount": generation_call_count,
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
    output_root.mkdir(parents=True, exist_ok=True)
    fragment_path.write_text(
        json.dumps(fragment, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote private isolated-process manifest: {fragment_name}", flush=True)

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

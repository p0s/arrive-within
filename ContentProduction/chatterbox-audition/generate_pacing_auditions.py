#!/usr/bin/env python3
"""Generate sentence-aware default-voice pacing auditions.

Raw WAVs and the detailed manifest remain in the ignored auditions directory.
No time-stretching, reference audio, per-chunk normalization, or system TTS is
used. Full sentence/clause waveforms are assembled with explicit silence and
only the assembled comparison clip is written.
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
DEFAULT_PLAN = PROJECT_ROOT / "ContentProduction" / "pacing-audition-plan.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_and_validate_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != 1:
        raise ValueError("Unsupported pacing-audition plan schema")
    if plan["model"].get("voiceReference") is not None:
        raise ValueError("Pacing auditions must not use reference audio")

    excerpts: dict[tuple[str, str], dict[str, Any]] = {}
    for excerpt in plan["excerpts"]:
        key = (excerpt["id"], excerpt["language"])
        if key in excerpts:
            raise ValueError(f"Duplicate excerpt: {key}")
        script_path = PROJECT_ROOT / "Content" / "guided" / excerpt["id"] / f"script.{excerpt['language']}.md"
        if sha256(script_path) != excerpt["scriptSHA256"]:
            raise ValueError(f"Script hash mismatch for {key}")
        script = script_path.read_text(encoding="utf-8")
        for sentence in excerpt["sentences"]:
            if sentence not in script:
                raise ValueError(f"Sentence is not literal source text for {key}: {sentence}")
        excerpts[key] = excerpt

    expected_ids = {"en-approved-pacing-700", "en-approved-pacing-850", "de-a-natural-calm", "de-b-deep-calm", "de-c-conversational-slow"}
    variant_ids = {variant["id"] for variant in plan["variants"]}
    if variant_ids != expected_ids or len(plan["variants"]) != len(expected_ids):
        raise ValueError("Pacing plan must contain the exact two English and three German variants")
    for variant in plan["variants"]:
        language = variant["language"]
        if language not in {"en", "de"}:
            raise ValueError(f"Unsupported language: {language}")
        if variant["sentenceGapMs"] < 650 or variant["sentenceGapMs"] > 900:
            raise ValueError(f"Sentence gap outside owner-directed range: {variant['id']}")
        if variant["practiceTransitionGapMs"] < 1100 or variant["practiceTransitionGapMs"] > 1400:
            raise ValueError(f"Transition gap outside owner-directed range: {variant['id']}")
        for excerpt_id in variant["excerptIDs"]:
            if (excerpt_id, language) not in excerpts:
                raise ValueError(f"Unknown excerpt {excerpt_id}.{language}")
    return plan


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
        "ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json",
        "conds.pt", "ve.pt", plan["model"]["germanT3Model"], "s3gen.pt",
        "grapheme_mtl_merged_expanded_v1.json", "Cangjie5_TC.json",
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--variant", action="append")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


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
    plan = load_and_validate_plan(args.plan.resolve())
    variants = [v for v in plan["variants"] if not args.variant or v["id"] in args.variant]
    if not variants:
        raise ValueError("No pacing variants selected")
    print(f"Validated {len(variants)} pacing variants", flush=True)
    if args.validate_only:
        return 0

    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    import numpy
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.tts import ChatterboxTTS
    from huggingface_hub import snapshot_download

    device = select_device(args.device, torch)
    snapshot = Path(snapshot_download(
        repo_id=plan["model"]["repository"], repo_type="model",
        revision=plan["model"]["revision"], allow_patterns=model_allow_patterns(plan),
        cache_dir=PROJECT_ROOT / "ContentProduction" / "model-cache" / "huggingface",
        max_workers=2,
    ))
    weight_files = {name: sha256(snapshot / name) for name in model_allow_patterns(plan) if (snapshot / name).is_file()}
    excerpt_map = {(e["id"], e["language"]): e for e in plan["excerpts"]}
    generation = plan["generation"]
    output_root = PROJECT_ROOT / "ContentProduction" / "auditions" / plan["auditionVersion"]
    raw_root = output_root / "raw"
    results: list[dict[str, Any]] = []
    segment_cache: dict[tuple[Any, ...], Any] = {}

    for language in ("en", "de"):
        language_variants = [v for v in variants if v["language"] == language]
        if not language_variants:
            continue
        print(f"Loading {language} default model on {device}", flush=True)
        if language == "en":
            model = ChatterboxTTS.from_local(snapshot, device)
        else:
            model = ChatterboxMultilingualTTS.from_local(snapshot, device, t3_model=plan["model"]["germanT3Model"])

        for variant in language_variants:
            output = raw_root / f"{variant['id']}.G01-G30.wav"
            sentence_index = 0
            assembled: list[Any] = []
            segment_records: list[dict[str, Any]] = []
            all_text: list[str] = []
            for excerpt_position, excerpt_id in enumerate(variant["excerptIDs"]):
                excerpt = excerpt_map[(excerpt_id, language)]
                for position, sentence in enumerate(excerpt["sentences"]):
                    seed = int(variant["seed"]) + sentence_index
                    cache_key = (
                        language, sentence, seed, variant["exaggeration"],
                        variant["cfgWeight"], variant["temperature"],
                    )
                    if cache_key not in segment_cache:
                        seed_everything(seed, torch, numpy)
                        kwargs = {
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
                    samples = segment_cache[cache_key]
                    assembled.append(samples)
                    all_text.append(sentence)
                    segment_records.append({
                        "excerptID": excerpt_id,
                        "sentenceIndex": position,
                        "seed": seed,
                        "textSHA256": hashlib.sha256(sentence.encode("utf-8")).hexdigest(),
                        "frames": int(samples.size),
                    })
                    sentence_index += 1
                    if position < len(excerpt["sentences"]) - 1:
                        assembled.append(numpy.zeros(round(generation["sampleRate"] * variant["sentenceGapMs"] / 1000), dtype=numpy.float32))
                if excerpt_position < len(variant["excerptIDs"]) - 1:
                    assembled.append(numpy.zeros(round(generation["sampleRate"] * variant["practiceTransitionGapMs"] / 1000), dtype=numpy.float32))

            joined = numpy.concatenate(assembled)
            if output.exists() and not args.overwrite:
                raise FileExistsError(f"Refusing to overwrite existing private audition: {output}")
            details = write_pcm16(output, joined, int(generation["sampleRate"]), numpy)
            word_count = len(re.findall(r"[^\W_]+(?:[-’'][^\W_]+)*", " ".join(all_text), flags=re.UNICODE))
            results.append({
                "id": variant["id"],
                "language": language,
                "label": variant["label"],
                "voiceLabel": plan["model"]["voiceLabels"][language],
                "deliveryClaim": variant["deliveryClaim"],
                "excerptIDs": variant["excerptIDs"],
                "sourceScriptSHA256": [excerpt_map[(value, language)]["scriptSHA256"] for value in variant["excerptIDs"]],
                "promptSHA256": hashlib.sha256("\n\n".join(all_text).encode("utf-8")).hexdigest(),
                "wordCount": word_count,
                "overallWordsPerMinute": round(word_count / details["durationSeconds"] * 60.0, 2),
                "sentenceGapMs": variant["sentenceGapMs"],
                "practiceTransitionGapMs": variant["practiceTransitionGapMs"],
                "seed": variant["seed"],
                "exaggeration": variant["exaggeration"],
                "cfgWeight": variant["cfgWeight"],
                "temperature": variant["temperature"],
                "assembly": "complete-sentence-units-then-silence-no-time-stretch-no-normalization",
                "segments": segment_records,
                "relativePath": str(output.relative_to(output_root)),
                **details,
            })
            print(f"generated: {variant['id']} {details['durationSeconds']:.2f}s {results[-1]['overallWordsPerMinute']:.1f} WPM", flush=True)

        del model
        gc.collect()
        if device == "mps":
            torch.mps.empty_cache()

    manifest = {
        "schemaVersion": 1,
        "auditionVersion": plan["auditionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "reviewState": "english-pacing-and-german-direction-awaiting-owner-review",
        "rightsState": plan["rightsState"],
        "releaseRightsState": plan["releaseRightsState"],
        "ownerDirection": plan["ownerDirection"],
        "source": plan["source"],
        "model": plan["model"],
        "generation": generation,
        "environment": {
            "python": platform.python_version(), "platform": platform.platform(),
            "torch": torch.__version__, "chatterboxTTS": importlib.metadata.version("chatterbox-tts"),
            "device": device,
        },
        "modelFileSHA256": weight_files,
        "results": results,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote private pacing manifest with {len(results)} variants", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise

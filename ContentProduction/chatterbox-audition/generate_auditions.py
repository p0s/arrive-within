#!/usr/bin/env python3
"""Generate the pinned, default-voice Arrive Within narration auditions.

Generated media and the detailed local manifest live under the ignored
ContentProduction/auditions directory. This script and its lockfile are public
reproducibility inputs; they never accept or discover reference voices.
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
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PLAN = PROJECT_ROOT / "ContentProduction" / "audition-plan.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_and_validate_plan(plan_path: Path) -> dict[str, Any]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != 1:
        raise ValueError("Unsupported audition plan schema")
    if plan["model"].get("voiceReference") is not None:
        raise ValueError("The default-voice audition must not use a reference voice")

    seen: set[tuple[str, str]] = set()
    for excerpt in plan["excerpts"]:
        key = (excerpt["id"], excerpt["language"])
        if key in seen:
            raise ValueError(f"Duplicate audition cell: {key}")
        seen.add(key)
        if excerpt["language"] not in {"en", "de"}:
            raise ValueError(f"Unsupported audition language: {excerpt['language']}")

        script_path = (
            PROJECT_ROOT
            / "Content"
            / "guided"
            / excerpt["id"]
            / f"script.{excerpt['language']}.md"
        )
        actual_hash = sha256(script_path)
        if actual_hash != excerpt["scriptSHA256"]:
            raise ValueError(
                f"Script hash mismatch for {key}: {actual_hash} != "
                f"{excerpt['scriptSHA256']}"
            )
        script = script_path.read_text(encoding="utf-8")
        if excerpt["text"] not in script:
            raise ValueError(f"Audition excerpt is not literal source text for {key}")

    expected = {(practice, language) for practice in ("G01", "G10", "G17", "G24", "G30", "G41") for language in ("en", "de")}
    if seen != expected:
        raise ValueError(f"Audition matrix differs from the required 6x2 set: {sorted(seen)}")
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


def write_pcm16_mono(path: Path, waveform: Any, sample_rate: int, numpy: Any) -> dict[str, Any]:
    samples = waveform.detach().cpu().float().reshape(-1).numpy()
    nonfinite = int((~numpy.isfinite(samples)).sum())
    if nonfinite:
        raise ValueError(f"Generated waveform contains {nonfinite} non-finite samples")
    clipped_samples = int(((samples < -1.0) | (samples > 1.0)).sum())
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
        "clippedInputSamples": clipped_samples,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--language", action="append", choices=("en", "de"))
    parser.add_argument("--practice", action="append")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plan = load_and_validate_plan(args.plan.resolve())
    print(f"Validated {len(plan['excerpts'])} pinned audition cells")
    if args.validate_only:
        return 0

    # The public model is accessible over ordinary HTTPS. Disabling Xet keeps
    # the project-local cache inspectable and avoids opaque staging hangs.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    import numpy
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.tts import ChatterboxTTS
    from huggingface_hub import snapshot_download

    device = select_device(args.device, torch)
    snapshot = Path(
        snapshot_download(
            repo_id=plan["model"]["repository"],
            repo_type="model",
            revision=plan["model"]["revision"],
            allow_patterns=model_allow_patterns(plan),
            cache_dir=PROJECT_ROOT / "ContentProduction" / "model-cache" / "huggingface",
            max_workers=2,
        )
    )
    weight_files = {
        name: sha256(snapshot / name)
        for name in model_allow_patterns(plan)
        if (snapshot / name).is_file()
    }
    if args.download_only:
        print(f"Verified {len(weight_files)} pinned model files")
        return 0

    cells = [
        excerpt
        for excerpt in plan["excerpts"]
        if (not args.language or excerpt["language"] in args.language)
        and (not args.practice or excerpt["id"] in args.practice)
    ]
    if not cells:
        raise ValueError("The requested filters selected no audition cells")

    output_root = PROJECT_ROOT / "ContentProduction" / "auditions" / plan["auditionVersion"]
    raw_root = output_root / "raw"
    generation = plan["generation"]
    results: list[dict[str, Any]] = []

    for language in ("en", "de"):
        language_cells = [cell for cell in cells if cell["language"] == language]
        if not language_cells:
            continue
        print(f"Loading {language} default model on {device}", flush=True)
        if language == "en":
            model = ChatterboxTTS.from_local(snapshot, device)
        else:
            model = ChatterboxMultilingualTTS.from_local(
                snapshot,
                device,
                t3_model=plan["model"]["germanT3Model"],
            )

        for cell in language_cells:
            output = raw_root / f"{cell['id']}.{language}.wav"
            if output.exists() and not args.overwrite:
                with wave.open(str(output), "rb") as existing:
                    details = {
                        "sampleRate": existing.getframerate(),
                        "channels": existing.getnchannels(),
                        "sampleFormat": f"pcm_{existing.getsampwidth() * 8}bit",
                        "frames": existing.getnframes(),
                        "durationSeconds": round(existing.getnframes() / existing.getframerate(), 6),
                        "clippedInputSamples": None,
                        "bytes": output.stat().st_size,
                        "sha256": sha256(output),
                    }
                status = "reused-existing"
            else:
                seed_everything(int(generation["seed"]), torch, numpy)
                kwargs = {
                    "text": cell["text"],
                    "repetition_penalty": generation["repetitionPenalty"],
                    "min_p": generation["minP"],
                    "top_p": generation["topP"],
                    "exaggeration": generation["exaggeration"],
                    "cfg_weight": generation["cfgWeight"],
                    "temperature": generation["temperature"],
                }
                if language == "de":
                    kwargs["language_id"] = "de"
                waveform = model.generate(**kwargs)
                details = write_pcm16_mono(output, waveform, int(generation["sampleRate"]), numpy)
                status = "generated"
            results.append(
                {
                    "id": cell["id"],
                    "language": language,
                    "voiceLabel": plan["model"]["voiceLabels"][language],
                    "sourceScriptSHA256": cell["scriptSHA256"],
                    "excerptSHA256": hashlib.sha256(cell["text"].encode("utf-8")).hexdigest(),
                    "relativePath": str(output.relative_to(output_root)),
                    "status": status,
                    **details,
                }
            )
            print(f"{status}: {cell['id']}.{language} {details['durationSeconds']:.2f}s", flush=True)

        del model
        gc.collect()
        if device == "mps":
            torch.mps.empty_cache()

    manifest = {
        "schemaVersion": 1,
        "auditionVersion": plan["auditionVersion"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "reviewState": "awaiting-owner-and-fluent-bilingual-review",
        "rightsState": plan["rightsState"],
        "releaseRightsState": plan["releaseRightsState"],
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
        "modelFileSHA256": weight_files,
        "results": results,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote private audition manifest with {len(results)} cells")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise

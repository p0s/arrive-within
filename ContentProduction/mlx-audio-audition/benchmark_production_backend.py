#!/usr/bin/env python3
"""Run a non-persisting Arrive Within production-direction MLX benchmark.

This loads the exact pinned Resemble checkpoints directly and sanitizes them in
memory with mlx-audio 0.4.8.  It never downloads or stores a converted model and
never writes into the narration candidate library.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any

import mlx.core as mx
import numpy as np
import soundfile


ROOT = Path(__file__).resolve().parents[2]
PYTORCH_GENERATOR = (
    ROOT / "ContentProduction" / "chatterbox-audition" / "generate_production_candidates.py"
)
PLAN = ROOT / "ContentProduction" / "narration-production-plan.json"
CATALOG = ROOT / "Content" / "guided" / "catalog.json"
CONDITIONALS = ROOT / "ContentProduction" / "model-cache" / "mlx-audio" / "conds-v3.npz"
PRIVATE_EVIDENCE = ROOT / ".evidence" / "audio"
MEMORY_GUARD_ENVIRONMENT_KEY = "ARRIVE_WITHIN_NARRATION_MEMORY_GUARD"
MLX_AUDIO_RELEASE = "0.4.8"
MLX_AUDIO_TAG_COMMIT = "49596ac8b69b9ed377db311a73df838795f38a3d"
MODEL_INITIALIZATION_SEED = 20260812


def load_pipeline_module() -> Any:
    spec = importlib.util.spec_from_file_location("arrive_narration_pipeline", PYTORCH_GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the narration production pipeline")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_private_report(path: Path) -> Path:
    resolved = path.resolve()
    private_root = PRIVATE_EVIDENCE.resolve()
    if resolved.parent != private_root or not resolved.name.startswith(".narration-probe-"):
        raise ValueError("MLX probe report must be a private guard-owned audio evidence file")
    return resolved


def load_conditionals(plan: dict[str, Any]) -> Any:
    from mlx_audio.tts.models.chatterbox.chatterbox import Conditionals
    from mlx_audio.tts.models.chatterbox.t3.cond_enc import T3Cond

    with np.load(CONDITIONALS, allow_pickle=False) as archive:
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
            cond_prompt_speech_tokens=mx.array(archive["t3.cond_prompt_speech_tokens"]),
            emotion_adv=mx.array(archive["t3.emotion_adv"]),
        )
        gen = {
            name.removeprefix("gen."): mx.array(archive[name])
            for name in archive.files
            if name.startswith("gen.")
        }
    mx.eval(t3.speaker_emb, t3.cond_prompt_speech_tokens, t3.emotion_adv, *gen.values())
    return Conditionals(t3=t3, gen=gen)


def load_model(language: str, plan: dict[str, Any], pipeline: Any) -> tuple[Any, dict[str, str]]:
    from mlx_audio.tts.models.chatterbox.chatterbox import Model
    from mlx_audio.tts.models.chatterbox.config import ModelConfig, T3Config
    from mlx_audio.tts.models.chatterbox.s3gen import S3Token2Wav
    from mlx_audio.tts.models.chatterbox.scripts.convert import load_s3gen_strict
    from mlx_audio.tts.models.chatterbox.t3 import T3
    from mlx_audio.tts.models.chatterbox.tokenizer import EnTokenizer, MTLTokenizer

    snapshot = (
        ROOT
        / "ContentProduction"
        / "model-cache"
        / "huggingface"
        / "models--ResembleAI--chatterbox"
        / "snapshots"
        / plan["model"]["revision"]
    )
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
    names = (t3_name, "s3gen.safetensors", tokenizer_name, "conds.pt")
    hashes: dict[str, str] = {}
    for name in names:
        path = snapshot / name
        actual = sha256(path.resolve(strict=True))
        if actual != plan["modelFileSHA256"][name]:
            raise RuntimeError(f"Pinned model hash mismatch: {name}")
        hashes[name] = actual

    # Construct only the two inference components needed with precomputed
    # conditionals. This avoids allocating the unused voice encoder/tokenizer.
    t3 = T3(config.t3_config)
    s3gen = S3Token2Wav()
    model = Model(t3, s3gen=s3gen, ve=None, conds=load_conditionals(plan))
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
        key: value for key, value in s3_weights.items() if not key.startswith("tokenizer.")
    }
    s3_weights = model.s3gen.sanitize(s3_weights)
    load_s3gen_strict(model.s3gen, s3_weights)
    mx.eval(model.s3gen.parameters())
    del s3_weights
    mx.clear_cache()
    model.eval()
    return model, hashes


def bounded_generate(
    model: Any, kwargs: dict[str, Any], token_limit: int
) -> tuple[Any, str, int]:
    original = model.t3.inference
    stop_token = int(model.t3.hp.stop_speech_token)
    captured_tokens: list[np.ndarray] = []

    def inference(*args: Any, **inference_kwargs: Any) -> Any:
        inference_kwargs["max_new_tokens"] = min(
            int(inference_kwargs.get("max_new_tokens") or token_limit), token_limit
        )
        tokens = original(*args, **inference_kwargs)
        token_values = np.asarray(tokens, dtype=np.int32).reshape(-1)
        captured_tokens.append(token_values)
        token_count = int(tokens.shape[-1])
        last_token = int(tokens.reshape(-1)[-1].item())
        if token_count >= token_limit and last_token != stop_token:
            raise RuntimeError(
                f"MLX Chatterbox reached {token_limit} speech tokens without EOS"
            )
        return tokens

    model.t3.inference = inference
    try:
        results = list(model.generate(**kwargs, max_new_tokens=token_limit, verbose=False))
    finally:
        model.t3.inference = original
    if len(results) != 1:
        raise RuntimeError("MLX Chatterbox returned an unexpected segment count")
    if len(captured_tokens) != 1:
        raise RuntimeError("MLX Chatterbox did not expose exactly one speech-token stream")
    token_values = captured_tokens[0]
    return (
        results[0],
        hashlib.sha256(token_values.tobytes()).hexdigest(),
        int(token_values.size),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=("en", "de"), required=True)
    parser.add_argument("--practice", choices=tuple(f"G{i:02d}" for i in range(1, 43)), required=True)
    parser.add_argument("--unit-count", type=int, choices=(1, 2, 4, 8), default=1)
    parser.add_argument("--unit-start", type=int, default=0)
    parser.add_argument("--token-limit-override", type=int)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.unit_start < 0:
        parser.error("--unit-start must be non-negative")
    if args.token_limit_override is not None and not 192 <= args.token_limit_override <= 600:
        parser.error("--token-limit-override must be between 192 and 600")
    if os.environ.get(MEMORY_GUARD_ENVIRONMENT_KEY) != "1":
        raise RuntimeError("MLX narration probes must run through the host memory guard")

    pipeline = load_pipeline_module()
    plan = pipeline.load_and_validate_plan(PLAN)
    catalog = pipeline.load_and_validate_catalog(CATALOG)
    practice = next(item for item in catalog["practices"] if item["id"] == args.practice)
    inputs = pipeline.memory_probe_inputs(
        practice,
        args.language,
        plan,
        args.unit_count,
        args.unit_start,
    )
    if args.token_limit_override is not None:
        inputs = [
            {**item, "tokenLimit": args.token_limit_override}
            for item in inputs
        ]
    report_path = require_private_report(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    mx.reset_peak_memory()
    # mlx-audio intentionally regenerates non-checkpoint S3 buffers during
    # construction. Seed that construction independently of per-unit sampling
    # so fresh worker processes reproduce the same PCM.
    mx.random.seed(MODEL_INITIALIZATION_SEED)
    load_started = time.monotonic()
    model, model_hashes = load_model(args.language, plan, pipeline)
    load_seconds = time.monotonic() - load_started
    outputs: list[dict[str, Any]] = []
    output_root = PRIVATE_EVIDENCE / "narration-mlx-probes"
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for item in inputs:
        kwargs = dict(item["kwargs"])
        if "language_id" in kwargs:
            kwargs["lang_code"] = kwargs.pop("language_id")
        mx.random.seed(int(item["seed"]))
        started = time.monotonic()
        result, speech_token_hash, speech_token_count = bounded_generate(
            model, kwargs, int(item["tokenLimit"])
        )
        mx.eval(result.audio)
        elapsed = time.monotonic() - started
        samples = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        if samples.size == 0 or not np.isfinite(samples).all():
            raise RuntimeError("MLX Chatterbox produced invalid PCM")
        measurements = pipeline.signal_measurements(samples, int(result.sample_rate), np)
        output = output_root / (
            f"{args.practice}-{args.language}-unit-"
            f"{int(item['generationOrdinal']) + 1:04d}-"
            f"{report_path.stem.removeprefix('.narration-probe-')}.wav"
        )
        soundfile.write(output, samples, int(result.sample_rate), subtype="PCM_24")
        output.chmod(0o600)
        outputs.append(
            {
                "unitTextSHA256": pipeline.text_sha256(item["unit"].source_text),
                "generationTextSHA256": pipeline.text_sha256(item["unit"].generation_text),
                "generationOrdinal": item["generationOrdinal"],
                "seed": item["seed"],
                "speechTokenLimit": item["tokenLimit"],
                "speechTokenCount": speech_token_count,
                "speechTokenInt32SHA256": speech_token_hash,
                "sampleCount": int(samples.size),
                "sampleRate": int(result.sample_rate),
                "durationSeconds": measurements["durationSeconds"],
                "pcmFloat32SHA256": hashlib.sha256(samples.tobytes()).hexdigest(),
                "processingSeconds": elapsed,
                "output": str(output),
                "outputSHA256": sha256(output),
            }
        )
        del result, samples
        mx.clear_cache()

    payload = {
        "schemaVersion": 1,
        "backend": "mlx-audio-full-native",
        "mlxAudioVersion": importlib.metadata.version("mlx-audio"),
        "mlxAudioTagCommit": MLX_AUDIO_TAG_COMMIT,
        "mlxVersion": importlib.metadata.version("mlx"),
        "modelInitializationSeed": MODEL_INITIALIZATION_SEED,
        "python": platform.python_version(),
        "contentID": args.practice,
        "language": args.language,
        "unitCountRequested": args.unit_count,
        "unitStartOrdinal": args.unit_start,
        "tokenLimitOverride": args.token_limit_override,
        "modelLoadSeconds": load_seconds,
        "modelFileSHA256": model_hashes,
        "conditionalsSHA256": sha256(CONDITIONALS),
        "peakMLXBytes": int(mx.get_peak_memory()),
        "outputPersistedToCandidateLibrary": False,
        "units": outputs,
    }
    report_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report_path.chmod(0o600)
    print(json.dumps(payload, sort_keys=True), flush=True)
    del model
    gc.collect()
    mx.clear_cache()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

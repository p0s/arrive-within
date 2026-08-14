#!/usr/bin/env python3
"""Export the pinned Chatterbox conditionals into a private NumPy container.

The source ``conds.pt`` is loaded only in the pinned PyTorch environment.  The
result contains plain arrays so the isolated MLX environment never needs to
import PyTorch or deserialize a pickle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "ContentProduction" / "narration-production-plan.json"
OUTPUT = ROOT / "ContentProduction" / "model-cache" / "mlx-audio" / "conds-v3.npz"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=PLAN)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    plan_path = args.plan.resolve(strict=True)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    revision = plan["model"]["revision"]
    snapshot = (
        ROOT
        / "ContentProduction"
        / "model-cache"
        / "huggingface"
        / "models--ResembleAI--chatterbox"
        / "snapshots"
        / revision
    )
    source = snapshot / "conds.pt"
    expected = plan["modelFileSHA256"]["conds.pt"]
    actual = sha256(source.resolve(strict=True))
    if actual != expected:
        raise RuntimeError("Pinned Chatterbox conditionals hash mismatch")

    output = args.output.resolve()
    private_root = (ROOT / "ContentProduction" / "model-cache" / "mlx-audio").resolve()
    if output.parent != private_root or output.suffix != ".npz":
        raise ValueError("MLX conditionals must remain in the private model cache")

    from chatterbox.mtl_tts import Conditionals

    conditionals = Conditionals.load(source, map_location="cpu")
    arrays: dict[str, np.ndarray] = {}
    for name, value in vars(conditionals.t3).items():
        if value is not None:
            arrays[f"t3.{name}"] = value.detach().cpu().numpy()
    for name, value in conditionals.gen.items():
        if value is not None:
            arrays[f"gen.{name}"] = value.detach().cpu().numpy()
    prompt_feat = arrays.get("gen.prompt_feat")
    if prompt_feat is None:
        raise RuntimeError("Pinned conditionals lack the S3Gen prompt feature")
    arrays["gen.prompt_feat_len"] = np.asarray([prompt_feat.shape[1]], dtype=np.int64)
    metadata = {
        "schemaVersion": 1,
        "sourceRepository": plan["model"]["repository"],
        "sourceRevision": revision,
        "sourceFile": "conds.pt",
        "sourceSHA256": actual,
    }
    arrays["metadata.json"] = np.frombuffer(
        json.dumps(metadata, sort_keys=True).encode("utf-8"), dtype=np.uint8
    )

    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with temporary.open("wb") as handle:
            np.savez_compressed(handle, **arrays)
        temporary.chmod(0o600)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps({"output": str(output), "sha256": sha256(output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

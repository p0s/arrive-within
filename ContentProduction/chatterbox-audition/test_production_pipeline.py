#!/usr/bin/env python3
"""Fast deterministic tests for the private narration production pipeline."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = Path(__file__).with_name("generate_production_candidates.py")
SPEC = importlib.util.spec_from_file_location("narration_production", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load narration production module")
production = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = production
SPEC.loader.exec_module(production)


class ProductionPipelineTests(unittest.TestCase):
    def test_unit_checkpoint_round_trip_is_atomic_and_hash_bound(self) -> None:
        import numpy

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            identity = {
                "schemaVersion": 1,
                "contentID": "G33",
                "language": "en",
            }
            production.prepare_unit_checkpoint_cache(root, identity)
            metadata = {
                "generationOrdinal": 0,
                "sentenceIndex": 0,
                "unitIndex": 0,
                "seed": 42,
                "sourceTextSHA256": "source",
                "generationTextSHA256": "generation",
                "speechTokenLimit": 192,
            }
            samples = numpy.array([0.25, -0.5, 0.75], dtype=numpy.float32)

            production.write_unit_checkpoint(root, 0, metadata, samples, numpy)
            loaded = production.load_unit_checkpoint(root, 0, metadata, numpy)

            numpy.testing.assert_array_equal(loaded, samples)
            self.assertTrue((root / "unit-0000" / "pcm.npy").is_file())
            self.assertTrue((root / "unit-0000" / "metadata.json").is_file())
            self.assertEqual(list(root.glob(".unit-*")), [])
            with self.assertRaisesRegex(RuntimeError, "metadata mismatch"):
                production.load_unit_checkpoint(
                    root, 0, {**metadata, "seed": 43}, numpy
                )
            with self.assertRaisesRegex(FileExistsError, "replace"):
                production.write_unit_checkpoint(root, 0, metadata, samples, numpy)

    def test_child_integrity_attestation_rejects_signature_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.bin"
            path.write_bytes(b"model")
            entry = {
                "path": str(path.resolve()),
                "signature": production.integrity_signature(path),
                "sha256": production.sha256(path),
            }
            self.assertEqual(
                production.require_attested_regular_file(entry, path),
                production.sha256(path),
            )
            path.write_bytes(b"mutated")
            with self.assertRaisesRegex(RuntimeError, "changed or mismatched"):
                production.require_attested_regular_file(entry, path)

    def test_existing_track_uses_attestation_without_rehashing_media(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            track = Path(directory)
            delivery = track / "delivery.m4a"
            delivery.write_bytes(b"delivery")
            delivery_hash = production.sha256(delivery)
            manifest = {
                "planSHA256": "plan",
                "catalogSHA256": "catalog",
                "scriptSHA256": "script",
                "files": {
                    "delivery": {
                        "name": "delivery.m4a",
                        "sha256": delivery_hash,
                    }
                },
            }
            manifest_path = track / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            attestation = {
                "manifest": {
                    "path": str(manifest_path.resolve()),
                    "signature": production.integrity_signature(manifest_path),
                    "sha256": production.sha256(manifest_path),
                },
                "files": {
                    "delivery": {
                        "path": str(delivery.resolve()),
                        "signature": production.integrity_signature(delivery),
                        "sha256": delivery_hash,
                    }
                },
            }
            with mock.patch.object(
                production, "sha256", side_effect=AssertionError("media rehashed")
            ):
                self.assertTrue(
                    production.existing_track_is_valid(
                        track, "plan", "catalog", "script", attestation
                    )
                )

    def test_attested_plan_path_must_match_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = root / "plan.json"
            other = root / "other.json"
            plan.write_text("{}", encoding="utf-8")
            other.write_text("{}", encoding="utf-8")
            entry = {
                "path": str(plan.resolve()),
                "signature": production.integrity_signature(plan),
                "sha256": production.sha256(plan),
            }
            with self.assertRaisesRegex(RuntimeError, "changed or mismatched"):
                production.require_attested_regular_file(entry, other)

    def test_unit_checkpoint_cache_rejects_identity_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            production.prepare_unit_checkpoint_cache(root, {"schemaVersion": 1})
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                production.prepare_unit_checkpoint_cache(root, {"schemaVersion": 2})

    def test_unit_checkpoint_identity_migrates_only_known_semantic_predecessor(self) -> None:
        expected = {
            "schemaVersion": 2,
            "contentID": "G25",
            "language": "en",
            "planSHA256": "plan",
            "catalogSHA256": "catalog",
            "scriptSHA256": "script",
            "modelFileSHA256": {"model": "hash"},
            "generationSemanticsRevision": production.GENERATION_SEMANTICS_REVISION,
            "seedOffset": 0,
        }
        legacy = dict(expected)
        legacy.pop("generationSemanticsRevision")
        legacy["schemaVersion"] = 1
        known_hash = next(iter(production.LEGACY_COMPATIBLE_GENERATOR_SHA256))
        legacy["generatorSHA256"] = known_hash

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            root.mkdir()
            (root / "identity.json").write_text(
                json.dumps(legacy) + "\n", encoding="utf-8"
            )

            production.prepare_unit_checkpoint_cache(root, expected, [])

            self.assertEqual(
                json.loads((root / "identity.json").read_text(encoding="utf-8")),
                expected,
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            root.mkdir()
            unknown = {**legacy, "generatorSHA256": "0" * 64}
            (root / "identity.json").write_text(
                json.dumps(unknown) + "\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                production.prepare_unit_checkpoint_cache(root, expected)

    def test_unit_checkpoint_identity_migrates_only_named_semantics_revision(self) -> None:
        expected = {
            "schemaVersion": 2,
            "contentID": "G25",
            "language": "en",
            "generationSemanticsRevision": production.GENERATION_SEMANTICS_REVISION,
        }
        predecessor = {
            **expected,
            "generationSemanticsRevision": next(
                iter(production.COMPATIBLE_SEMANTICS_PREDECESSORS)
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            root.mkdir()
            (root / "identity.json").write_text(
                json.dumps(predecessor) + "\n", encoding="utf-8"
            )

            production.prepare_unit_checkpoint_cache(root, expected, [])

            self.assertEqual(
                json.loads((root / "identity.json").read_text(encoding="utf-8")),
                expected,
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            root.mkdir()
            (root / "identity.json").write_text(
                json.dumps(
                    {**expected, "generationSemanticsRevision": "unknown-semantics"}
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                production.prepare_unit_checkpoint_cache(root, expected)

    def test_semantic_migration_reuses_only_exact_planned_units(self) -> None:
        import numpy

        expected_identity = {
            "schemaVersion": 2,
            "contentID": "G25",
            "language": "en",
            "generationSemanticsRevision": production.GENERATION_SEMANTICS_REVISION,
        }
        predecessor = {
            **expected_identity,
            "generationSemanticsRevision": next(
                iter(production.COMPATIBLE_SEMANTICS_PREDECESSORS)
            ),
        }
        metadata = {
            "generationOrdinal": 0,
            "sentenceIndex": 0,
            "unitIndex": 0,
            "seed": 42,
            "sourceTextSHA256": "source",
            "generationTextSHA256": "generation",
            "speechTokenLimit": 192,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "units"
            root.mkdir()
            (root / "identity.json").write_text(
                json.dumps(predecessor) + "\n", encoding="utf-8"
            )
            production.write_unit_checkpoint(
                root, 0, metadata, numpy.array([0.25], dtype=numpy.float32), numpy
            )

            with self.assertRaisesRegex(RuntimeError, "metadata mismatch"):
                production.prepare_unit_checkpoint_cache(
                    root, expected_identity, [{**metadata, "seed": 43}]
                )
            production.prepare_unit_checkpoint_cache(
                root, expected_identity, [metadata]
            )

    def test_phase_loader_never_co_resides_t3_and_s3(self) -> None:
        events: list[str] = []

        class FakeMPS:
            @staticmethod
            def synchronize() -> None:
                events.append("synchronize")

            @staticmethod
            def empty_cache() -> None:
                events.append("empty-cache")

        class FakeTorch:
            mps = FakeMPS()

            @staticmethod
            def is_tensor(_: object) -> bool:
                return False

        class Conditional:
            def to(self, *, device: str) -> "Conditional":
                events.append(f"conditional:{device}")
                return self

        class Module:
            patched_model = object()
            compiled = True

            def __init__(self, name: str) -> None:
                self.name = name

            def to_empty(self, *, device: str) -> None:
                events.append(f"drop:{self.name}:{device}")

        shell = SimpleNamespace(
            t3=None,
            s3gen=None,
            conds=SimpleNamespace(t3=Conditional(), gen={}),
        )
        manager = production.MPSPhaseManagedChatterbox(
            shell,
            lambda: Module("t3"),
            lambda: Module("s3"),
            FakeTorch,
            object(),
        )
        with mock.patch.object(
            production, "run_preserving_generation_rng", side_effect=lambda action, *_: action()
        ):
            manager.prepare_t3_phase()
            self.assertIsNotNone(shell.t3)
            self.assertIsNone(shell.s3gen)
            manager.transition_to_s3_phase()
            self.assertIsNone(shell.t3)
            self.assertIsNotNone(shell.s3gen)
            manager.release_all_phases()

        self.assertIsNone(shell.t3)
        self.assertIsNone(shell.s3gen)
        self.assertEqual(manager.phase, "empty")
        self.assertIn("drop:t3:meta", events)
        self.assertIn("drop:s3:meta", events)

    def test_phase_loader_preserves_generation_rng_around_model_load(self) -> None:
        class FakeRandom:
            def __init__(self, state: str) -> None:
                self.state = state

            def get_rng_state(self) -> str:
                return self.state

            def set_rng_state(self, value: str) -> None:
                self.state = value

        class FakeMPS(FakeRandom):
            pass

        class FakeTorch:
            random = FakeRandom("cpu-before")
            mps = FakeMPS("mps-before")

        class FakeNumpyRandom:
            state = ("numpy-before",)

            @classmethod
            def get_state(cls) -> tuple[str]:
                return cls.state

            @classmethod
            def set_state(cls, value: tuple[str]) -> None:
                cls.state = value

        fake_numpy = SimpleNamespace(random=FakeNumpyRandom)
        python_before = production.random.getstate()

        def consuming_load() -> str:
            production.random.random()
            FakeNumpyRandom.state = ("numpy-consumed",)
            FakeTorch.random.state = "cpu-consumed"
            FakeTorch.mps.state = "mps-consumed"
            return "loaded"

        self.assertEqual(
            production.run_preserving_generation_rng(
                consuming_load, FakeTorch, fake_numpy
            ),
            "loaded",
        )
        self.assertEqual(production.random.getstate(), python_before)
        self.assertEqual(FakeNumpyRandom.state, ("numpy-before",))
        self.assertEqual(FakeTorch.random.state, "cpu-before")
        self.assertEqual(FakeTorch.mps.state, "mps-before")

    def test_german_phase_loader_hashes_precomputed_conditionals(self) -> None:
        self.assertIn("conds.pt", production.model_allow_patterns("de"))

    def test_safetensor_phase_loads_directly_into_meta_module(self) -> None:
        events: list[object] = []

        class DeviceContext:
            def __enter__(self) -> None:
                events.append("meta-enter")

            def __exit__(self, *_: object) -> None:
                events.append("meta-exit")

        class FakeTorch:
            @staticmethod
            def device(name: str) -> DeviceContext:
                events.append(("device", name))
                return DeviceContext()

        class Value:
            def __init__(self, is_meta: bool) -> None:
                self.is_meta = is_meta

        class Module:
            def __init__(self) -> None:
                events.append("construct")
                self.value = Value(True)

            def load_state_dict(
                self, state: dict[str, Value], *, assign: bool, strict: bool
            ) -> SimpleNamespace:
                events.append(("load", assign, strict, tuple(state)))
                self.value = state["weight"]
                return SimpleNamespace(missing_keys=[], unexpected_keys=[])

            def named_parameters(self) -> list[tuple[str, Value]]:
                return [("weight", self.value)]

            def named_buffers(self) -> list[tuple[str, Value]]:
                return []

            def named_modules(self) -> list[tuple[str, "Module"]]:
                return [("", self)]

            def eval(self) -> "Module":
                events.append("eval")
                return self

        def load(path: Path, *, device: str) -> dict[str, Value]:
            events.append(("checkpoint", path.name, device))
            return {"weight": Value(False)}

        module = production.load_safetensor_phase_direct(
            Module,
            Path("phase.safetensors"),
            load,
            FakeTorch,
            "mps",
            strict=True,
        )

        self.assertIsInstance(module, Module)
        self.assertEqual(
            events,
            [
                ("device", "meta"),
                "meta-enter",
                "construct",
                "meta-exit",
                ("checkpoint", "phase.safetensors", "mps"),
                ("load", True, True, ("weight",)),
                "eval",
            ],
        )

    def test_safetensor_phase_fails_closed_on_unmaterialized_state(self) -> None:
        class DeviceContext:
            def __enter__(self) -> None:
                return None

            def __exit__(self, *_: object) -> None:
                return None

        class FakeTorch:
            @staticmethod
            def device(_: str) -> DeviceContext:
                return DeviceContext()

        class Module:
            def load_state_dict(self, *_: object, **__: object) -> SimpleNamespace:
                return SimpleNamespace(missing_keys=["window"], unexpected_keys=[])

            def named_parameters(self) -> list[tuple[str, object]]:
                return []

            def named_buffers(self) -> list[tuple[str, object]]:
                return [("window", SimpleNamespace(is_meta=True))]

            def named_modules(self) -> list[tuple[str, "Module"]]:
                return [("", self)]

            def eval(self) -> "Module":
                return self

        with self.assertRaisesRegex(RuntimeError, "missing-state materializer"):
            production.load_safetensor_phase_direct(
                Module,
                Path("phase.safetensors"),
                lambda *_args, **_kwargs: {},
                FakeTorch,
                "mps",
                strict=False,
                allowed_missing=("window",),
            )

    def test_pinned_t3_patch_keeps_only_the_identical_final_state(self) -> None:
        class FakeTorch:
            @staticmethod
            def inference_mode():
                return lambda function: function

        class FakeInputs:
            @staticmethod
            def size(dimension: int) -> int:
                return 3 if dimension == 1 else 1

        class FakeOutput:
            def __init__(self, **values: object) -> None:
                self.__dict__.update(values)

        class FakeBackend:
            forward = lambda *_args, **_kwargs: None

            def __init__(self) -> None:
                self.model_arguments: dict[str, object] = {}

                def model(**values: object) -> SimpleNamespace:
                    self.model_arguments = values
                    return SimpleNamespace(
                        last_hidden_state="final-state",
                        past_key_values="cache",
                        attentions="attentions",
                    )

                self.model = model
                self.speech_head = lambda value: f"logits:{value}"

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "t3_hf_backend.py"
            source.write_text("pinned test backend\n", encoding="utf-8")
            expected_hash = production.sha256(source)
            with (
                mock.patch.object(production.inspect, "getsourcefile", return_value=str(source)),
                mock.patch.object(production, "PINNED_T3_BACKEND_SHA256", expected_hash),
            ):
                self.assertEqual(
                    production.install_memory_efficient_t3_backend(
                        FakeTorch, FakeBackend, FakeOutput
                    ),
                    expected_hash,
                )

        backend = FakeBackend()
        result = backend.forward(FakeInputs(), output_hidden_states=True)
        self.assertEqual(backend.model_arguments["output_hidden_states"], False)
        self.assertEqual(result.logits, "logits:final-state")
        self.assertEqual(result.past_key_values, "cache")
        self.assertIsNone(result.hidden_states)

    def test_t3_patch_rejects_unreviewed_backend_source(self) -> None:
        class Backend:
            forward = lambda *_args, **_kwargs: None

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "t3_hf_backend.py"
            source.write_text("drifted backend\n", encoding="utf-8")
            with mock.patch.object(
                production.inspect, "getsourcefile", return_value=str(source)
            ):
                with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                    production.install_memory_efficient_t3_backend(object(), Backend, object)

    def test_mps_cache_is_released_only_for_mps_generation(self) -> None:
        class FakeMPS:
            def __init__(self) -> None:
                self.empty_cache_calls = 0
                self.synchronize_calls = 0

            def empty_cache(self) -> None:
                self.empty_cache_calls += 1

            def synchronize(self) -> None:
                self.synchronize_calls += 1

        class FakeTorch:
            def __init__(self) -> None:
                self.mps = FakeMPS()

        class FakeT3:
            def __init__(self) -> None:
                self.patched_model = object()
                self.compiled = True

        class FakeModel:
            def __init__(self) -> None:
                self.t3 = FakeT3()

        torch = FakeTorch()
        model = FakeModel()
        production.release_accelerator_cache(model, "cpu", torch)
        self.assertEqual(torch.mps.empty_cache_calls, 0)
        self.assertEqual(torch.mps.synchronize_calls, 0)
        self.assertIsNotNone(model.t3.patched_model)
        self.assertTrue(model.t3.compiled)

        production.release_accelerator_cache(model, "mps", torch)
        self.assertEqual(torch.mps.empty_cache_calls, 1)
        self.assertEqual(torch.mps.synchronize_calls, 1)
        self.assertIsNone(model.t3.patched_model)
        self.assertFalse(model.t3.compiled)

    def test_mps_model_reloads_before_a_third_generation_call(self) -> None:
        self.assertFalse(production.should_reload_model("mps", 1))
        self.assertTrue(production.should_reload_model("mps", 2))
        self.assertFalse(production.should_reload_model("cpu", 2))

    def test_checkpoint_continuation_has_a_dedicated_non_success_status(self) -> None:
        self.assertEqual(production.CHECKPOINT_CONTINUATION_EXIT_CODE, 75)
        continuation = production.CheckpointContinuation("G16", "en", 15)
        self.assertEqual(continuation.identifier, "G16")
        self.assertEqual(continuation.language, "en")
        self.assertEqual(continuation.generation_ordinal, 15)
        self.assertIn("unit 16", str(continuation))

    def test_one_unit_continuation_argument_is_explicit(self) -> None:
        arguments = production.parse_args(
            [
                "--language", "en", "--practice", "G16",
                "--one-new-unit-per-child",
            ]
        )
        self.assertTrue(arguments.one_new_unit_per_child)
        self.assertEqual(arguments.new_units_per_child, 1)

        two_units = production.parse_args(
            [
                "--language", "de", "--practice", "G16",
                "--one-new-unit-per-child", "--new-units-per-child", "2",
            ]
        )
        self.assertEqual(two_units.new_units_per_child, 2)

    def test_checkpoint_only_prefix_validation_does_not_read_pcm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = root / "unit-0000"
            unit.mkdir()
            expected = {
                "generationOrdinal": 0,
                "sentenceIndex": 1,
                "unitIndex": 0,
                "seed": 42,
                "sourceTextSHA256": "source",
                "generationTextSHA256": "generation",
                "speechTokenLimit": 192,
            }
            (unit / "metadata.json").write_text(
                json.dumps(
                    {
                        **expected,
                        "sampleCount": 3,
                        "pcmFloat32SHA256": "a" * 64,
                    }
                ),
                encoding="utf-8",
            )
            (unit / "pcm.npy").write_bytes(b"not-read-by-this-pass")

            with mock.patch.object(
                production.Path,
                "read_bytes",
                side_effect=AssertionError("PCM replay is forbidden"),
            ):
                self.assertEqual(
                    production.checkpoint_prefix_length(root, [expected]), 1
                )

            document = json.loads((unit / "metadata.json").read_text(encoding="utf-8"))
            document["seed"] = 43
            (unit / "metadata.json").write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "metadata mismatch"):
                production.checkpoint_prefix_length(root, [expected])

    def test_one_unit_manifest_separates_logical_calls_from_assembly_process(self) -> None:
        boundary = production.process_boundary_evidence("de", 37, 0, 0, True)
        self.assertEqual(boundary["generationCallCount"], 37)
        self.assertEqual(boundary["logicalGenerationCallCount"], 37)
        self.assertEqual(boundary["assemblyProcessGenerationCallCount"], 0)
        self.assertEqual(boundary["assemblyProcessMPSModelReloadCount"], 0)
        self.assertEqual(
            boundary["activeInvocationLifecycle"],
            "one-new-unit-per-owned-process",
        )
        self.assertEqual(
            boundary["configuredMaximumNewGenerationCallsPerOwnedProcess"], 1
        )
        self.assertEqual(boundary["maximumGenerationCallsPerMPSModel"], 1)

        two_unit_boundary = production.process_boundary_evidence(
            "de", 37, 0, 0, True, 2
        )
        self.assertEqual(
            two_unit_boundary["configuredMaximumNewGenerationCallsPerOwnedProcess"], 2
        )
        self.assertEqual(two_unit_boundary["maximumGenerationCallsPerMPSModel"], 2)

    def test_legacy_complete_track_units_remain_validation_only(self) -> None:
        text = "One two three four five six seven eight nine ten eleven twelve thirteen."
        current = production.generation_units(text, "de")
        legacy = production.legacy_complete_track_generation_units(text, "de")
        self.assertGreater(len(current), 1)
        self.assertEqual(len(legacy), 1)
        self.assertEqual(legacy[0].source_text, text)

    def test_memory_probe_reuses_one_model_for_bounded_seeded_units(self) -> None:
        plan = production.load_and_validate_plan(production.DEFAULT_PLAN)
        catalog = production.load_and_validate_catalog(production.DEFAULT_CATALOG)
        practice = next(item for item in catalog["practices"] if item["id"] == "G16")

        inputs = production.memory_probe_inputs(practice, "en", plan, 4)

        self.assertEqual(len(inputs), 4)
        self.assertEqual(
            [item["seed"] for item in inputs],
            [production.production_seed(plan["directions"]["en"], 16, index) for index in range(4)],
        )
        self.assertTrue(all(192 <= item["tokenLimit"] <= 600 for item in inputs))
        with self.assertRaisesRegex(ValueError, "1, 2, or 4"):
            production.memory_probe_inputs(practice, "en", plan, 3)

    def test_speech_token_limit_is_cadence_bounded(self) -> None:
        self.assertEqual(production.speech_token_limit(7, 105), 192)
        self.assertEqual(production.speech_token_limit(23, 105), 551)
        self.assertEqual(production.speech_token_limit(200, 105), 600)

    def test_bounded_decode_rejects_missing_eos_and_restores_inference(self) -> None:
        class Scalar:
            def __init__(self, value: int) -> None:
                self.value = value

            def item(self) -> int:
                return self.value

        class Tokens:
            def __init__(self, length: int, last: int) -> None:
                self.shape = (1, length)
                self.last = last

            def reshape(self, *_: int) -> "Tokens":
                return self

            def __getitem__(self, _: int) -> Scalar:
                return Scalar(self.last)

        class HP:
            stop_speech_token = 99

        class T3:
            def __init__(self) -> None:
                self.hp = HP()
                self.requested = 0

            def inference(self, **kwargs: int) -> Tokens:
                self.requested = kwargs["max_new_tokens"]
                return Tokens(self.requested, 1)

        class Model:
            def __init__(self) -> None:
                self.t3 = T3()

            def generate(self, **_: object) -> str:
                self.t3.inference(max_new_tokens=1000)
                return "waveform"

        model = Model()
        original_inference = model.t3.inference
        with self.assertRaisesRegex(RuntimeError, "without EOS"):
            production.generate_with_token_limit(model, {}, 192)
        self.assertEqual(model.t3.requested, 192)
        self.assertEqual(model.t3.inference, original_inference)

    def test_inactive_mps_cache_is_released_between_t3_and_s3(self) -> None:
        events: list[str] = []

        class Scalar:
            def item(self) -> int:
                return 99

        class Tokens:
            shape = (1, 10)

            def reshape(self, *_: int) -> "Tokens":
                return self

            def __getitem__(self, _: int) -> Scalar:
                return Scalar()

        class HP:
            stop_speech_token = 99

        class T3:
            hp = HP()

            @staticmethod
            def inference(**_: object) -> Tokens:
                events.append("t3")
                return Tokens()

        class Model:
            t3 = T3()

            def generate(self, **_: object) -> str:
                self.t3.inference(max_new_tokens=1000)
                events.append("s3")
                return "waveform"

        result = production.generate_with_token_limit(
            Model(), {}, 192, lambda: events.append("cache-release")
        )

        self.assertEqual(result, "waveform")
        self.assertEqual(events, ["t3", "cache-release", "s3"])

    def test_interrupted_staging_cleanup_is_language_scoped_and_symlink_safe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "candidates"
            english_staging = output_root / ".G13.en.n651ofco"
            german_staging = output_root / ".G06.de.keepme"
            completed = output_root / "G13" / "en"
            english_staging.mkdir(parents=True)
            german_staging.mkdir()
            completed.mkdir(parents=True)

            removed = production.cleanup_stale_staging(output_root, "en")

            self.assertEqual(removed, [english_staging])
            self.assertFalse(english_staging.exists())
            self.assertTrue(german_staging.is_dir())
            self.assertTrue(completed.is_dir())

            linked_staging = output_root / ".G14.en.link"
            linked_staging.symlink_to(completed, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "Unsafe narration staging entry"):
                production.cleanup_stale_staging(output_root, "en")
            self.assertTrue(completed.is_dir())

    def test_mps_generation_requires_lifecycle_memory_guard(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "run_narration_guarded"):
            production.require_memory_guard("mps", {})
        production.require_memory_guard(
            "mps", {production.MEMORY_GUARD_ENVIRONMENT_KEY: "1"}
        )
        production.require_memory_guard("cpu", {})

    def test_aggregate_cadence_padding_is_bounded_and_targets_selected_range(self) -> None:
        padding = production.aggregate_cadence_padding_frames(
            spoken_word_count=90,
            speech_frames=44 * 24_000,
            sample_rate=24_000,
            maximum_wpm=120,
            boundary_count=8,
        )
        self.assertEqual(len(padding), 8)
        self.assertLessEqual(max(padding), 6_000)
        corrected_seconds = (44 * 24_000 + sum(padding)) / 24_000
        self.assertLessEqual(90 / corrected_seconds * 60, 120)

        self.assertEqual(
            production.aggregate_cadence_padding_frames(
                spoken_word_count=180,
                speech_frames=60 * 24_000,
                sample_rate=24_000,
                maximum_wpm=120,
                boundary_count=1,
            ),
            [],
        )

    def test_locked_plan_and_complete_catalog_validate(self) -> None:
        plan = production.load_and_validate_plan(production.DEFAULT_PLAN)
        catalog = production.load_and_validate_catalog(production.DEFAULT_CATALOG)

        self.assertEqual(plan["directions"]["en"]["id"], "en-f2-spacious-slow")
        self.assertEqual(plan["directions"]["en"]["speechOnlyWPMRange"], [105, 120])
        self.assertEqual(plan["directions"]["en"]["clausePauseMs"], 1500)
        self.assertEqual(plan["directions"]["de"]["id"], "de-c2-accent-stability")
        self.assertEqual(len(catalog["practices"]), 42)

    def test_plan_rejects_unselected_owner_direction(self) -> None:
        plan = production.load_json(production.DEFAULT_PLAN)
        plan["directions"]["en"]["ownerState"] = "pending"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Owner-selected en direction"):
                production.load_and_validate_plan(path)

    def test_english_emotional_list_preserves_words_and_semantic_pauses(self) -> None:
        sentence = (
            "There may be sadness, numbness, anger, love, tiredness, relief, "
            "confusion, or no clear feeling at all."
        )
        units = production.english_generation_units(sentence)

        self.assertGreater(len(units), 1)
        self.assertEqual(
            [word for unit in units for word in production.words(unit.source_text)],
            production.words(sentence),
        )
        boundaries = [
            boundary
            for unit in units
            for boundary in (*unit.internal_boundaries, *([unit.gap_after] if unit.gap_after else []))
        ]
        after_words = {boundary["after"] for boundary in boundaries}
        self.assertIn("sadness", after_words)
        self.assertIn("numbness", after_words)
        self.assertTrue(all(boundary["kind"] == "list" for boundary in boundaries))
        self.assertTrue(all(len(production.words(unit.source_text)) >= 4 for unit in units))

    def test_german_generation_is_phrase_bounded_without_lexical_change(self) -> None:
        sentence = "Nimm wahr, was gerade da ist, ohne es verändern zu müssen."
        units = production.generation_units(sentence, "de")

        self.assertEqual(len(units), 2)
        self.assertEqual(
            [word for unit in units for word in production.words(unit.source_text)],
            production.words(sentence),
        )
        self.assertTrue(all(len(production.words(unit.source_text)) <= 10 for unit in units))
        self.assertEqual(units[0].gap_after, {"after": "ist", "kind": "clause"})
        self.assertIsNone(units[-1].gap_after)

    def test_unpunctuated_english_sentence_gets_one_semantic_f2_phrase_pause(self) -> None:
        sentence = "Notice that the ground is already meeting you."

        units = production.english_generation_units(sentence)

        self.assertEqual(len(units), 1)
        self.assertEqual(production.words(units[0].generation_text), production.words(sentence))
        self.assertEqual(len(units[0].internal_boundaries), 1)
        self.assertEqual(units[0].internal_boundaries[0]["kind"], "clause")
        self.assertIn("…", units[0].generation_text)

    def test_long_english_sentence_uses_two_bounded_f2_phrase_calls(self) -> None:
        sentence = (
            "Let the eyes look away from the last task and find one neutral shape or color."
        )

        units = production.english_generation_units(sentence)

        self.assertEqual(len(units), 2)
        self.assertEqual(
            [word for unit in units for word in production.words(unit.source_text)],
            production.words(sentence),
        )
        self.assertTrue(all(4 <= len(production.words(unit.source_text)) <= 12 for unit in units))
        self.assertEqual(units[0].gap_after, {"after": "task", "kind": "clause"})
        self.assertIsNone(units[1].gap_after)
        self.assertTrue(all(unit.generation_text.endswith(".") for unit in units))

    def test_existing_g25_and_g33_checkpoints_precede_phrase_split(self) -> None:
        expectations = {
            "G25": [(0, 0, 4), (1, 0, 9), (1, 1, 7), (2, 0, 6), (3, 0, 6), (4, 0, 11)],
            "G33": [(0, 0, 11), (1, 0, 10), (2, 0, 8), (3, 0, 3), (4, 0, 6), (4, 1, 7)],
        }
        for identifier, expected in expectations.items():
            _, events = production.parse_script(
                ROOT / f"Content/guided/{identifier}/script.en.md"
            )
            actual: list[tuple[int, int, int]] = []
            for event in events:
                if not isinstance(event, production.SentenceEvent):
                    continue
                for unit_index, unit in enumerate(
                    production.english_generation_units(event.text)
                ):
                    actual.append(
                        (event.sentence_index, unit_index, len(production.words(unit.source_text)))
                    )
                    if len(actual) == 6:
                        break
                if len(actual) == 6:
                    break
            self.assertEqual(actual, expected)

    def test_all_scripts_are_lexically_exact_and_token_bounded(self) -> None:
        limits = {"en": (105, 12), "de": (95, 10)}
        for language, (minimum_wpm, maximum_words) in limits.items():
            for script_path in sorted(
                (ROOT / "Content/guided").glob(f"G*/script.{language}.md")
            ):
                _, events = production.parse_script(script_path)
                for event in events:
                    if not isinstance(event, production.SentenceEvent):
                        continue
                    units = production.generation_units(event.text, language)
                    self.assertEqual(
                        [
                            word
                            for unit in units
                            for word in production.words(unit.source_text)
                        ],
                        production.words(event.text),
                    )
                    for unit in units:
                        word_count = len(production.words(unit.source_text))
                        self.assertLessEqual(word_count, maximum_words)
                        self.assertLessEqual(
                            production.speech_token_limit(word_count, minimum_wpm),
                            300,
                        )

    def test_short_english_phrase_is_not_stitched_or_forced_apart(self) -> None:
        sentence = "Body supported."

        units = production.english_generation_units(sentence)

        self.assertEqual(len(units), 1)
        self.assertEqual(units[0].generation_text, sentence)
        self.assertEqual(units[0].internal_boundaries, ())

    def test_seven_word_sentence_does_not_force_an_ellipsis(self) -> None:
        sentence = "There is no need to become still."

        units = production.english_generation_units(sentence)

        self.assertEqual(len(units), 1)
        self.assertEqual(units[0].generation_text, sentence)
        self.assertEqual(units[0].internal_boundaries, ())

    def test_g01_parsing_preserves_explicit_pause_and_monotonic_sentences(self) -> None:
        _, events = production.parse_script(ROOT / "Content/guided/G01/script.en.md")
        sentences = [event for event in events if isinstance(event, production.SentenceEvent)]
        pauses = [event for event in events if isinstance(event, production.PauseEvent)]

        self.assertGreater(len(sentences), 1)
        self.assertGreater(len(pauses), 0)
        self.assertEqual([event.sentence_index for event in sentences], list(range(len(sentences))))
        self.assertTrue(all(0 < event.seconds <= 120 for event in pauses))

    def test_sentence_and_paragraph_gaps_are_distinct(self) -> None:
        direction = production.load_and_validate_plan(production.DEFAULT_PLAN)["directions"]["en"]
        events = [
            production.SentenceEvent(0, 0, "One."),
            production.SentenceEvent(0, 1, "Two."),
            production.SentenceEvent(1, 2, "Three."),
        ]

        self.assertEqual(production.gap_after_sentence(events, 0, direction), 1700)
        self.assertEqual(production.gap_after_sentence(events, 1, direction), 2400)
        self.assertEqual(production.gap_after_sentence(events, 2, direction), 0)

    def test_g01_uses_owner_heard_seed_and_later_practices_use_disjoint_ranges(self) -> None:
        direction = production.load_and_validate_plan(production.DEFAULT_PLAN)["directions"]["en"]
        event = production.SentenceEvent(0, 0, "A calm beginning.")

        g01 = production.production_seed(direction, 1, 0)
        g02 = production.production_seed(direction, 2, 0)

        self.assertEqual(g01, 20260860)
        self.assertEqual(g02, 20261860)
        self.assertEqual(production.production_seed(direction, 11, 0, 137), 20270997)
        with self.assertRaises(ValueError):
            production.production_seed(direction, 11, 0, 1000)
        self.assertEqual(
            production.generation_units(event.text, "en")[0].source_text,
            event.text,
        )

    def test_semantic_pause_matching_is_ordered_and_lexically_bounded(self) -> None:
        import numpy

        sample_rate = 1000
        samples = numpy.full(1000, 0.5, dtype=numpy.float32)
        samples[275:300] = 0
        samples[590:625] = 0
        boundaries = (
            {"after": "first", "kind": "list", "afterWordIndex": 3, "unitWordCount": 10},
            {"after": "second", "kind": "list", "afterWordIndex": 6, "unitWordCount": 10},
        )

        matched = production.match_semantic_pauses(
            samples, boundaries, sample_rate, numpy
        )

        self.assertEqual(matched, [(275, 300), (590, 625)])

    def test_semantic_pause_matching_uses_global_order_not_greedy_nearest(self) -> None:
        import numpy

        sample_rate = 1000
        samples = numpy.full(3200, 0.5, dtype=numpy.float32)
        samples[1300:1700] = 0
        samples[2250:2525] = 0
        boundaries = (
            {"after": "tight", "kind": "list", "afterWordIndex": 4, "unitWordCount": 6},
            {"after": "uneven", "kind": "list", "afterWordIndex": 5, "unitWordCount": 6},
        )

        matched = production.match_semantic_pauses(
            samples, boundaries, sample_rate, numpy
        )

        self.assertEqual(matched, [(1300, 1700), (2250, 2525)])

    def test_authored_pause_allocation_preserves_weights_and_exact_target(self) -> None:
        allocated = production.proportional_pause_allocation([6, 8, 10, 12, 15], 102)

        self.assertEqual(sum(allocated), 102)
        self.assertEqual(allocated, [12, 16, 20, 24, 30])
        self.assertTrue(all(frames > 0 for frames in allocated))

    def test_vtt_time_rounds_to_milliseconds(self) -> None:
        self.assertEqual(production.format_vtt_time(0), "00:00:00.000")
        self.assertEqual(production.format_vtt_time(65.4326), "00:01:05.433")
        self.assertEqual(production.format_vtt_time(3600.001), "01:00:00.001")

    def test_aac_delivery_keeps_a_half_decibel_codec_safety_margin(self) -> None:
        self.assertEqual(production.AAC_DELIVERY_SAFETY_GAIN_DB, -0.5)


if __name__ == "__main__":
    unittest.main()

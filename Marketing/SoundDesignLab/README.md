# Original sound-design lab

This non-shipping lab prepares three restrained ambience directions and three opening/closing bell families after the narration direction is stable. All candidates are deterministic additive synthesis: no samples, field recordings, reference voices, cloned voices, or third-party media are used.

On 2026-08-13 the owner approved the exact already-bundled `Still Air` ambience and `bell-v1` opening/closing family. `selection.json` binds that decision to the three shipping hashes. No lab candidate was promoted, and all six alternative directions/families remain excluded from the app bundle.

Run `./scripts/generate_sound_design_lab.sh` once for a decision packet. The manifest records hashes, durations, sizes, generation method, rights boundary, and the human checks that automation cannot replace. Ambience candidates are complete 30-second loops before AAC encoding; bells are complete lossless PCM candidates. None is selected or present in the app bundle merely because the lab exists.

Exact-device loop-seam/fatigue review, route balance, interruption/lock behavior, and narration intelligibility remain separate from the owner’s direction approval. Any future replacement still requires a new explicit hash-bound selection, mastering, integration through the independent voice/ambience controls, and proof that every unselected candidate is absent from the exact release archive.

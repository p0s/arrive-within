# Original audio asset ledger

Status: Engineering assets generated; human listening approval pending

`scripts/generate_original_audio_assets.sh` deterministically synthesizes the opening bell, closing/interval bell, and optional `Still Air` ambience. They use no samples, field recordings, reference voices, cloned voices, or third-party media. The generated manifest records the exact FFmpeg build and SHA-256 for each bundled file.

These assets establish the real layered playback and lifecycle path; they are not silently treated as final artistic approval. Before release, a human listener must review them on the exact candidate through built-in speaker, wired output where available, Bluetooth, lock, interruption, and route-loss scenarios. The ambience loop seam, perceptual loudness, fatigue, and relationship to approved narration require explicit review.

The iOS Simulator validates the exact bundled files and hashes but intentionally does not start `AVAudioEngine`: simulator remote-I/O cannot prove physical playback and the installed iOS 26.5 runtime aborts while negotiating the audio device. Real playback is compiled for device targets and remains a candidate-bound physical evidence gate.

Reproduce and verify:

```sh
./scripts/generate_original_audio_assets.sh
jq -e '.schema_version == 1 and (.assets | length) == 3' Apps/ArriveWithin/Resources/Audio/audio-assets.json
```

Narration remains governed separately by `docs/audio/NARRATION_PRODUCTION.md`; these procedural assets are not evidence for any of the 84 narration tracks.

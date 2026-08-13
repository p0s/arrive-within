# Original audio asset ledger

Status: Exact bundled sound direction owner-approved; physical-device audio QA pending

`scripts/generate_original_audio_assets.sh` deterministically synthesizes the opening bell, closing/interval bell, and optional `Still Air` ambience. They use no samples, field recordings, reference voices, cloned voices, or third-party media. The generated manifest records the exact FFmpeg build and SHA-256 for each bundled file.

On 2026-08-13 the owner approved the exact hash-bound `Still Air` ambience and `bell-v1` family as the shipping sound direction. Physical iPhone use of build 9 then proved that the selected bell masters peaked around -41 dBFS and were effectively inaudible. The same deterministic bell synthesis now receives 29 dB of output gain before a headroom-safe limiter; the ambience master and sound direction are unchanged, and the non-shipping sound-lab alternatives remain excluded. The exact replacement candidate still requires review through built-in speaker, wired output where available, Bluetooth, lock, interruption, and route-loss scenarios. The ambience loop seam, perceptual loudness, fatigue, haptic relationship, and balance with approved narration also remain explicit device gates.

The iOS Simulator validates the exact bundled files and hashes but intentionally does not start `AVAudioEngine`: simulator remote-I/O cannot prove physical playback and the installed iOS 26.5 runtime aborts while negotiating the audio device. Real playback is compiled for device targets and remains a candidate-bound physical evidence gate.

Reproduce and verify:

```sh
./scripts/generate_original_audio_assets.sh # remasters bells and preserves the selected ambience master
jq -e '.schema_version == 1 and (.assets | length) == 3' Apps/ArriveWithin/Resources/Audio/audio-assets.json
node scripts/validate_original_audio_assets.mjs
```

Narration remains governed separately by `docs/audio/NARRATION_PRODUCTION.md`; these procedural assets are not evidence for any of the 84 narration tracks.

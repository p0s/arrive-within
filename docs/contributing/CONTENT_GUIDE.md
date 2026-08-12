# Guided-content contribution guide

Arrive Within 1.0 contains exactly 42 original guided-practice concepts. Every concept has one English and one natural German adaptation, with matching intent, safety, target duration, transcript, packaged narration, provenance, and separate fluent-human approval before it can be called complete.

## Source contract

`Content/guided/catalog.json` is schema version 1. Each `G01`–`G42` entry includes:

- stable ID and version;
- category, purpose tags, target minutes, and safety context;
- localized title, purpose, accessibility summary, source paths, script revision, and editorial state;
- one script, WebVTT transcript, and offline narration path per language.

Scripts use YAML front matter with `id`, `language`, `revision`, `status`, and `target_minutes`. Pause instructions are explicit bracketed cues such as `[Pause 8 seconds]` / `[Pause 8 Sekunden]`. Paths and metadata must agree exactly with the catalogue.

Run:

```sh
python3 scripts/validate_guided_content.py
```

The 84 scripts are full-length production-candidate sources. The selected F2 English and C2 German automated masters are generated continuously into ignored raw candidate storage. Promotion into a device candidate requires an exact objective 42×2 set plus a hash-bound private review record with every fluent-human, editorial, pronunciation/artifact, VTT, rights, and finished-track gate approved. Promoted `audio.<language>.m4a`, `transcript.<language>.vtt`, and `provenance.<language>.json` files under `Content/guided/<ID>/` are intentional tracked source and must not be gitignored; iPhone/iPad TestFlight audio and finished-library approval remain separate post-promotion gates.

## Editorial voice

- secular, calm, warm, specific, and non-clinical;
- invitational choices instead of commands where bodies, eyes, breath, or posture are involved;
- no diagnosis, treatment claim, guaranteed outcome, coercion, shame, urgency, or streak-loss pressure;
- no breath retention or forceful breathing without a clear safe alternative;
- grief, anxiety, pain, sleep, and strong-emotion practices avoid promising relief and include grounded choices;
- ending language restores awareness of surroundings and ordinary movement.

German is rewritten for natural meaning, rhythm, and emotional tone; it is not a literal sentence-by-sentence translation. A fluent reviewer must approve both language versions and their equivalence.

## Change workflow

1. Open the guided-content correction or localization issue form and identify exact IDs/languages/lines.
2. Change the script and increment its localized `scriptRevision` when spoken wording changes.
3. Update the transcript source and catalogue state; do not silently reuse audio tied to an older revision.
4. Run content validation and relevant Swift content tests.
5. Record editorial/safety review and fluent EN/DE review separately.
6. Regenerate narration only after the text revision and voice direction are approved.
7. Assemble a complete track before loudness normalization, then regenerate VTT timing against the final master.

## Narration production

The target is calm, warm, close, unhurried, and human. Shipping narration may not use system/macOS/browser/`AVSpeechSynthesizer`, clone a real person without documented permission, or depend on a runtime voice service. Local generation must pin code, package, model/weights, settings, seeds, prompt/voice attestation, source revision, output hashes, and redistribution evidence.

Start mastering evaluation around `-19 LUFS-I`, true peak at or below `-1.5 dBTP`, mono AAC at 56–64 kbps. Assemble full tracks before normalization; do not independently normalize chunks. Validate actual size against the approximately 400 MB bilingual narration budget.

Automated checks cover identity, duration, decode, channel/codec/rate, clipping, loudness, DC/dropout/silence, hashes, package size, and VTT timing. They do not prove naturalness, native accent, pronunciation, safety, emotional tone, or script equivalence. Owner voice selection, fluent EN/DE listening, editorial/safety approval, pronunciation/artifact review, and physical audio-route testing remain distinct gates.

The reproducible direction and current non-production evidence are documented in `docs/audio/NARRATION_PRODUCTION.md` and `docs/audio/CHATTERBOX_RIGHTS.md`. Private auditions, voice material, model caches, and reviewer identities must never enter the public repository.

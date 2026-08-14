# Narration production contract

Status: English F2 and German C2 owner-selected as production-candidate directions; F1 retained as rejected-but-good; no production master or finished-library claim approved

## Direction

Calm, warm, close, unhurried, and human. No system/macOS/browser/`AVSpeechSynthesizer` narration, no real-person cloning without documented permission, no runtime generation, and no ElevenLabs dependency.

## Corrected proven English baseline

The English comparison origin is the Chatterbox default voice with no `audio_prompt_path`:

| Parameter | Value |
|---|---:|
| sample rate / channels | 24 kHz / mono |
| repetition penalty | 1.25 |
| min-p | 0.05 |
| top-p | 0.95 |
| exaggeration | 0.30 |
| CFG weight | 0.45 |
| temperature | 0.70 |

The earlier `0.32`/`0.72` recollection is superseded. The old rendered artifact proves execution, not subjective acceptance.

German uses a pinned `ChatterboxMultilingualTTS` V3 revision with `language_id="de"`. English output is not German evidence. Official guidance warns that reference-language mismatch can transfer accent.

## Private audition matrix

Generate short, script-revision-pinned excerpts for all cells below. Default voices are mandatory comparison origins; any reference candidate is excluded until recording license, speaker consent, public redistribution/media-license compatibility, checksum, and language fit are approved.

| Practice | Purpose | English | German |
|---|---|---|---|
| G01 | foundation / first use | default + rights-cleared candidates | V3 default + rights-cleared candidates |
| G10 | pressure / calm | default + rights-cleared candidates | V3 default + rights-cleared candidates |
| G17 | long body scan | default + rights-cleared candidates | V3 default + rights-cleared candidates |
| G24 | focus | default + rights-cleared candidates | V3 default + rights-cleared candidates |
| G30 | grief / tenderness | default + rights-cleared candidates | V3 default + rights-cleared candidates |
| G41 | awake at night | default + rights-cleared candidates | V3 default + rights-cleared candidates |

`CMU Arctic male`, `online_human`, and `calm_engineer` are descriptive listening guidance only; they are not authorized assets or voice identities.

### Current default-audition result

All 12 required cells were generated from the pinned source excerpts and measured without normalization. The public-safe ledger is `docs/audio/audition-results.json`; raw WAVs, model caches, and the detailed local manifest remain ignored. Hash, PCM format, duration, loudness, true peak, silence, DC offset, and clipping observations are recorded. Seven raw cells require clipping attention and none of the audition WAVs is a production master.

This completes the historical default-audition generation and objective measurement only. The later owner decisions select English F2 and German C2; fluent English/German listening, pronunciation/pacing/artifact review, safety/editorial approval, and public-redistribution review remain separate deferred gates. No audition cell is counted as one of the 84 finished tracks.

### Owner decision and sentence-aware comparison

The owner approved the `default-en` voice identity and requested slower, more relaxed space between sentences. That gate is recorded as `approved-with-pacing-revision`, not production-complete. The original `default-de-v3` delivery was rejected for excessive speed.

The reproducible `chatterbox-pacing-v2` packet uses literal G01 and G30 sentences. It generates coherent full-sentence units, preserves punctuation-driven within-sentence prosody, inserts exact silence only during complete-clip assembly, applies no time stretch or normalization, and writes only assembled WAVs. Both English clips reuse byte-identical sentence renders so their 700/850 ms sentence and 1.2/1.4 second practice-transition gaps are the only delivery difference. German A/B/C are explicitly parameter/seed delivery variants of the same default V3 identity, not different speakers.

The public-safe objective ledger is `docs/audio/pacing-audition-results.json`; private WAVs and the detailed manifest remain ignored. Measured overall rates are 164.1 and 159.8 WPM for English, then 156.1, 129.4, and 151.3 WPM for German A/B/C. These historical candidates were superseded by the later F1/F2 and C1/C2/C3 packets. All files have intersample true-peak attention above 0 dBTP; German A/B/C additionally have raw generation/sample clipping attention. Those are mastering/QA flags distinct from the later owner selections.

### Corrected slower English and German accent-stability packet

An urgent owner correction superseded any faster/more-continuous English interpretation. The approved `default-en` identity stayed fixed, but 850 ms sentence spacing was still too fast overall. `chatterbox-cadence-accent-v3` therefore generated five English sentence units once, without time stretch or per-chunk normalization, then assembled E1 at 1.1-second sentence/1.6-second transition gaps and E2 at 1.35/1.9 seconds. Both measure 187.15 speech-only WPM; their overall rates are 152.39 and 146.55 WPM. The owner later rejected both for delivery that remained too fast and selected F2 from the corrected F packet below.

The prior German C pacing/rhythm remains the target, but its sudden English-accent drift is rejected. C1/C2/C3 each ran in a separate fresh German-only process at 750 ms sentence and 1.2-second transition spacing, with one seed per candidate, explicit `language_id="de"` on every one of five generation calls, and zero cross-language calls. They measure 170.00/148.63, 162.68/143.01, and 169.44/148.20 speech-only/overall WPM. All three raw German clips require sample and intersample peak attention (`+0.14` to `+0.21 dBTP`); the English pair does not. The public-safe ledger is `docs/audio/cadence-accent-audition-results.json`.

Objective duration and signal checks found no duration-boundary warning, but cannot establish native accent, pronunciation, naturalness, meaning, or hallucination-free speech. Owner and fluent-German listening decide whether any bounded candidate is accent-stable. If all three still drift, default V3 iteration stops and the next investigation must be a genuinely German-native local model/voice with explicit code, weights, output, reference-recording, speaker-consent, and redistribution rights as applicable.

### Owner-selected German C2 and corrected English F packet

The owner selected German C2 as the voice/delivery direction. This resolves only the owner's accent/cadence choice: the raw C2 audition is not a production master and its `+0.14 dBTP` intersample-peak attention must be corrected after complete-track assembly. Fluent German listening, script/editorial review, pronunciation/artifact QA, rights sign-off, mastering, VTT alignment, physical audio routes, and the complete German catalogue remain independent gates.

The owner rejected E1/E2 because their actual speech-only delivery and comma-separated emotional list remained too fast. The approved default-English identity was retained for exactly two regenerated G01/G30 candidates. F1 measures `127.90` speech-only / `106.83` overall WPM with `450 ms` realized pauses after both “sadness” and “numbness,” `1.4 s` sentence gaps, and a `2.0 s` practice transition. F2 measures `117.03` / `96.06` WPM with `650 ms` realized list pauses, `1.7 s` sentence gaps, and a `2.4 s` transition. Both use context-aware phrase generation plus bounded aligned semantic pause extension; neither uses time stretch, compression, normalization, system TTS, or isolated-word stitching.

The public-safe objective ledger is `docs/audio/english-f-audition-results.json`; private WAVs remain ignored. F1 has `+0.21 dBTP` intersample-peak attention while F2 is `-0.16 dBTP`; neither is a production master or mastering approval.

The owner selected F2 as the English pacing/delivery direction and described F1 as not bad but less preferred. F1 remains rejected-but-good provenance; F2 authorizes the 42-track English production-candidate run. The F2 audition itself is not a production master and the selection does not satisfy fluent listening, editorial, pronunciation/artifact, redistribution-rights, complete-track mastering/headroom, VTT, physical-device audio, or full-catalogue gates.

## Reproducibility and provenance

Pin package, repository, model and weights revisions/checksums, model/code license evidence, commercial/output-rights evidence, environment-lock digest, language ID, complete settings, seed when supported, script revision/checksum, prompt/voice attestation, raw/master/delivery checksums, and generated date. Never publish a local path, credential, model cache, private prompt recording, biometric fingerprint, or reviewer identity.

### Guarded Apple Silicon production architecture

Production Metal inference runs through one lifecycle-owned host guard and one worker. The hard host floor is the greater of 10 GiB or 25% of RAM, with a further 1 GiB early-stop buffer. Direct MLX or MPS generation fails closed outside that owner; detached or PID-watching supervisors are forbidden.

The original pinned PyTorch/MPS loader remains the fallback and the provenance baseline. It keeps only the active heavyweight phase resident: T3 produces deterministic speech tokens, its MPS storage is released, and then S3Gen decodes those tokens. Two independent guarded real-MPS G01 probes produced the same PCM SHA-256, sample count, duration, seed, and input hashes. This is deterministic execution evidence, not human audio approval.

### Benchmark-selected throughput strategy

The official Chatterbox source remains pinned at commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`, with the official multilingual V3 model revision and hashes. The selected production backend is the full-native Chatterbox V3 implementation in `mlx-audio` 0.4.8, tag commit `49596ac8b69b9ed377db311a73df838795f38a3d`, isolated in its own frozen environment. It loads the exact already-pinned Resemble weights and sanitizes them in memory; it does not download or persist a community-converted checkpoint. The immutable selected voice conditionals are exported once from the exact pinned `conds.pt` into a hash-bound, ignored NumPy container. The draft upstream hybrid MLX PR is not production code here.

The PyTorch/MPS fallback was first optimized on the same eight German G07 units. Reloading both phases for every unit took 95.79 seconds; keeping both resident took 80.09 seconds; phase batching took 75.44 seconds, or 9.43 seconds/unit, at 5.40 GiB peak child RSS. All three reproduced the baseline float32 PCM hashes exactly. A 16-unit phase-batched probe improved that fallback to 8.38 seconds/unit at 7.07 GiB peak RSS.

The matched full-native MLX probe completed the same eight G07 German units in 43.13 seconds, including a 7.58-second model load: 5.39 seconds/unit, 2.62 GiB peak process RSS, and 11.88 GiB minimum sampled host headroom. That is 1.75× the end-to-end throughput of the selected PyTorch/MPS eight-unit baseline with about half its RSS. The T3 speech-token stream is byte-identical across fresh MLX processes. S3 float output differs only at GPU-reduction noise scale: maximum absolute difference `1.1920929e-7`, RMS difference `1.2611631e-8`, correlation `0.9999999999999932`; 505 of 45,120 PCM24 samples differed by exactly one least-significant bit. Checkpoint hashes still bind the exact persisted output of each run.

The first real MLX production proof completed G09 German from zero checkpoints through 44 immutable units, final assembly, mastering, AAC, VTT, and objective validation. Its first child retained 11 checkpoints before a safe 10.44 GiB sampled-headroom stop; bounded relaunches then added 16, 16, and 1 checkpoints and finalized the 300.0-second track without duplication. Peak child RSS was 2.65 GiB in the completed batches. This proves the selected backend across the production persistence boundary, not only in a non-persisting benchmark.

The wrapper defaults to MLX for every not-yet-started track. Existing complete PyTorch candidates remain valid and immutable. Never mix backends within one partial track: finish or explicitly discard that track's private checkpoints before changing its backend. `NARRATION_BACKEND=pytorch-mps ./scripts/produce_narration_candidates.sh` is the documented fallback. Do not parallelize accelerator workers, because duplicated weights compete for unified memory and violate the one-worker safety proof. Future backend changes require an isolated frozen environment, non-persisting English and German probes, matched throughput/memory evidence, reproducibility characterization, and one complete guarded production track before changing the default.

S3 waveform decoding is also bounded by deterministic semantic generation units: every English call is at most 12 words and every German call at most 10, which keeps the computed speech-token ceiling at or below 300. The planner prefers authored punctuation, otherwise selects a balanced lexical boundary with at least four words on each side, preserves the exact flattened word sequence, carries authored list/clause gaps forward, and uses the selected F2/C2 language-specific pause durations. Eleven-or-more-word list units with at least four internal authored boundaries split once more at the nearest viable list boundary; this reduces the implicated calls to the 192-token floor without changing words or direction. Every generated fragment removes a trailing comma, semicolon, or colon from the model prompt while retaining it in the immutable source text and explicit pause metadata; the complete 84-script planner rejects malformed `,.`, `;.` and `:.` prompts. Existing checkpoints migrate only from a named predecessor revision, only as a contiguous prefix, and only when every planned unit's ordinal, sentence/unit index, seed, source/generation text hashes, and token ceiling match exactly.

Missing EOS is a content-shape failure, not permission to keep extending generation. A real G12 German 8-word semicolon sentence twice exhausted its 228-token limit and still failed at an isolated 300-token diagnostic limit. At 25 speech tokens per second, accepting the latter would already allow more than 12 seconds for eight words, so truncation or a larger ceiling would hide a pathological continuation. The production fix instead splits only balanced German semicolon clauses with at least four words on each side. The exact same first seed then completed the natural 4+4 clauses at 50 and 35 tokens, producing 1.92- and 1.32-second waveforms at 2.64 GiB peak process RSS and 21.24 GiB minimum host headroom. The probe persisted no candidate. After the incompatible unfinished cache was moved intact to private quarantine, two guarded production children created four fresh immutable checkpoints, each adding exactly two while preserving the earlier prefix; peak RSS was at most 2.69 GiB, minimum headroom was 14.04 GiB, and neither child was guard-terminated. This is the locked recovery policy for future no-EOS cases: reproduce the exact ordinal without persistence, reject cap inflation and truncation, prefer the smallest authored semantic split, version the planner, and regenerate only an incompatible unfinished track. Completed candidates remain immutable pending human review.

For future backend work, measure before changing production: use one non-persisting, guard-owned probe against exact English and German production units; compare wall time, peak process RSS, minimum host headroom, speech-token identity, PCM difference, and model-load cost; then require one complete real track through checkpoints, mastering, AAC, VTT, and objective validation. Keep the winning backend frozen and the slower proven backend as fallback. Do not send app-specific planning, private scripts, voice inputs, candidate text, or evidence to an upstream Chatterbox pull request. Contribute upstream only after a minimal public synthetic reproduction demonstrates a generic library defect and a library-level fix passes independently.

The first guarded production result after this change converted the repeatedly stopping G25 English partial into a complete 180.0-second candidate at 118.0 speech-only WPM. One safe stop retained 11 new unit checkpoints; the owned bounded retry resumed all 17 checkpoints and completed the track. Minimum sampled headroom stayed above the 11 GiB early-stop line. This establishes lower memory pressure and resume progress, not subjective listening or finished-library approval.

The same lifecycle-isolated path subsequently completed G16 English at exactly 300.0 seconds after 46 units and G17 English at exactly 1,200.0 seconds after 136 units; G17 measures 118.5 speech-only WPM and 47.9 overall WPM, and its objective candidate manifest passes. Production then completed G18 through G22 without changing model, voice, text, seed, cadence, phrase plan, mastering, or memory thresholds. The earlier private lower-bound packet (23 EN, 5 DE; 235.0 minutes) is historical; the current 84-track objective ledger supersedes it. Human/right gates remain pending.

At G21 unit 24, the original greedy semantic-pause matcher selected the nearest valid gap for the first of two ordered list boundaries and left no later candidate for the second, so generation correctly failed closed without modifying the checkpoint. The matcher now evaluates complete ordered candidate paths and selects the deterministic minimum total lexical-distance cost, with longer total low-energy duration and candidate indices as stable tie-breakers. The exact retained waveform maps both authored boundaries, the same guard resumed from all 24 immutable checkpoints, and G21 completed at exactly 480.0 seconds, 115.6 speech-only WPM, and 60.6 overall WPM.

The continuation child no longer loads and transforms every prior PCM array merely to reach the next missing unit. The guard still hashes the complete scoped checkpoint inventory before and after every child; inside the child, the fast path independently validates the contiguous paths, regular files, and exact planned metadata, then generates only the next bounded unit set. Full NPY payload validation, semantic-pause application, signal checks, assembly, cadence allocation, mastering, AAC/VTT creation, and final manifest creation remain one complete finalization pass after every planned unit exists. A real guarded G22 proof preserved unit 1 and added exactly units 2 and 3 in two one-unit children, with 24.12 GiB and 24.48 GiB minimum host headroom. Repeated non-persisting EN and DE two-unit probes then produced byte-identical per-unit PCM, one model load, explicit German language identity, zero output, and 20.16–23.76 GiB minimum headroom. Two real G23 children each persisted exactly two immutable checkpoints with 23.04 and 23.76 GiB minimum headroom. The later phase-batch selection above supersedes the two-unit throughput setting while preserving those determinism and lifecycle proofs.

The full-run launch preflight is 14 GiB. The earlier 12 GiB value repeatedly admitted a fresh MLX child at 12.24 GiB and then crossed the unchanged 11 GiB early-stop line at 10.80 GiB before its first checkpoint. The measured 1.44 GiB startup drop makes 14 GiB the smallest rounded launch setting with useful margin while retaining the guard's independent mandatory 10 GiB floor plus 1 GiB early-stop buffer. A memory stop with no checkpoint now remains inside the same lock-owning lifecycle: it consumes one bounded memory-stop retry, waits for the full 14 GiB preflight again, and only then launches one fresh owned child. Deterministic worker errors still exit instead of retrying. The owner may wait for up to 12 hours, so a busy host no longer turns the 30-minute scheduler into repeated short-lived model starts. Generated candidates and detailed memory evidence remain private/ignored; only explicitly promoted, objectively validated shipping media belongs under `Content/guided`.

G33 English then isolated a heavier shape: an 11-word list with four internal authored boundaries repeatedly crossed the stop line without progress even after a 27 GiB launch. The named semantics successor splits only that pressure signature once, retained all 26 earlier G33 checkpoints by exact planned-metadata comparison, and reduced the implicated calls from 277 to 192 tokens. The first real guarded child persisted both replacement phrases with 24.12 GiB minimum host headroom, no termination, and one guard-owned model load; words, selected voice/direction, seeds, mastering, and the completed prefix remain unchanged.

The lifecycle-isolated continuation mode exits its sole owned process immediately after at most 16 atomic unit checkpoints. Before relaunch, the guard rereads every scoped checkpoint as a contiguous prefix, validates the regular-file NPY header, one-dimensional float32 payload length, PCM SHA-256, metadata ordinal, and immutability of every earlier unit, then requires a delta between one and the configured bound. Each old hash-valid checkpoint is cached only while its device, inode, byte length, modification time, and change time remain identical, so relaunches stat-check the immutable prefix and fully hash only a new or changed unit instead of rescanning an ever-growing PCM corpus. The same lifecycle owner fully hashes each pinned model file and completed candidate once, writes a private mode-0600 attestation, and makes every fresh child fail closed unless the snapshot link, resolved regular file, and completed-candidate signatures remain byte-identity-bound; any device, inode, mode, size, modification-time, or change-time drift requires a new guard run and full rehash. This removes repeated multi-gigabyte integrity reads without trusting mutable paths. Memory-stop retries and successful bounded continuations have separate budgets, so a complete catalogue cannot silently exhaust the smaller recovery allowance. Between processes, the guard applies the 14 GiB launch requirement; exiting the process releases Metal backend state without changing text, seeds, selected model state, inference settings, precision, mastering, or audio direction.

Completed candidates can be assembled into a private ignored listening packet with `scripts/create_narration_review_packet.py`. Its network-disabled offline reviewer exports a private JSON decision record, flags raw-source clipping attention, and can carry decisions into a newer packet only while the exact candidate hashes remain unchanged. Multiple reviewers may export records from the same packet and review languages/gates concurrently; the packet builder merges complementary decisions but fails closed on conflicting approvals/rejections. `scripts/validate_narration_review_approval.py` accepts only an exact 84-track packet whose audio, transcript, candidate, packet, and objective-report hashes still agree and whose fluent-human, editorial, pronunciation/artifact, VTT, rights, finished-track, and device-candidate gates all read `approved`. Promotion requires that validated private record and writes public provenance bound to its hashes; pending or tampered review data fails closed. `ARRIVE_WITHIN_GUIDED_GATE=device-candidate ./scripts/check` validates that packaged pre-TestFlight boundary; there is deliberately no packaged `release` alias. The resulting build is a device candidate, not a finished library. After Apple reports that exact narrated build valid and in TestFlight, `scripts/validate_narration_release_approval.py` binds its candidate-record/IPA hashes to the original review and requires every authorized physical phone/tablet result to repeat the exact TestFlight channel, marketing/build number, build ID, and IPA hash across speaker, headphones where available, Bluetooth, lock/background, interruption, route-loss, mix, and language-override evidence. That private post-TestFlight seal supplies finished-library approval without rewriting the already-tested binary.

The validator also recognizes one narrow legacy metadata shape: a completed candidate may carry the old `one-new-unit-per-owned-process` label together with limits of exactly two calls, one model load, zero assembly calls, and phase-per-unit residency. Private guard reports prove that shape for the affected older candidates. New generation emits the explicit bounded-batch label; no other lifecycle mismatch is accepted, and no audio is regenerated merely to rewrite this historical label.

## Production mastering

- Assemble each complete track before loudness normalization; never peak-normalize production chunks independently.
- Begin evaluation around `-19 LUFS-I`, true peak `≤ -1.5 dBTP`, mono AAC `56–64 kbps`.
- Encode AAC with the fixed safety margin, measure the encoded delivery, and perform at most one bounded attenuation/re-encode when codec overshoot exceeds the true-peak ceiling; record the actual applied gain and fail closed if the second measurement still misses.
- Validate actual duration, quality, and package size for roughly 780 bilingual minutes against the approximately 400 MB narration budget.
- Keep narration free of baked ambience/music. Preserve lossless or high-quality masters separately from delivery AAC.

## Automated gates

- exact 42 × 2 ID/language/script/transcript/audio/metadata coverage;
- decode, finite samples, mono, codec/rate, duration and speech-rate bounds;
- clipping, true peak, integrated loudness, DC offset, dropout/discontinuity, and silence bounds;
- master/delivery hashes, AAC/master duration agreement, package-size accounting;
- monotonic non-overlapping VTT cues inside duration with approved script revision;
- approved model/tool/voice/output-rights provenance and required attribution;
- no baked ambience/music and no unapproved reference material.

Automated gates never replace owner voice selection, fluent English/German adaptation/listening QA, safety/editorial review, pronunciation/artifact/pacing review, transcript alignment, or physical iPhone/iPad route/lock/interruption tests. Those human/external gates block the “84 finished tracks” claim only; independent implementation continues.

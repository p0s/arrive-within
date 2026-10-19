# Chatterbox audition rights record

Status: Pinned default-model candidate generation and public redistribution evidence recorded; human/legal release review deferred, not passed
Verified: 2026-08-11

## Exact upstreams

- Source: `resemble-ai/chatterbox` commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`; package version `0.1.7`.
- Watermark dependency: `resemble-ai/Perth` commit `ce86c49d029f42272c1902eccb675556b9ed2330`.
- Model repository: `ResembleAI/chatterbox` revision `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`.
- Code/model license evidence: <https://github.com/resemble-ai/chatterbox/blob/5de7a54aa4e5e2baadb0182dde554908b48b85c2/LICENSE> and <https://huggingface.co/ResembleAI/chatterbox> identify MIT licensing.
- Commercial/output-use evidence: <https://www.resemble.ai/learn/models/chatterbox> states that the Chatterbox family may be used in commercial products, self-hosted, modified, and shipped to production without royalties, revenue share, or usage caps.
- German path and accent warning: <https://github.com/resemble-ai/chatterbox/blob/5de7a54aa4e5e2baadb0182dde554908b48b85c2/multilingual_app.py> documents `language_id` use, a default voice with no supplied prompt, and warns that a mismatched reference language can transfer accent.

The exact upstream source and model revisions are additionally fixed in `ContentProduction/chatterbox-audition/uv.lock` and `ContentProduction/audition-plan.json`. Downloaded weight checksums are recorded by the private generation manifest.

## Voice boundary

The baseline uses the built-in default conditionals with no `audio_prompt_path`. It does not use CMU Arctic, a demo-page recording, an uploaded reference, a cloned speaker, or a named person's voice. `default-en` and `default-de-v3` are non-biometric workflow labels, not speaker identities.

Official MIT/commercial-use evidence supports generation and redistribution of output from Arrive Within's original scripts. The owner selected English F2 and German C2 and directed that the objectively validated mastered M4A/VTT/public-safe provenance set be public shipping source rather than ignored. This record does not substitute for the separately deferred fluent listening, editorial, pronunciation/artifact, transcript, physical-audio, or human/legal rights review, and no file is called a finished narration track until those gates and the exact package checks pass.

Any future reference voice is rejected by default until recording license, speaker consent, checksum, language fit, accent implications, commercial redistribution, and CC BY 4.0 sublicensing compatibility are documented.

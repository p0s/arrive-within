# Asset policy

Every Arrive Within asset must be original or accompanied by exact rights that allow its intended public-source and App Store use.

## Required provenance

Record, as applicable:

- stable asset ID, purpose, author/creator, creation date, source path, and SHA-256;
- source and output dimensions/format/color/alpha state;
- tool, package, repository, model/weights, and exact version/revision;
- prompts, parameters, deterministic seeds, and every input/reference role;
- license, required attribution/notices, output-rights evidence, and redistribution decision;
- human visual/listening/editorial review state and known limitations.

Machine-readable manifests should use repository-relative public paths and omit credentials, personal paths, biometric fingerprints, reviewer identities, and private model locations.

## Generated images and video

Generated media may enter the product only when the tool’s terms permit the project to redistribute the output under the declared media license and every input is owned or separately cleared. Preserve prompts, raw outputs, selected output, rejected-output reasons, and hashes. AI generation never authorizes copying a third-party identity, layout, character, logo, or proprietary behavior.

App Store screenshots and public films must use actual deterministic rendered product UI/state, safe synthetic data, local fonts/assets, blocked external network, opaque RGB outputs, and human visual review. Do not invent features or use a generated mock as product evidence.

## Voice and audio

No system/browser/macOS robot voice ships as guided narration. Never clone a real person or condition on a reference recording without documented recording rights, speaker identity/voice-cloning consent, language fit, output rights, and compatibility with public App Store/media redistribution. A model license alone is not speaker consent.

Private voice references, raw auditions, raw generation/intermediate state, model weights, caches, credentials, and reviewer identities stay ignored. Once the exact bilingual objective gate passes, the selected mastered M4A files, aligned VTT files, and public-safe per-track provenance are promoted into `Content/guided` as intentional tracked shipping-source assets; they must not remain gitignored. Their provenance must continue to label deferred human listening, editorial, pronunciation/artifact, and rights sign-off honestly rather than implying those gates passed. Assemble complete narration tracks before normalization; keep automated signal QA separate from fluent human listening and editorial review.

Procedural ambience/bells must record the generator and confirm that no sample or third-party recording was used.

## Third-party assets

Do not import an asset because it is publicly viewable or found in another repository. Confirm the exact file’s license, attribution, modification/redistribution terms, commercial/App Store compatibility, and provenance. Preserve the original notice in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and the asset manifest. If rights are unclear, exclude or replace the asset.

Reference material is study-only and must never enter the tracked source, build, release archive, screenshot, or generated evidence. No Sakura, Messenger, SoulGarden, or other reference product asset or recognizable proprietary composition is authorized.

## Licensing map

Covered original product media is offered under [CC BY 4.0](../legal/MEDIA_LICENSE.md). Project-owned code and build tooling use [MIT](../../LICENSE). The license does not grant trademark rights in the Arrive Within name or official identity. Third-party material always keeps its own license.

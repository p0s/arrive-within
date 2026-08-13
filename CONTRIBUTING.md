# Contributing

Thank you for improving Arrive Within itself: its native app, deterministic garden, renderer, original content, accessibility, privacy, performance, and reliability.

## Before starting

- Search existing issues and choose the form matching the work.
- Keep a change focused on one coherent product gap.
- Use a topic branch and pull request for normal product or code changes. Keep commits cohesive, reviewable, and limited to the stated outcome.
- A maintainer may intentionally handle a trivial documentation correction or urgent safety fix directly, but the same public-boundary checks and honest evidence rules still apply.
- For a material product, privacy, cost, rights, identity, or release-policy change, open a feature proposal before implementation.
- Never add private configuration, credentials, signing material, model weights, voice references, personal data, uncertain-rights assets, or copied competitor behavior.
- Read the [architecture overview](docs/architecture/OVERVIEW.md), [asset policy](docs/contributing/ASSET_POLICY.md), and the relevant art/content guide.

## Local setup

Follow [README.md](README.md#build-locally). The default build is simulator-safe and local-only: it contains no paid-team requirement or official CloudKit identifier. Run `./scripts/check` before requesting review.

Simulator and XCTest work is serialized on a shared Mac. Use `scripts/run_guarded_xcode_tests.sh`; do not start overlapping raw test invocations or simulator mutations.

## Pull requests

A pull request should:

- explain the user-visible outcome and the acceptance criterion it advances;
- include the smallest relevant automated tests and keep existing meaningful checks enabled;
- include before/after rendered images for visual changes, with device, OS, locale, content size, and appearance;
- state accessibility, localization, privacy, data-migration, renderer, and offline impact;
- include source, license, provenance, prompts/parameters, and hashes for every asset change;
- distinguish simulator/local evidence from physical device, CloudKit, TestFlight, App Store, website, and public-release evidence;
- avoid unsupported availability or release claims;
- pass the required local checks and maintainer review before merge.

Physical-device evidence is required where the behavior depends on audio routes, lock/background/interruption, microphone, notifications, performance/thermal limits, private CloudKit, signing, or an exact distributed candidate. A simulator screenshot is not a substitute.

## Before pushing

- Review the exact staged diff and commit range. Normal product/code batches run `./scripts/goal`, which includes the public-tree, privacy/data-flow, secret-signature, and Git-history boundaries.
- For an explicitly bounded documentation exception, run at least `git diff --check`, `node scripts/validate_public_repository.mjs`, `node scripts/validate_privacy_data_flows.mjs`, `node scripts/validate_manual_security_review.mjs`, and the smallest relevant documentation check.
- Confirm that no secret, private path, ignored evidence, personal identifier, signing value, credential, uncertain-rights asset, or unsupported release claim enters the branch or its history.
- Do not add or enable GitHub Actions unless the owner separately authorizes that exact workflow and cost surface.
- A branch, push, or pull request never authorizes TestFlight, App Store, website deployment, tags, releases, repository settings, or another external mutation. Each requires separate owner authorization.

## Code and product conventions

- Keep source-of-truth events and progression in native Swift; the renderer is a bounded projection.
- Keep completion idempotent and deterministic across replay, relaunch, sync order, and renderer failure.
- Preserve full local-only behavior when optional services or permissions are unavailable.
- Use native, accessible navigation and controls around the garden.
- Add English and natural German copy together; no raw localization keys or machine-only translation.
- Treat warnings as errors and Swift strict concurrency as part of the contract.
- Do not introduce tracking, ads, attribution, product accounts, custom journal backends, runtime AI, StoreKit, or paid garden progress without an explicit new product decision.

## Art, audio, and content

All contributed material must be original or have documented compatible rights. Do not submit a real-person voice clone or a reference recording without the speaker’s explicit voice-cloning and redistribution consent. Generated media requires tool/model/version, prompt/parameters, input-rights boundary, output-rights evidence, and checksums. See the [art direction](docs/contributing/ART_DIRECTION.md), [guided-content guide](docs/contributing/CONTENT_GUIDE.md), and [asset policy](docs/contributing/ASSET_POLICY.md).

## Inbound licensing

No CLA is required for V1.0. By intentionally submitting a contribution, you represent that you have the right to do so and agree that:

- code, build tooling, and documentation source are contributed under MIT;
- original media placed in paths covered by `docs/legal/MEDIA_LICENSE.md` is contributed under CC BY 4.0;
- third-party material keeps its exact compatible license and notices;
- trademarks and official identity are not licensed by a code or media contribution.

Only submit material you have the right to license on those terms. Mark material conspicuously if it is not intended as a contribution.

## Community

Be respectful, constructive, and specific. A lightweight project can add a formal conduct policy when contributor volume warrants it. Report security issues privately under [SECURITY.md](SECURITY.md); do not disclose exploitable details in a public issue.

# Security policy

## Supported state

Arrive Within is pre-release. Security fixes are developed against the current canonical source until an immutable public release exists. Published release support ranges will be added only when they are real.

## Report privately

Use the repository host's private vulnerability-reporting feature when it is enabled. If no private channel is published yet, do not open a public issue containing exploit details, secrets, private user data, or a working proof of concept; wait for the support route in the released product metadata to be activated.

Include the affected source revision, platform/OS/device, prerequisites, reproducible steps, impact, and the smallest safe evidence. Remove tokens, profiles, CloudKit identifiers, journal content, audio, and personal data.

Maintainers will acknowledge when practical, validate sceptically, coordinate a fix and disclosure boundary, and credit the reporter if requested and safe. No response or bounty SLA is promised.

## High-value boundaries

- journal text, voice recordings, transcripts, history, settings, exports, and private CloudKit records;
- exact-once immutable practice events, generation reset, deletion, and replica conflict handling;
- WebKit navigation/network isolation, typed bridge size/schema/range validation, and diagnostics redaction;
- file protection, microphone/speech/notification permission timing, and background audio state;
- build/signing configuration, entitlements, privacy manifest, release archives, asset provenance, and public-history cleanliness.

## Safe research

Use your own local data and the public local-only configuration. Do not access another person’s device, iCloud account, records, journal, voice material, credentials, or private repository; do not test production CloudKit or App Store systems without written authorization; do not degrade services or publish data. Stop when a test would cross those boundaries and report the hypothesis privately.

## Out of scope

Unverified scanner output, social engineering, denial-of-service, physical access attacks, vulnerabilities only in unsupported modified builds, and findings that require removing platform security controls are not automatically actionable. Dependency vulnerabilities are assessed by reachability and shipped impact, not version string alone.

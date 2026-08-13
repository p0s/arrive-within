# Privacy and exact-binary release worksheet

Status: current-candidate source reconciled; exact rebuilt binary pending

Machine-readable authority: `docs/release/app-privacy-worksheet.json`
Deterministic check: `./scripts/validate_release_sources.mjs --write-report`
Current result: version 1.0 is local-only, contains no in-app feedback transmission target or UI, and its App Privacy answer is **Data Not Collected**. Rebuilt archive/IPA inspection remains required.

## Data inventory

| Data | Local purpose | Private CloudKit | Third party/operator | User control |
|---|---|---|---|---|
| Practice events and garden seed | history/progression | disabled in 1.0 | none | export, reset, delete |
| Garden customization/favorites | presentation/preferences | disabled in 1.0 | none | edit, export, delete |
| Journal text | private reflection/search | disabled in 1.0 | none | edit, export, delete |
| Journal voice AAC | private reflection | disabled in 1.0 | none | play, export, delete |
| On-device transcript | user-requested transcription | disabled in 1.0 | none | edit, export, delete |
| Reminder schedules | local notifications | no | none | edit/delete in app and Settings |
| Redacted diagnostics | user-initiated support | no automatic transmission | only if user explicitly shares | preview/export/delete |

## Executable App Privacy positions

- Local-only mode sends no product or journal data off device. Under Apple's current guidance, on-device-only processing is not collected.
- CloudKit runtime activation is disabled in 1.0 until deletion completion and stale-device convergence have operation-specific two-device proof.
- Version 1.0 has no support composer, feedback endpoint, or feedback transport dependency. Settings provides ordinary web links to Privacy and Support without attaching app data.
- ATT prompt, advertising, attribution, analytics SDKs, product-data backend, and automatic support upload are absent by contract and source check.
- The exact two-mode inventory, provisional categories, and final gate live in `app-privacy-worksheet.json`; no null final answer may be replaced without its evidence.

## Current source audit

- `PrivacyInfo.xcprivacy` is valid XML and declares tracking false, no tracking domains, no collected data types, and only `NSPrivacyAccessedAPICategorySystemBootTime` with reason `35F9.1`.
- Shipping source uses `ProcessInfo.processInfo.systemUptime` for elapsed meditation timing. It does not use the audited file-timestamp, UserDefaults/CFPreferences, disk-space, or active-keyboard required-reason categories.
- FileManager use is limited to app-container paths, protected file creation/removal/existence, and protection attributes; the audited timestamp selectors are absent.
- The shipping app has one bounded StoreKit 2 non-consumable path for Premium Garden styles. The exact product ID, verified/unrevoked transaction rules, restore behavior, local test configuration, and no-subscription boundary are source-validated. ATT/AdSupport/analytics SDKs, Network framework clients, `URLSession`, and SFSafariViewController remain absent.
- The renderer WebView uses a nonpersistent data store, loads its verified local file bundle, and cancels navigation outside the allowed directory.
- English and German microphone and speech-recognition purpose strings exist. `ITSAppUsesNonExemptEncryption` is false in source, pending exact archive verification.
- Public and release source have no signing-entitlement binding, CloudKit container, or feedback endpoint. Ignored local configuration supplies signing values only for version 1.0.

## Required final checks

- Audit every required-reason API and match current Apple reason declarations.
- Package and inspect `PrivacyInfo.xcprivacy` in the exact archive/IPA.
- Verify localized microphone, speech-recognition, and notification context strings in English/German.
- Verify no ATT prompt, tracking domain, analytics/ads/attribution SDK, fingerprinting, or behavioral profiling.
- Verify no custom backend, journal upload, runtime AI, or operator-visible CloudKit data.
- Verify the exact binary contains no feedback endpoint, transport dependency, feedback localization resources, or reachable transmission UI.
- Inspect built entitlements, `Info.plist`, linked frameworks, endpoints, and resources; require no CloudKit entitlement or container.
- Reconcile App Privacy answers with the exact local-only binary.
- Reconcile encryption/export-compliance answers with Apple platform encryption and the exact binary.
- Verify file protection, local database/audio backup policy, redacted logs, short-lived export staging, reset generation, settings removal, and local delete-all.
- Re-run `validate_release_sources.mjs` against the frozen prospective-public source manifest and bind its report hash into the candidate manifest.
- Inspect the exact archive and exported IPA; source inclusion does not prove packaged `PrivacyInfo.xcprivacy`, built values, frameworks, endpoints, or signing entitlements.

## StoreKit purchase boundary

The source scan permits StoreKit only in `PremiumGardenStyles.swift`, binds exactly one `NonConsumable` product and one local `.storekit` configuration, requires verified and unrevoked current entitlements, and forbids legacy payment APIs or subscription products. App Store Connect readback binds product `6801014376` at a USD 4.99 base price, English/German metadata, 175 territories plus future territories, and `READY_TO_SUBMIT`; it is not attached to the App Store version currently in review. Exact archive and TestFlight readback remain separate evidence.

## Candidate binding

Marketing version, build, prospective-public tree/manifest hashes, unavailable Git-lineage state, archive/IPA hashes, Info.plist hash, entitlements hash, privacy-manifest hash, linked-framework inventory, endpoint inventory, and App Privacy answer revision remain empty until one immutable candidate exists.

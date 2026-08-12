# Concrete iPhone and iPad Release builds

Date: 2026-08-10
Status: passed locally; unsigned simulator evidence only

Two separate `Release` builds passed with `CODE_SIGNING_ALLOWED=NO`:

- iPhone 17 Pro, iOS 26.5 simulator, with the exact destination identifier retained only in private local evidence;
- iPad Pro 13-inch (M5), iOS 26.5 simulator, with the exact destination identifier retained only in private local evidence.

Each fresh-destination built bundle contains 102 files, occupies 14,748 KiB, and contains arm64 and x86_64 simulator slices. Both builds bind to the 63-file shipping-source SHA-256 `2e86045d7d562b1de2002a759fdda91079bcb0b5160f3a359a32a864df16f5bf`. The built `Info.plist` is identical across both builds and records bundle ID `com.philipps.arrivewithin.ios`, version `1.0 (1)`, minimum iOS 18.0, both device families, English and German localizations, no configured CloudKit container, and non-exempt encryption false. `PrivacyInfo.xcprivacy` is packaged identically in both bundles with tracking false and `NSPrivacyAccessedAPICategorySystemBootTime / 35F9.1`. `otool` inspection found no StoreKit framework linkage.

The machine-readable report records the exact destinations, source-tree binding, toolchain, bundle hashes, built values, and claim boundary: `docs/qa/release/concrete-simulator-release-builds.json`.

These outputs are not archives or IPAs and are not signed candidates. They do not prove device installation, physical performance, production entitlements/signing, official CloudKit, TestFlight, or App Store state. Exact archive/IPA inspection remains a later separately authorized candidate gate.

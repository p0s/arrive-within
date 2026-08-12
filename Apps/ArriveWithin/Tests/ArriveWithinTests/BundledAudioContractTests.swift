import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import CryptoKit
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Bundled native audio contract")
@MainActor
struct BundledAudioContractTests {
  @Test("Every enabled procedural layer resolves through the signed manifest")
  func proceduralAssetsVerify() throws {
    let audio = try MeditationAudioConfiguration(
      intervalBellMinutes: 1,
      ambienceID: "still-air-v1",
      ambienceVolume: 0.3
    )
    let session = try MeditationSession(
      id: UUID(),
      profileGenerationID: UUID(),
      mode: .timer,
      targetDurationMilliseconds: 180_000,
      preparedAt: Date(),
      configuration: MeditationSessionConfiguration(audio: audio)
    )
    let controller = try NativeMeditationAudioController(bundle: .main)

    try controller.validate(session: session)
    controller.stop()
  }

  @Test("Guided narration availability matches its explicit catalogue state")
  func guidedNarrationMatchesCatalogState() throws {
    let audio = try MeditationAudioConfiguration(narrationLanguageCode: "en")
    let session = try MeditationSession(
      id: UUID(),
      profileGenerationID: UUID(),
      mode: .guided,
      guidedContentID: "G01",
      guidedContentVersion: 1,
      targetDurationMilliseconds: 180_000,
      preparedAt: Date(),
      configuration: MeditationSessionConfiguration(audio: audio)
    )
    let controller = try NativeMeditationAudioController(bundle: .main)

    let catalogURL = try #require(
      Bundle.main.url(forResource: "catalog", withExtension: "json", subdirectory: "guided")
    )
    let document = try GuidedCatalogLoader.decode(Data(contentsOf: catalogURL))
    let practice = try #require(document.practices.first(where: { $0.id == "G01" }))
    let state = practice.localized.en.editorialState

    if state.isPackagedForPlayback {
      try controller.validate(session: session)
    } else {
      #expect(
        throws: MeditationAudioControllerError.narrationNotApproved("G01", "en")
      ) {
        try controller.validate(session: session)
      }
    }
    controller.stop()
  }

  @Test("The app bundle contains the exact complete bilingual catalogue")
  func guidedCatalogIsBundled() throws {
    let url = try #require(
      Bundle.main.url(
        forResource: "catalog",
        withExtension: "json",
        subdirectory: "guided"
      )
    )
    let document = try GuidedCatalogLoader.decode(Data(contentsOf: url))

    #expect(document.practices.count == 42)
    #expect(document.practices.map(\.id) == (1...42).map { String(format: "G%02d", $0) })
  }

  @Test("Narration bytes fail closed without approved hash-bound provenance")
  func narrationRequiresApprovedProvenance() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let bundleRoot = root.appendingPathComponent("Fixture.bundle")
    let audioRoot = bundleRoot.appendingPathComponent("Audio")
    let guidedRoot = bundleRoot.appendingPathComponent("guided/G01")
    try FileManager.default.createDirectory(at: audioRoot, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: guidedRoot, withIntermediateDirectories: true)
    let procedural = [
      ("opening-bell-v1", "opening-bell.wav"),
      ("closing-bell-v1", "closing-bell.wav"),
      ("still-air-v1", "still-air.wav"),
    ]
    let bytes = Data("fixture".utf8)
    let transcriptBytes = Data("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n".utf8)
    for (_, path) in procedural { try bytes.write(to: audioRoot.appendingPathComponent(path)) }
    let sha256 = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    let manifest: [String: Any] = [
      "schema_version": 1,
      "assets": procedural.map { ["id": $0.0, "path": $0.1, "sha256": sha256] },
    ]
    try JSONSerialization.data(withJSONObject: manifest).write(
      to: audioRoot.appendingPathComponent("audio-assets.json")
    )
    try bytes.write(to: guidedRoot.appendingPathComponent("audio.en.m4a"))
    try transcriptBytes.write(to: guidedRoot.appendingPathComponent("transcript.en.vtt"))
    try Data("fallback".utf8).write(to: bundleRoot.appendingPathComponent("audio.en.m4a"))
    try PropertyListSerialization.data(
      fromPropertyList: [
        "CFBundleIdentifier": "test.arrive-within.audio",
        "CFBundleVersion": "1",
        "CFBundlePackageType": "BNDL",
      ],
      format: .xml,
      options: 0
    ).write(to: bundleRoot.appendingPathComponent("Info.plist"))
    defer { try? FileManager.default.removeItem(at: root) }

    let bundle = try #require(Bundle(url: bundleRoot))
    let resolver = try BundledAudioAssetResolver(bundle: bundle)
    #expect(
      bundle.url(forResource: "audio.en", withExtension: "m4a") != nil,
      "Fixture must include a root fallback that may never authorize narration."
    )
    #expect(resolver.approvedNarrationURL(contentID: "G01", languageCode: "en") == nil)

    let provenance: [String: Any] = [
      "contentID": "G01",
      "language": "en",
      "audioSHA256": sha256,
      "transcriptSHA256": SHA256.hash(data: transcriptBytes)
        .map { String(format: "%02x", $0) }.joined(),
      "rightsState": "approved",
      "humanListeningState": "approved",
      "scriptSafetyState": "approved",
      "transcriptAlignmentState": "approved",
      "productionMasterApproval": true,
      "finishedTrackApproval": true,
    ]
    try JSONSerialization.data(withJSONObject: provenance).write(
      to: guidedRoot.appendingPathComponent("provenance.en.json")
    )
    #expect(resolver.approvedNarrationURL(contentID: "G01", languageCode: "en") != nil)
    #expect(
      BundledAudioAssetResolver.packagedNarrationURL(
        bundle: bundle, contentID: "G01", languageCode: "en") != nil
    )

    var tampered = provenance
    tampered["audioSHA256"] = String(repeating: "0", count: 64)
    try JSONSerialization.data(withJSONObject: tampered).write(
      to: guidedRoot.appendingPathComponent("provenance.en.json")
    )
    #expect(resolver.approvedNarrationURL(contentID: "G01", languageCode: "en") == nil)
    #expect(
      BundledAudioAssetResolver.packagedNarrationURL(
        bundle: bundle, contentID: "G01", languageCode: "en") != nil,
      "The lightweight UI check reads approval metadata; playback rehashes bytes and fails closed."
    )

    try JSONSerialization.data(withJSONObject: provenance).write(
      to: guidedRoot.appendingPathComponent("provenance.en.json")
    )
    try Data("tampered transcript".utf8).write(
      to: guidedRoot.appendingPathComponent("transcript.en.vtt")
    )
    #expect(resolver.approvedNarrationURL(contentID: "G01", languageCode: "en") == nil)
  }
}

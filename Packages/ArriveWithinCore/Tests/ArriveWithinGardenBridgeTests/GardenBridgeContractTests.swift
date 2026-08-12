import ArriveWithinDomain
import ArriveWithinGardenBridge
import ArriveWithinTestSupport
import Foundation
import Testing

@Suite("Bounded garden bridge")
struct GardenBridgeContractTests {
  @Test("A snapshot round-trips without changing authoritative state")
  func snapshotRoundTrip() throws {
    let state = GardenState(
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      profileGenerationID: ArriveWithinFixtures.generationID,
      qualifyingSessionCount: 2,
      totalQualifyingSeconds: 480,
      journeyDay: 2,
      highestMilestone: 1,
      unlockedVariants: ["m01-a", "m01-b"],
      activeCustomization: [1: "m01-a"],
      microGrowthOrdinal: 2,
      localTimePresentation: "2026-08-10",
      latestGrowthEvent: nil,
      reduceMotion: false,
      qualityHint: .balanced
    )
    let requestID = UUID(uuidString: "60000000-0000-4000-8000-000000000001")!

    let encoded = try GardenBridgeCodec.encodeSnapshot(state, requestID: requestID)
    let decoded = try GardenBridgeCodec.decodeSnapshot(encoded)

    #expect(decoded.requestID == requestID)
    #expect(decoded.payload.state == state)
    #expect(encoded.count < GardenBridgeCodec.maximumMessageBytes)
  }

  @Test("Native description exposes equivalent English and German progress")
  func bilingualFallbackDescription() {
    let state = GardenState(
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 1,
      profileGenerationID: ArriveWithinFixtures.generationID,
      qualifyingSessionCount: 3,
      totalQualifyingSeconds: 600,
      journeyDay: 2,
      highestMilestone: 1,
      unlockedVariants: ["m01-a", "m01-b"],
      activeCustomization: [:],
      microGrowthOrdinal: 3,
      localTimePresentation: "2026-08-10",
      latestGrowthEvent: nil,
      reduceMotion: true,
      qualityHint: .low
    )

    #expect(GardenDescription.text(for: state, language: .english).contains("3"))
    #expect(GardenDescription.text(for: state, language: .german).contains("3"))
    #expect(GardenDescription.text(for: state, language: .english).contains("1 of 15"))
    #expect(GardenDescription.text(for: state, language: .german).contains("1 von 15"))
  }
}

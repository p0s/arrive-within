import Foundation

public enum GardenSeedContract {
  /// JavaScript can represent every integer through this value without precision loss.
  public static let maximumExactCrossRuntimeValue: UInt64 = 9_007_199_254_740_991
}

public enum GardenQualityHint: String, Codable, CaseIterable, Sendable {
  case low
  case balanced
  case high
}

public struct GardenCustomization: Codable, Equatable, Sendable {
  public var selectedVariantByMilestone: [Int: String]

  public init(selectedVariantByMilestone: [Int: String] = [:]) {
    self.selectedVariantByMilestone = selectedVariantByMilestone
  }
}

public protocol GardenCustomizationRepository: Sendable {
  func load(profileGenerationID: UUID) async throws -> GardenCustomization
  func save(_ customization: GardenCustomization, profileGenerationID: UUID) async throws
  func deleteAll(profileGenerationID: UUID) async throws
}

public actor EphemeralGardenCustomizationRepository: GardenCustomizationRepository {
  private var values: [UUID: GardenCustomization] = [:]

  public init() {}

  public func load(profileGenerationID: UUID) -> GardenCustomization {
    values[profileGenerationID] ?? GardenCustomization()
  }

  public func save(_ customization: GardenCustomization, profileGenerationID: UUID) {
    values[profileGenerationID] = customization
  }

  public func deleteAll(profileGenerationID: UUID) {
    values.removeValue(forKey: profileGenerationID)
  }
}

public struct GardenProjectionContext: Codable, Equatable, Sendable {
  public let gardenID: UUID
  public let gardenSeed: UInt64
  public let profileGenerationID: UUID
  public var customization: GardenCustomization
  public var reduceMotion: Bool
  public var qualityHint: GardenQualityHint

  public init(
    gardenID: UUID,
    gardenSeed: UInt64,
    profileGenerationID: UUID,
    customization: GardenCustomization = .init(),
    reduceMotion: Bool = false,
    qualityHint: GardenQualityHint = .balanced
  ) {
    precondition(
      gardenSeed <= GardenSeedContract.maximumExactCrossRuntimeValue,
      "Garden seeds must remain exactly representable across Swift and JavaScript."
    )
    self.gardenID = gardenID
    self.gardenSeed = gardenSeed
    self.profileGenerationID = profileGenerationID
    self.customization = customization
    self.reduceMotion = reduceMotion
    self.qualityHint = qualityHint
  }
}

public struct GardenGrowthEvent: Codable, Equatable, Sendable {
  public let practiceEventID: UUID
  public let sessionID: UUID
  public let beforeMicroGrowthOrdinal: Int
  public let afterMicroGrowthOrdinal: Int
  public let beforeJourneyDay: Int
  public let afterJourneyDay: Int

  public init(
    practiceEventID: UUID,
    sessionID: UUID,
    beforeMicroGrowthOrdinal: Int,
    afterMicroGrowthOrdinal: Int,
    beforeJourneyDay: Int,
    afterJourneyDay: Int
  ) {
    self.practiceEventID = practiceEventID
    self.sessionID = sessionID
    self.beforeMicroGrowthOrdinal = beforeMicroGrowthOrdinal
    self.afterMicroGrowthOrdinal = afterMicroGrowthOrdinal
    self.beforeJourneyDay = beforeJourneyDay
    self.afterJourneyDay = afterJourneyDay
  }
}

public struct GardenState: Codable, Equatable, Sendable {
  public static let currentSchemaVersion = 1

  public let schemaVersion: Int
  public let gardenID: UUID
  public let gardenSeed: UInt64
  public let profileGenerationID: UUID
  public let qualifyingSessionCount: Int
  public let totalQualifyingSeconds: Int
  public let journeyDay: Int
  public let highestMilestone: Int
  public let unlockedVariants: [String]
  public let activeCustomization: [Int: String]
  public let microGrowthOrdinal: Int
  public let localTimePresentation: String?
  public let latestGrowthEvent: GardenGrowthEvent?
  public let reduceMotion: Bool
  public let qualityHint: GardenQualityHint

  public init(
    schemaVersion: Int = Self.currentSchemaVersion,
    gardenID: UUID,
    gardenSeed: UInt64,
    profileGenerationID: UUID,
    qualifyingSessionCount: Int,
    totalQualifyingSeconds: Int,
    journeyDay: Int,
    highestMilestone: Int,
    unlockedVariants: [String],
    activeCustomization: [Int: String],
    microGrowthOrdinal: Int,
    localTimePresentation: String?,
    latestGrowthEvent: GardenGrowthEvent?,
    reduceMotion: Bool,
    qualityHint: GardenQualityHint
  ) {
    precondition(
      gardenSeed <= GardenSeedContract.maximumExactCrossRuntimeValue,
      "Garden seeds must remain exactly representable across Swift and JavaScript."
    )
    self.schemaVersion = schemaVersion
    self.gardenID = gardenID
    self.gardenSeed = gardenSeed
    self.profileGenerationID = profileGenerationID
    self.qualifyingSessionCount = qualifyingSessionCount
    self.totalQualifyingSeconds = totalQualifyingSeconds
    self.journeyDay = journeyDay
    self.highestMilestone = highestMilestone
    self.unlockedVariants = unlockedVariants
    self.activeCustomization = activeCustomization
    self.microGrowthOrdinal = microGrowthOrdinal
    self.localTimePresentation = localTimePresentation
    self.latestGrowthEvent = latestGrowthEvent
    self.reduceMotion = reduceMotion
    self.qualityHint = qualityHint
  }
}

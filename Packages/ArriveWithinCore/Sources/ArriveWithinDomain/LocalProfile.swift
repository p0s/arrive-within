import Foundation

public struct LocalProfile: Codable, Equatable, Sendable {
  public static let currentSchemaVersion = 1

  public let schemaVersion: Int
  public let profileGenerationID: UUID
  public let gardenID: UUID
  public let gardenSeed: UInt64
  public let installationID: UUID
  public let createdAt: Date
  public let previousProfileGenerationID: UUID?
  public let resetAt: Date?
  public var hasCompletedFirstUse: Bool

  public init(
    schemaVersion: Int = Self.currentSchemaVersion,
    profileGenerationID: UUID,
    gardenID: UUID,
    gardenSeed: UInt64,
    installationID: UUID,
    createdAt: Date,
    previousProfileGenerationID: UUID? = nil,
    resetAt: Date? = nil,
    hasCompletedFirstUse: Bool
  ) throws {
    guard schemaVersion == Self.currentSchemaVersion else {
      throw LocalProfileError.unsupportedSchema(schemaVersion)
    }
    guard gardenSeed <= GardenSeedContract.maximumExactCrossRuntimeValue else {
      throw LocalProfileError.gardenSeedExceedsCrossRuntimePrecision
    }
    guard (previousProfileGenerationID == nil) == (resetAt == nil),
      resetAt.map({ $0 >= createdAt }) ?? true,
      previousProfileGenerationID != profileGenerationID
    else {
      throw LocalProfileError.invalidResetLineage
    }
    self.schemaVersion = schemaVersion
    self.profileGenerationID = profileGenerationID
    self.gardenID = gardenID
    self.gardenSeed = gardenSeed
    self.installationID = installationID
    self.createdAt = createdAt
    self.previousProfileGenerationID = previousProfileGenerationID
    self.resetAt = resetAt
    self.hasCompletedFirstUse = hasCompletedFirstUse
  }

  public func resetting(
    profileGenerationID: UUID,
    gardenID: UUID,
    gardenSeed: UInt64,
    at date: Date
  ) throws -> Self {
    try Self(
      profileGenerationID: profileGenerationID,
      gardenID: gardenID,
      gardenSeed: gardenSeed,
      installationID: installationID,
      createdAt: date,
      previousProfileGenerationID: self.profileGenerationID,
      resetAt: date,
      hasCompletedFirstUse: true
    )
  }
}

public protocol LocalProfileRepository: Sendable {
  func load() async throws -> LocalProfile?
  func save(_ profile: LocalProfile) async throws
}

public enum LocalProfileError: Error, Equatable, Sendable {
  case unsupportedSchema(Int)
  case gardenSeedExceedsCrossRuntimePrecision
  case invalidResetLineage
}

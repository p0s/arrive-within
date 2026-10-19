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

  private enum CodingKeys: String, CodingKey {
    case schemaVersion
    case profileGenerationID
    case gardenID
    case gardenSeed
    case installationID
    case createdAt
    case previousProfileGenerationID
    case resetAt
    case hasCompletedFirstUse
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      schemaVersion: container.decode(Int.self, forKey: .schemaVersion),
      profileGenerationID: container.decode(UUID.self, forKey: .profileGenerationID),
      gardenID: container.decode(UUID.self, forKey: .gardenID),
      gardenSeed: container.decode(UInt64.self, forKey: .gardenSeed),
      installationID: container.decode(UUID.self, forKey: .installationID),
      createdAt: container.decode(Date.self, forKey: .createdAt),
      previousProfileGenerationID: container.decodeIfPresent(
        UUID.self,
        forKey: .previousProfileGenerationID
      ),
      resetAt: container.decodeIfPresent(Date.self, forKey: .resetAt),
      hasCompletedFirstUse: container.decode(Bool.self, forKey: .hasCompletedFirstUse)
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

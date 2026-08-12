import Foundation

public enum PreparationDuration: Int, Codable, CaseIterable, Sendable {
  case off = 0
  case fiveSeconds = 5
  case tenSeconds = 10
  case thirtySeconds = 30
  case sixtySeconds = 60

  public var milliseconds: Int64 { Int64(rawValue) * 1_000 }
}

public enum OtherAudioPolicy: String, Codable, CaseIterable, Sendable {
  case pauseOthers
  case mixWithOthers
}

public struct MeditationAudioConfiguration: Codable, Equatable, Sendable {
  public let openingBellEnabled: Bool
  public let closingBellEnabled: Bool
  public let intervalBellMinutes: Int?
  public let ambienceID: String?
  public let ambienceVolume: Double
  public let otherAudioPolicy: OtherAudioPolicy
  public let narrationLanguageCode: String?
  public let hapticsEnabled: Bool
  public let backgroundEndAlertEnabled: Bool

  public init(
    openingBellEnabled: Bool = true,
    closingBellEnabled: Bool = true,
    intervalBellMinutes: Int? = nil,
    ambienceID: String? = nil,
    ambienceVolume: Double = 0.3,
    otherAudioPolicy: OtherAudioPolicy = .pauseOthers,
    narrationLanguageCode: String? = nil,
    hapticsEnabled: Bool = true,
    backgroundEndAlertEnabled: Bool = false
  ) throws {
    guard intervalBellMinutes == nil || (1...180).contains(intervalBellMinutes!) else {
      throw MeditationConfigurationError.invalidInterval
    }
    guard ambienceVolume.isFinite, (0...1).contains(ambienceVolume) else {
      throw MeditationConfigurationError.invalidAmbienceVolume
    }
    if let ambienceID, ambienceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      throw MeditationConfigurationError.invalidAmbienceIdentifier
    }
    if let narrationLanguageCode, !["en", "de"].contains(narrationLanguageCode) {
      throw MeditationConfigurationError.invalidNarrationLanguage
    }

    self.openingBellEnabled = openingBellEnabled
    self.closingBellEnabled = closingBellEnabled
    self.intervalBellMinutes = intervalBellMinutes
    self.ambienceID = ambienceID
    self.ambienceVolume = ambienceVolume
    self.otherAudioPolicy = otherAudioPolicy
    self.narrationLanguageCode = narrationLanguageCode
    self.hapticsEnabled = hapticsEnabled
    self.backgroundEndAlertEnabled = backgroundEndAlertEnabled
  }

  public static let standard = try! Self()

  private enum CodingKeys: String, CodingKey {
    case openingBellEnabled
    case closingBellEnabled
    case intervalBellMinutes
    case ambienceID
    case ambienceVolume
    case otherAudioPolicy
    case narrationLanguageCode
    case hapticsEnabled
    case backgroundEndAlertEnabled
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      openingBellEnabled: try container.decode(Bool.self, forKey: .openingBellEnabled),
      closingBellEnabled: try container.decode(Bool.self, forKey: .closingBellEnabled),
      intervalBellMinutes: try container.decodeIfPresent(Int.self, forKey: .intervalBellMinutes),
      ambienceID: try container.decodeIfPresent(String.self, forKey: .ambienceID),
      ambienceVolume: try container.decode(Double.self, forKey: .ambienceVolume),
      otherAudioPolicy: try container.decode(OtherAudioPolicy.self, forKey: .otherAudioPolicy),
      narrationLanguageCode: try container.decodeIfPresent(
        String.self, forKey: .narrationLanguageCode),
      hapticsEnabled: try container.decode(Bool.self, forKey: .hapticsEnabled),
      backgroundEndAlertEnabled: try container.decodeIfPresent(
        Bool.self,
        forKey: .backgroundEndAlertEnabled
      ) ?? false
    )
  }
}

public struct MeditationSessionConfiguration: Codable, Equatable, Sendable {
  public let preparation: PreparationDuration
  public let audio: MeditationAudioConfiguration

  public init(
    preparation: PreparationDuration = .off,
    audio: MeditationAudioConfiguration = .standard
  ) {
    self.preparation = preparation
    self.audio = audio
  }

  public static let standard = Self()
}

public struct TimerPreferences: Codable, Equatable, Sendable {
  public static let currentSchemaVersion = 1
  public static let presets = [3, 5, 10, 15, 20, 30, 45, 60]

  public let schemaVersion: Int
  public let durationMinutes: Int
  public let preparation: PreparationDuration
  public let audio: MeditationAudioConfiguration

  public init(
    schemaVersion: Int = Self.currentSchemaVersion,
    durationMinutes: Int = 3,
    preparation: PreparationDuration = .off,
    audio: MeditationAudioConfiguration = .standard
  ) throws {
    guard schemaVersion == Self.currentSchemaVersion else {
      throw MeditationConfigurationError.unsupportedSchema(schemaVersion)
    }
    guard (1...180).contains(durationMinutes) else {
      throw MeditationConfigurationError.invalidTimerDuration
    }
    if let interval = audio.intervalBellMinutes, interval >= durationMinutes {
      throw MeditationConfigurationError.intervalMustPrecedeTimerEnd
    }
    self.schemaVersion = schemaVersion
    self.durationMinutes = durationMinutes
    self.preparation = preparation
    self.audio = audio
  }

  public static let standard = try! Self()

  private enum CodingKeys: String, CodingKey {
    case schemaVersion
    case durationMinutes
    case preparation
    case audio
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      schemaVersion: try container.decode(Int.self, forKey: .schemaVersion),
      durationMinutes: try container.decode(Int.self, forKey: .durationMinutes),
      preparation: try container.decode(PreparationDuration.self, forKey: .preparation),
      audio: try container.decode(MeditationAudioConfiguration.self, forKey: .audio)
    )
  }
}

public protocol MeditationPreferencesRepository: Sendable {
  func loadTimerPreferences() async throws -> TimerPreferences
  func saveTimerPreferences(_ preferences: TimerPreferences) async throws
}

public enum MeditationConfigurationError: Error, Equatable, Sendable {
  case invalidTimerDuration
  case invalidInterval
  case intervalMustPrecedeTimerEnd
  case invalidAmbienceIdentifier
  case invalidAmbienceVolume
  case invalidNarrationLanguage
  case unsupportedSchema(Int)
}

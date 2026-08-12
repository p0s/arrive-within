import Foundation

public enum JournalTranscriptionState: String, Codable, CaseIterable, Sendable {
  case notRequested
  case unavailable
  case transcribing
  case complete
  case failed
}

public struct JournalAudioAttachment: Codable, Equatable, Sendable {
  public static let maximumDurationMilliseconds: Int64 = 600_000

  public let relativeFileName: String
  public let contentType: String
  public let durationMilliseconds: Int64
  public let byteCount: Int64
  public let checksumSHA256: String
  public let recordedAt: Date

  public init(
    relativeFileName: String,
    contentType: String = "audio/mp4",
    durationMilliseconds: Int64,
    byteCount: Int64,
    checksumSHA256: String,
    recordedAt: Date
  ) throws {
    guard
      !relativeFileName.isEmpty,
      relativeFileName == URL(fileURLWithPath: relativeFileName).lastPathComponent,
      !relativeFileName.contains(".."),
      !relativeFileName.contains("/"),
      !relativeFileName.contains("\\"),
      contentType == "audio/mp4",
      (1...Self.maximumDurationMilliseconds).contains(durationMilliseconds),
      byteCount > 0,
      checksumSHA256.count == 64,
      checksumSHA256.allSatisfy({ $0.isHexDigit && !$0.isUppercase })
    else {
      throw JournalEntryError.invalidAudioAttachment
    }
    self.relativeFileName = relativeFileName
    self.contentType = contentType
    self.durationMilliseconds = durationMilliseconds
    self.byteCount = byteCount
    self.checksumSHA256 = checksumSHA256
    self.recordedAt = recordedAt
  }

  private enum CodingKeys: String, CodingKey {
    case relativeFileName
    case contentType
    case durationMilliseconds
    case byteCount
    case checksumSHA256
    case recordedAt
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      relativeFileName: container.decode(String.self, forKey: .relativeFileName),
      contentType: container.decode(String.self, forKey: .contentType),
      durationMilliseconds: container.decode(Int64.self, forKey: .durationMilliseconds),
      byteCount: container.decode(Int64.self, forKey: .byteCount),
      checksumSHA256: container.decode(String.self, forKey: .checksumSHA256),
      recordedAt: container.decode(Date.self, forKey: .recordedAt)
    )
  }
}

public struct JournalTranscript: Codable, Equatable, Sendable {
  public let text: String
  public let localeIdentifier: String
  public let generatedAt: Date
  public let engineIdentifier: String

  public init(
    text: String,
    localeIdentifier: String,
    generatedAt: Date,
    engineIdentifier: String = "apple-on-device-speech"
  ) throws {
    guard
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !localeIdentifier.isEmpty,
      engineIdentifier == "apple-on-device-speech"
    else {
      throw JournalEntryError.invalidTranscript
    }
    self.text = text
    self.localeIdentifier = localeIdentifier
    self.generatedAt = generatedAt
    self.engineIdentifier = engineIdentifier
  }

  private enum CodingKeys: String, CodingKey {
    case text
    case localeIdentifier
    case generatedAt
    case engineIdentifier
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      text: container.decode(String.self, forKey: .text),
      localeIdentifier: container.decode(String.self, forKey: .localeIdentifier),
      generatedAt: container.decode(Date.self, forKey: .generatedAt),
      engineIdentifier: container.decode(String.self, forKey: .engineIdentifier)
    )
  }
}

public struct JournalEntry: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let profileGenerationID: UUID
  public let linkedPracticeEventID: UUID?
  public let createdAt: Date
  public let sourceInstallationID: UUID
  public let revision: Int
  public let modifiedAt: Date
  public let text: String
  public let textLocaleIdentifier: String?
  public let audioAttachment: JournalAudioAttachment?
  public let transcript: JournalTranscript?
  public let transcriptionState: JournalTranscriptionState
  public let deletedAt: Date?

  public init(
    id: UUID,
    profileGenerationID: UUID,
    linkedPracticeEventID: UUID? = nil,
    createdAt: Date,
    sourceInstallationID: UUID,
    revision: Int = 0,
    modifiedAt: Date,
    text: String,
    textLocaleIdentifier: String? = nil,
    audioAttachment: JournalAudioAttachment? = nil,
    transcript: JournalTranscript? = nil,
    transcriptionState: JournalTranscriptionState = .notRequested,
    deletedAt: Date? = nil
  ) throws {
    guard revision >= 0, modifiedAt >= createdAt else {
      throw JournalEntryError.invalidRevision
    }
    if let textLocaleIdentifier, textLocaleIdentifier.isEmpty {
      throw JournalEntryError.invalidLocale
    }
    if deletedAt == nil {
      guard
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          || audioAttachment != nil
      else {
        throw JournalEntryError.emptyEntry
      }
    } else {
      guard text.isEmpty, audioAttachment == nil, transcript == nil else {
        throw JournalEntryError.tombstoneRetainsPrivateContent
      }
    }
    if transcript != nil, transcriptionState != .complete {
      throw JournalEntryError.invalidTranscriptionState
    }
    if audioAttachment == nil, transcriptionState != .notRequested {
      throw JournalEntryError.invalidTranscriptionState
    }
    self.id = id
    self.profileGenerationID = profileGenerationID
    self.linkedPracticeEventID = linkedPracticeEventID
    self.createdAt = createdAt
    self.sourceInstallationID = sourceInstallationID
    self.revision = revision
    self.modifiedAt = modifiedAt
    self.text = text
    self.textLocaleIdentifier = textLocaleIdentifier
    self.audioAttachment = audioAttachment
    self.transcript = transcript
    self.transcriptionState = transcriptionState
    self.deletedAt = deletedAt
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case profileGenerationID
    case linkedPracticeEventID
    case createdAt
    case sourceInstallationID
    case revision
    case modifiedAt
    case text
    case textLocaleIdentifier
    case audioAttachment
    case transcript
    case transcriptionState
    case deletedAt
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      id: container.decode(UUID.self, forKey: .id),
      profileGenerationID: container.decode(UUID.self, forKey: .profileGenerationID),
      linkedPracticeEventID: container.decodeIfPresent(UUID.self, forKey: .linkedPracticeEventID),
      createdAt: container.decode(Date.self, forKey: .createdAt),
      sourceInstallationID: container.decode(UUID.self, forKey: .sourceInstallationID),
      revision: container.decode(Int.self, forKey: .revision),
      modifiedAt: container.decode(Date.self, forKey: .modifiedAt),
      text: container.decode(String.self, forKey: .text),
      textLocaleIdentifier: container.decodeIfPresent(
        String.self,
        forKey: .textLocaleIdentifier
      ),
      audioAttachment: container.decodeIfPresent(
        JournalAudioAttachment.self,
        forKey: .audioAttachment
      ),
      transcript: container.decodeIfPresent(JournalTranscript.self, forKey: .transcript),
      transcriptionState: container.decode(
        JournalTranscriptionState.self,
        forKey: .transcriptionState
      ),
      deletedAt: container.decodeIfPresent(Date.self, forKey: .deletedAt)
    )
  }

  public var isDeleted: Bool { deletedAt != nil }

  public func replacingContent(
    text: String,
    textLocaleIdentifier: String?,
    audioAttachment: JournalAudioAttachment?,
    transcript: JournalTranscript?,
    transcriptionState: JournalTranscriptionState,
    modifiedAt: Date
  ) throws -> Self {
    try Self(
      id: id,
      profileGenerationID: profileGenerationID,
      linkedPracticeEventID: linkedPracticeEventID,
      createdAt: createdAt,
      sourceInstallationID: sourceInstallationID,
      revision: revision,
      modifiedAt: modifiedAt,
      text: text,
      textLocaleIdentifier: textLocaleIdentifier,
      audioAttachment: audioAttachment,
      transcript: transcript,
      transcriptionState: transcriptionState
    )
  }

  public func tombstoned(at date: Date) throws -> Self {
    try Self(
      id: id,
      profileGenerationID: profileGenerationID,
      linkedPracticeEventID: linkedPracticeEventID,
      createdAt: createdAt,
      sourceInstallationID: sourceInstallationID,
      revision: revision,
      modifiedAt: max(date, modifiedAt),
      text: "",
      textLocaleIdentifier: nil,
      transcriptionState: .notRequested,
      deletedAt: max(date, modifiedAt)
    )
  }

  public func persisted(revision: Int) throws -> Self {
    try Self(
      id: id,
      profileGenerationID: profileGenerationID,
      linkedPracticeEventID: linkedPracticeEventID,
      createdAt: createdAt,
      sourceInstallationID: sourceInstallationID,
      revision: revision,
      modifiedAt: modifiedAt,
      text: text,
      textLocaleIdentifier: textLocaleIdentifier,
      audioAttachment: audioAttachment,
      transcript: transcript,
      transcriptionState: transcriptionState,
      deletedAt: deletedAt
    )
  }
}

public enum JournalWriteResult: Equatable, Sendable {
  case saved(JournalEntry)
  case conflict(current: JournalEntry, attempted: JournalEntry)
}

/// Divergent immutable replicas at the same highest revision. Every variant
/// remains available until an explicit later revision resolves the fork.
public struct JournalReplicaConflict: Equatable, Identifiable, Sendable {
  public let entryID: UUID
  public let profileGenerationID: UUID
  public let revision: Int
  public let variants: [JournalEntry]

  public var id: UUID { entryID }

  public init(
    entryID: UUID,
    profileGenerationID: UUID,
    revision: Int,
    variants: [JournalEntry]
  ) {
    self.entryID = entryID
    self.profileGenerationID = profileGenerationID
    self.revision = revision
    self.variants = variants
  }
}

public protocol JournalEntryRepository: Sendable {
  func entries(profileGenerationID: UUID, includingDeleted: Bool) async throws -> [JournalEntry]
  func conflicts(profileGenerationID: UUID) async throws -> [JournalReplicaConflict]
  func save(_ entry: JournalEntry, expectedRevision: Int?) async throws -> JournalWriteResult
  func deleteAll(profileGenerationID: UUID) async throws
}

public extension JournalEntryRepository {
  func conflicts(profileGenerationID _: UUID) async throws -> [JournalReplicaConflict] { [] }
}

public actor EphemeralJournalEntryRepository: JournalEntryRepository {
  private var values: [UUID: JournalEntry] = [:]

  public init() {}

  public func entries(
    profileGenerationID: UUID,
    includingDeleted: Bool = false
  ) -> [JournalEntry] {
    values.values
      .filter {
        $0.profileGenerationID == profileGenerationID && (includingDeleted || !$0.isDeleted)
      }
      .sorted(by: JournalEntry.newestFirst)
  }

  public func conflicts(profileGenerationID _: UUID) -> [JournalReplicaConflict] { [] }

  public func save(
    _ entry: JournalEntry,
    expectedRevision: Int?
  ) throws -> JournalWriteResult {
    if let current = values[entry.id] {
      guard current.profileGenerationID == entry.profileGenerationID else {
        throw JournalEntryError.identityChanged
      }
      guard expectedRevision == current.revision, entry.revision == current.revision else {
        return .conflict(current: current, attempted: entry)
      }
      let saved = try entry.persisted(revision: current.revision + 1)
      values[entry.id] = saved
      return .saved(saved)
    }
    guard expectedRevision == nil, entry.revision == 0 else {
      throw JournalEntryError.missingExpectedEntry
    }
    let saved = try entry.persisted(revision: 1)
    values[entry.id] = saved
    return .saved(saved)
  }

  public func deleteAll(profileGenerationID: UUID) {
    values = values.filter { $0.value.profileGenerationID != profileGenerationID }
  }
}

public enum JournalEntryError: Error, Equatable, Sendable {
  case emptyEntry
  case invalidAudioAttachment
  case invalidTranscript
  case invalidTranscriptionState
  case invalidRevision
  case invalidLocale
  case tombstoneRetainsPrivateContent
  case identityChanged
  case missingExpectedEntry
}

extension JournalEntry {
  fileprivate static func newestFirst(_ lhs: Self, _ rhs: Self) -> Bool {
    if lhs.modifiedAt != rhs.modifiedAt { return lhs.modifiedAt > rhs.modifiedAt }
    return lhs.id.uuidString < rhs.id.uuidString
  }
}

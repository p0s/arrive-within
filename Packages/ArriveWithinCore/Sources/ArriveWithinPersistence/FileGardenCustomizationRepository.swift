import ArriveWithinDomain
import Foundation

public actor FileGardenCustomizationRepository: GardenCustomizationRepository {
  private struct Record: Codable, Sendable {
    let profileGenerationID: UUID
    var customization: GardenCustomization
  }

  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    var records: [Record]
  }

  private let fileURL: URL
  private let fileManager: FileManager

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
  }

  public func load(profileGenerationID: UUID) throws -> GardenCustomization {
    let envelope = try loadEnvelope()
    guard let customization = envelope.records.first(where: {
      $0.profileGenerationID == profileGenerationID
    })?.customization else { return GardenCustomization() }
    guard Self.isValid(customization) else { throw FilePersistenceError.unreadableLedger }
    return customization
  }

  public func save(_ customization: GardenCustomization, profileGenerationID: UUID) throws {
    guard Self.isValid(customization) else { throw FilePersistenceError.couldNotPersist }
    var envelope = try loadEnvelope()
    if let index = envelope.records.firstIndex(where: {
      $0.profileGenerationID == profileGenerationID
    }) {
      envelope.records[index].customization = customization
    } else {
      envelope.records.append(
        Record(profileGenerationID: profileGenerationID, customization: customization)
      )
    }
    envelope.records.sort { $0.profileGenerationID.uuidString < $1.profileGenerationID.uuidString }
    try persist(envelope)
  }

  public func deleteAll(profileGenerationID: UUID) throws {
    var envelope = try loadEnvelope()
    envelope.records.removeAll { $0.profileGenerationID == profileGenerationID }
    try persist(envelope)
  }

  private func loadEnvelope() throws -> Envelope {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return Envelope(schemaVersion: 1, records: [])
    }
    do {
      let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard envelope.schemaVersion == 1 else {
        throw FilePersistenceError.unsupportedSchema(envelope.schemaVersion)
      }
      return envelope
    } catch let error as FilePersistenceError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  private func persist(_ envelope: Envelope) throws {
    do {
      try fileManager.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(envelope).write(to: fileURL, options: .atomic)
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: fileURL.path
        )
      #endif
    } catch {
      throw FilePersistenceError.couldNotPersist
    }
  }

  private static func isValid(_ customization: GardenCustomization) -> Bool {
    customization.selectedVariantByMilestone.allSatisfy { milestone, variant in
      GardenMilestones.definition(id: milestone)?.variants.contains(where: {
        $0.id == variant
      }) == true
    }
  }
}

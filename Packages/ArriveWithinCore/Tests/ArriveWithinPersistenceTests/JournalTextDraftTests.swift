import Foundation
import Testing
@testable import ArriveWithinPersistence

@Suite("Protected journal text drafts")
struct JournalTextDraftTests {
  @Test("Drafts survive repository recreation and remain isolated by profile generation")
  func roundTripAndGenerationIsolation() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-drafts-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appending(path: "journal-drafts-v1.json")
    let generation = UUID(uuidString: "40000000-0000-4000-8000-000000000021")!
    let entryID = UUID(uuidString: "A1000000-0000-4000-8000-000000000021")!
    let draft = try JournalTextDraft(
      editorKey: "entry:\(entryID.uuidString.lowercased())",
      profileGenerationID: generation,
      linkedPracticeEventID: nil,
      text: "A thought worth keeping.",
      modifiedAt: Date(timeIntervalSince1970: 1_786_320_000)
    )

    try await FileJournalTextDraftRepository(fileURL: file).save(draft)

    let reopened = FileJournalTextDraftRepository(fileURL: file)
    #expect(try await reopened.load(editorKey: draft.editorKey, profileGenerationID: generation) == draft)
    #expect(try await reopened.load(editorKey: draft.editorKey, profileGenerationID: UUID()) == nil)
  }

  @Test("Drafts are bounded, validated, and can be explicitly deleted")
  func validationAndDeletion() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-drafts-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appending(path: "journal-drafts-v1.json")
    let generation = UUID()

    #expect(throws: JournalTextDraftError.invalidDraft) {
      try JournalTextDraft(
        editorKey: "../../outside",
        profileGenerationID: generation,
        linkedPracticeEventID: nil,
        text: "Private"
      )
    }
    #expect(throws: JournalTextDraftError.invalidDraft) {
      try JournalTextDraft(
        editorKey: "new:unlinked",
        profileGenerationID: generation,
        linkedPracticeEventID: nil,
        text: String(repeating: "x", count: JournalTextDraft.maximumTextUTF8Bytes + 1)
      )
    }

    let draft = try JournalTextDraft(
      editorKey: "new:unlinked",
      profileGenerationID: generation,
      linkedPracticeEventID: nil,
      text: "Private"
    )
    let repository = FileJournalTextDraftRepository(fileURL: file)
    try await repository.save(draft)
    try await repository.delete(editorKey: draft.editorKey, profileGenerationID: generation)
    #expect(try await repository.load(editorKey: draft.editorKey, profileGenerationID: generation) == nil)
    try await repository.save(draft)
    try await repository.deleteAll()
    #expect(try await repository.load(editorKey: draft.editorKey, profileGenerationID: generation) == nil)
  }

  @Test("Deleting tombstoned entry drafts preserves other entries and profiles")
  func deletedEntryDrafts() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-drafts-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let repository = FileJournalTextDraftRepository(
      fileURL: directory.appending(path: "journal-drafts-v1.json")
    )
    let generation = UUID()
    let otherGeneration = UUID()
    let deletedID = UUID()
    let retainedID = UUID()
    let deletedKey = "entry:\(deletedID.uuidString.lowercased())"
    let retainedKey = "entry:\(retainedID.uuidString.lowercased())"
    for (key, profile) in [
      (deletedKey, generation),
      (retainedKey, generation),
      (deletedKey, otherGeneration),
    ] {
      try await repository.save(
        JournalTextDraft(
          editorKey: key,
          profileGenerationID: profile,
          linkedPracticeEventID: nil,
          text: "Private reflection"
        )
      )
    }

    try await repository.deleteEntryDrafts(
      entryIDs: [deletedID],
      profileGenerationID: generation
    )

    #expect(try await repository.load(editorKey: deletedKey, profileGenerationID: generation) == nil)
    #expect(try await repository.load(editorKey: retainedKey, profileGenerationID: generation) != nil)
    #expect(try await repository.load(editorKey: deletedKey, profileGenerationID: otherGeneration) != nil)
  }
}

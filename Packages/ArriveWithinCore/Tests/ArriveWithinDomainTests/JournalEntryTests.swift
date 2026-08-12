import ArriveWithinDomain
import Foundation
import Testing

@Suite("Private journal domain contract")
struct JournalEntryTests {
  @Test("Audio metadata cannot escape the protected journal directory")
  func audioPathBoundary() {
    #expect(throws: JournalEntryError.invalidAudioAttachment) {
      try JournalAudioAttachment(
        relativeFileName: "../private.m4a",
        durationMilliseconds: 1_000,
        byteCount: 128,
        checksumSHA256: String(repeating: "0", count: 64),
        recordedAt: Date(timeIntervalSince1970: 1_786_320_000)
      )
    }
    #expect(throws: JournalEntryError.invalidAudioAttachment) {
      try JournalAudioAttachment(
        relativeFileName: "too-long.m4a",
        durationMilliseconds: 600_001,
        byteCount: 128,
        checksumSHA256: String(repeating: "0", count: 64),
        recordedAt: Date(timeIntervalSince1970: 1_786_320_000)
      )
    }
  }

  @Test("Persisted journal payloads rerun domain validation")
  func persistedPayloadValidation() throws {
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    let attachment = try JournalAudioAttachment(
      relativeFileName: "reflection.m4a",
      durationMilliseconds: 1_000,
      byteCount: 128,
      checksumSHA256: String(repeating: "0", count: 64),
      recordedAt: date
    )
    let entry = try JournalEntry(
      id: UUID(),
      profileGenerationID: UUID(),
      createdAt: date,
      sourceInstallationID: UUID(),
      modifiedAt: date,
      text: "Private text",
      audioAttachment: attachment
    )
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    let valid = try encoder.encode(entry)
    let validObject = try #require(
      JSONSerialization.jsonObject(with: valid) as? [String: Any]
    )

    var traversal = validObject
    var badAttachment = try #require(traversal["audioAttachment"] as? [String: Any])
    badAttachment["relativeFileName"] = "../private.m4a"
    traversal["audioAttachment"] = badAttachment
    let traversalData = try JSONSerialization.data(withJSONObject: traversal)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    #expect(throws: JournalEntryError.invalidAudioAttachment) {
      try decoder.decode(JournalEntry.self, from: traversalData)
    }

    var tombstone = validObject
    tombstone["deletedAt"] = date.timeIntervalSince1970 * 1_000
    let tombstoneData = try JSONSerialization.data(withJSONObject: tombstone)
    #expect(throws: JournalEntryError.tombstoneRetainsPrivateContent) {
      try decoder.decode(JournalEntry.self, from: tombstoneData)
    }

    var invalidTranscript = validObject
    invalidTranscript["transcript"] = [
      "text": "Private transcript",
      "localeIdentifier": "en-US",
      "generatedAt": date.timeIntervalSince1970 * 1_000,
      "engineIdentifier": "untrusted-cloud-engine",
    ]
    invalidTranscript["transcriptionState"] = "complete"
    let invalidTranscriptData = try JSONSerialization.data(withJSONObject: invalidTranscript)
    #expect(throws: JournalEntryError.invalidTranscript) {
      try decoder.decode(JournalEntry.self, from: invalidTranscriptData)
    }
  }

  @Test("An active reflection contains text or a real voice attachment")
  func activeEntryCannotBeEmpty() {
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    #expect(throws: JournalEntryError.emptyEntry) {
      try JournalEntry(
        id: UUID(),
        profileGenerationID: UUID(),
        createdAt: date,
        sourceInstallationID: UUID(),
        modifiedAt: date,
        text: "  \n"
      )
    }
  }

  @Test("Private search matches local text, transcript, and locally formatted dates")
  func searchTextTranscriptAndDate() throws {
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    let transcript = try JournalTranscript(
      text: "The birds sounded close.",
      localeIdentifier: "en-US",
      generatedAt: date
    )
    let attachment = try JournalAudioAttachment(
      relativeFileName: "reflection.m4a",
      durationMilliseconds: 1_000,
      byteCount: 128,
      checksumSHA256: String(repeating: "0", count: 64),
      recordedAt: date
    )
    let entry = try JournalEntry(
      id: UUID(),
      profileGenerationID: UUID(),
      createdAt: date,
      sourceInstallationID: UUID(),
      modifiedAt: date,
      text: "A steady breath.",
      textLocaleIdentifier: "en-US",
      audioAttachment: attachment,
      transcript: transcript,
      transcriptionState: .complete
    )
    let locale = Locale(identifier: "en_US")
    let timeZone = TimeZone(secondsFromGMT: 0)!
    let dateFormatter = DateFormatter()
    dateFormatter.locale = locale
    dateFormatter.calendar = Calendar(identifier: .gregorian)
    dateFormatter.timeZone = timeZone
    dateFormatter.dateStyle = .medium

    #expect(JournalSearch.filter([entry], query: "STEADY", locale: locale, timeZone: timeZone) == [entry])
    #expect(JournalSearch.filter([entry], query: "birds", locale: locale, timeZone: timeZone) == [entry])
    #expect(
      JournalSearch.filter(
        [entry],
        query: dateFormatter.string(from: date),
        locale: locale,
        timeZone: timeZone
      ) == [entry]
    )
    #expect(JournalSearch.filter([entry], query: "absent", locale: locale, timeZone: timeZone).isEmpty)
  }
}

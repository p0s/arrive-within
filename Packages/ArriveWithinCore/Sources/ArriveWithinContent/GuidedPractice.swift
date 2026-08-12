import Foundation

public enum GuidedLanguage: String, Codable, CaseIterable, Sendable {
  case english = "en"
  case german = "de"
}

public enum GuidedCategory: String, Codable, CaseIterable, Sendable {
  case foundations
  case calm
  case body
  case focus
  case selfKindness = "self-kindness"
  case emotions
  case morning
  case evening
  case sleep
}

public enum GuidedSafetyContext: String, Codable, Sendable {
  case seatedOrStill
  case safeWalkingOnly
  case bedOrResting
}

public enum GuidedEditorialState: String, Codable, Sendable {
  case draft
  case productionCandidate = "production-candidate"
  case approved

  public var isPackagedForPlayback: Bool {
    self == .productionCandidate || self == .approved
  }
}

public struct GuidedPracticeText: Codable, Equatable, Sendable {
  public let title: String
  public let purpose: String
  public let accessibilitySummary: String
  public let scriptPath: String
  public let transcriptPath: String
  public let audioPath: String
  public let scriptRevision: Int
  public let editorialState: GuidedEditorialState

  public init(
    title: String,
    purpose: String,
    accessibilitySummary: String,
    scriptPath: String,
    transcriptPath: String,
    audioPath: String,
    scriptRevision: Int = 1,
    editorialState: GuidedEditorialState = .draft
  ) {
    self.title = title
    self.purpose = purpose
    self.accessibilitySummary = accessibilitySummary
    self.scriptPath = scriptPath
    self.transcriptPath = transcriptPath
    self.audioPath = audioPath
    self.scriptRevision = scriptRevision
    self.editorialState = editorialState
  }
}

public struct GuidedLocalizedText: Codable, Equatable, Sendable {
  public let en: GuidedPracticeText
  public let de: GuidedPracticeText

  public init(en: GuidedPracticeText, de: GuidedPracticeText) {
    self.en = en
    self.de = de
  }

  public subscript(language: GuidedLanguage) -> GuidedPracticeText {
    switch language {
    case .english: en
    case .german: de
    }
  }
}

public struct GuidedPractice: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let version: Int
  public let category: GuidedCategory
  public let targetMinutes: Int
  public let safetyContext: GuidedSafetyContext
  public let purposeTags: [String]
  public let localized: GuidedLocalizedText

  public init(
    id: String,
    version: Int,
    category: GuidedCategory,
    targetMinutes: Int,
    safetyContext: GuidedSafetyContext,
    purposeTags: [String],
    localized: GuidedLocalizedText
  ) {
    self.id = id
    self.version = version
    self.category = category
    self.targetMinutes = targetMinutes
    self.safetyContext = safetyContext
    self.purposeTags = purposeTags
    self.localized = localized
  }
}

public struct GuidedCatalogDocument: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let catalogVersion: Int
  public let practices: [GuidedPractice]

  public init(schemaVersion: Int, catalogVersion: Int, practices: [GuidedPractice]) {
    self.schemaVersion = schemaVersion
    self.catalogVersion = catalogVersion
    self.practices = practices
  }
}

public enum GuidedCatalogLoader {
  public static func decode(_ data: Data, requireCompleteV1: Bool = true) throws
    -> GuidedCatalogDocument
  {
    let decoder = JSONDecoder()
    let document = try decoder.decode(GuidedCatalogDocument.self, from: data)
    guard document.schemaVersion == 1, document.catalogVersion > 0 else {
      throw GuidedCatalogError.unsupportedDocumentVersion
    }
    try GuidedCatalogValidator.validate(document.practices, requireCompleteV1: requireCompleteV1)
    return document
  }
}

public enum GuidedCatalogValidator {
  public static func validate(_ practices: [GuidedPractice], requireCompleteV1: Bool) throws {
    if requireCompleteV1, practices.count != 42 {
      throw GuidedCatalogError.wrongPracticeCount(practices.count)
    }

    var identifiers = Set<String>()
    for practice in practices {
      guard
        practice.id.range(
          of: #"^G(?:0[1-9]|[1-3][0-9]|4[0-2])$"#,
          options: .regularExpression
        ) != nil
      else {
        throw GuidedCatalogError.invalidIdentifier(practice.id)
      }
      guard identifiers.insert(practice.id).inserted else {
        throw GuidedCatalogError.duplicateIdentifier(practice.id)
      }
      guard practice.version > 0,
        practice.targetMinutes > 0,
        !practice.purposeTags.isEmpty,
        practice.purposeTags.allSatisfy({ !$0.isEmpty })
      else {
        throw GuidedCatalogError.invalidMetadata(practice.id)
      }

      for language in GuidedLanguage.allCases {
        let text = practice.localized[language]
        let languageCode = language.rawValue
        let base = "Content/guided/\(practice.id)/"
        guard !text.title.isEmpty,
          !text.purpose.isEmpty,
          !text.accessibilitySummary.isEmpty,
          text.scriptRevision > 0,
          text.scriptPath == "\(base)script.\(languageCode).md",
          text.transcriptPath == "\(base)transcript.\(languageCode).vtt",
          text.audioPath == "\(base)audio.\(languageCode).m4a"
        else {
          throw GuidedCatalogError.incompleteLanguageParity(practice.id)
        }
      }
    }

    if requireCompleteV1 {
      let expected = Set((1...42).map { String(format: "G%02d", $0) })
      guard identifiers == expected else { throw GuidedCatalogError.incompleteIdentifierSet }
    }
  }
}

public enum GuidedCatalogError: Error, Equatable, Sendable {
  case unsupportedDocumentVersion
  case wrongPracticeCount(Int)
  case invalidIdentifier(String)
  case duplicateIdentifier(String)
  case invalidMetadata(String)
  case incompleteLanguageParity(String)
  case incompleteIdentifierSet
}

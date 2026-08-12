import ArriveWithinContent
import Foundation
import Testing

@Suite("Guided catalogue contract")
struct GuidedCatalogTests {
  @Test("One concept requires complete English and German paths")
  func languageParity() throws {
    try GuidedCatalogValidator.validate([samplePractice()], requireCompleteV1: false)
  }

  @Test("A localized path cannot point at the other language")
  func rejectsMismatchedGermanPath() {
    let valid = samplePractice()
    let invalidGerman = GuidedPracticeText(
      title: valid.localized.de.title,
      purpose: valid.localized.de.purpose,
      accessibilitySummary: valid.localized.de.accessibilitySummary,
      scriptPath: "Content/guided/G01/script.en.md",
      transcriptPath: valid.localized.de.transcriptPath,
      audioPath: valid.localized.de.audioPath
    )
    let invalid = GuidedPractice(
      id: valid.id,
      version: valid.version,
      category: valid.category,
      targetMinutes: valid.targetMinutes,
      safetyContext: valid.safetyContext,
      purposeTags: valid.purposeTags,
      localized: GuidedLocalizedText(en: valid.localized.en, de: invalidGerman)
    )

    #expect(throws: GuidedCatalogError.incompleteLanguageParity("G01")) {
      try GuidedCatalogValidator.validate([invalid], requireCompleteV1: false)
    }
  }

  @Test("The tracked source catalogue has exactly 42 bilingual concepts")
  func trackedCatalogIsComplete() throws {
    let packageRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let projectRoot =
      packageRoot
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let catalogURL = projectRoot.appending(path: "Content/guided/catalog.json")
    let data = try Data(contentsOf: catalogURL)
    let document = try GuidedCatalogLoader.decode(data)

    #expect(document.practices.count == 42)
    #expect(document.practices.first?.id == "G01")
    #expect(document.practices.last?.id == "G42")
  }

  @Test("Production candidates are playable without claiming human approval")
  func productionCandidateBoundary() throws {
    let data = try JSONEncoder().encode(GuidedEditorialState.productionCandidate)
    #expect(String(decoding: data, as: UTF8.self) == #""production-candidate""#)
    #expect(GuidedEditorialState.productionCandidate.isPackagedForPlayback)
    #expect(GuidedEditorialState.approved.isPackagedForPlayback)
    #expect(!GuidedEditorialState.draft.isPackagedForPlayback)
  }

  private func samplePractice() -> GuidedPractice {
    GuidedPractice(
      id: "G01",
      version: 1,
      category: .foundations,
      targetMinutes: 3,
      safetyContext: .seatedOrStill,
      purposeTags: ["grounding", "beginner"],
      localized: GuidedLocalizedText(
        en: GuidedPracticeText(
          title: "Arrive Here",
          purpose: "A first grounding practice",
          accessibilitySummary: "A short practice using breath and contact with the ground.",
          scriptPath: "Content/guided/G01/script.en.md",
          transcriptPath: "Content/guided/G01/transcript.en.vtt",
          audioPath: "Content/guided/G01/audio.en.m4a"
        ),
        de: GuidedPracticeText(
          title: "Hier ankommen",
          purpose: "Eine erste erdende Meditation",
          accessibilitySummary: "Eine kurze Übung mit Atem und Bodenkontakt.",
          scriptPath: "Content/guided/G01/script.de.md",
          transcriptPath: "Content/guided/G01/transcript.de.vtt",
          audioPath: "Content/guided/G01/audio.de.m4a"
        )
      )
    )
  }
}

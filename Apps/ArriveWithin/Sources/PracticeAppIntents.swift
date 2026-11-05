import AppIntents
import ArriveWithinContent
import Foundation

// Siri, Shortcuts, Spotlight, and Action button actions (ADR-0015). Every string
// here is a localization key with English and German values. Results carry only
// mode, state, and planned length; no action finishes a practice or reads
// private data.

enum PracticeKindAppEnum: String, AppEnum {
  case guided
  case timer
  case openEnded

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Practice Mode")
  static let caseDisplayRepresentations: [PracticeKindAppEnum: DisplayRepresentation] = [
    .guided: "Guided",
    .timer: "Timer",
    .openEnded: "Open-ended",
  ]

  init(_ kind: PracticeIntentStatus.Kind) {
    switch kind {
    case .guided: self = .guided
    case .timer: self = .timer
    case .openEnded: self = .openEnded
    }
  }
}

enum PracticeStateAppEnum: String, AppEnum {
  case preparing
  case running
  case paused
  case awaitingRecoveryChoice
  case finishing

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Practice State")
  static let caseDisplayRepresentations: [PracticeStateAppEnum: DisplayRepresentation] = [
    .preparing: "Settling in",
    .running: "In progress",
    .paused: "Paused",
    .awaitingRecoveryChoice: "Waiting for your choice in the app",
    .finishing: "Finishing",
  ]

  init(_ phase: PracticeIntentStatus.Phase) {
    switch phase {
    case .preparing: self = .preparing
    case .running: self = .running
    case .paused: self = .paused
    case .awaitingRecoveryChoice: self = .awaitingRecoveryChoice
    case .finishing: self = .finishing
    }
  }
}

enum GuidedPurposeAppEnum: String, AppEnum {
  case foundations
  case calm
  case body
  case focus
  case selfKindness
  case emotions
  case morning
  case evening
  case sleep

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Purpose")
  static let caseDisplayRepresentations: [GuidedPurposeAppEnum: DisplayRepresentation] = [
    .foundations: "Foundations",
    .calm: "Calm",
    .body: "Body",
    .focus: "Focus",
    .selfKindness: "Self-kindness",
    .emotions: "Emotions",
    .morning: "Morning",
    .evening: "Evening",
    .sleep: "Sleep",
  ]

  init(_ category: GuidedCategory) {
    switch category {
    case .foundations: self = .foundations
    case .calm: self = .calm
    case .body: self = .body
    case .focus: self = .focus
    case .selfKindness: self = .selfKindness
    case .emotions: self = .emotions
    case .morning: self = .morning
    case .evening: self = .evening
    case .sleep: self = .sleep
    }
  }
}

enum NarrationLanguageAppEnum: String, AppEnum {
  case english
  case german

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Narration Language")
  static let caseDisplayRepresentations: [NarrationLanguageAppEnum: DisplayRepresentation] = [
    .english: "English",
    .german: "German",
  ]

  var guidedLanguage: GuidedLanguage {
    switch self {
    case .english: .english
    case .german: .german
    }
  }
}

enum PracticeControlAppEnum: String, AppEnum {
  case pause
  case resume

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Practice Control")
  static let caseDisplayRepresentations: [PracticeControlAppEnum: DisplayRepresentation] = [
    .pause: DisplayRepresentation(
      title: "Pause",
      subtitle: "Pauses the practice in progress. Finishing stays in the app.",
      synonyms: ["Stop"]
    ),
    .resume: DisplayRepresentation(
      title: "Resume",
      subtitle: "Continues the paused practice.",
      synonyms: ["Continue"]
    ),
  ]
}

struct PracticeStatusEntity: TransientAppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Practice Status")

  @Property(title: "Mode")
  var mode: PracticeKindAppEnum

  @Property(title: "State")
  var state: PracticeStateAppEnum

  @Property(title: "Planned Minutes")
  var plannedMinutes: Int?

  init() {
    mode = .openEnded
    state = .running
    plannedMinutes = nil
  }

  init(status: PracticeIntentStatus) {
    self.init()
    mode = PracticeKindAppEnum(status.kind)
    state = PracticeStateAppEnum(status.phase)
    plannedMinutes = status.plannedMinutes
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: mode.localizedStringResource,
      subtitle: state.localizedStringResource
    )
  }
}

/// One bundled guided practice. Title, purpose, and length are public catalog
/// text; favorites, history, and progress are never part of the entity.
struct GuidedPracticeEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Guided Practice")
  static let defaultQuery = GuidedPracticeQuery()

  let id: String
  let titleKey: String

  @Property(title: "Purpose")
  var purpose: GuidedPurposeAppEnum

  @Property(title: "Minutes")
  var minutes: Int

  init(practice: GuidedPractice) {
    id = practice.id
    titleKey = practice.localized.en.title
    purpose = GuidedPurposeAppEnum(practice.category)
    minutes = practice.targetMinutes
  }

  /// The English catalog title is the key; `scripts/validate_localizations.mjs`
  /// checks both languages against the catalog.
  var title: LocalizedStringResource {
    LocalizedStringResource(String.LocalizationValue(titleKey))
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: title,
      subtitle: LocalizedStringResource(
        "Purpose and length",
        defaultValue: "\(purpose) · \(minutes) min"
      )
    )
  }
}

struct GuidedPracticeQuery: EnumerableEntityQuery {
  @Dependency
  private var controller: PracticeIntentController

  @MainActor
  func allEntities() async throws -> [GuidedPracticeEntity] {
    Self.entities(in: controller.guidedPractices)
  }

  @MainActor
  func entities(for identifiers: [GuidedPracticeEntity.ID]) async throws -> [GuidedPracticeEntity] {
    Self.entities(in: controller.guidedPractices, matching: identifiers)
  }

  static func entities(in practices: [GuidedPractice]) -> [GuidedPracticeEntity] {
    practices.map(GuidedPracticeEntity.init(practice:))
  }

  static func entities(
    in practices: [GuidedPractice],
    matching identifiers: [GuidedPracticeEntity.ID]
  ) -> [GuidedPracticeEntity] {
    let practicesByID = Dictionary(practices.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    return identifiers.compactMap { practicesByID[$0] }.map(GuidedPracticeEntity.init(practice:))
  }
}

struct StartSilentPracticeIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Silent Practice"
  static let description = IntentDescription(
    "Starts a silent meditation practice with bells, ambience, and garden growth in Arrive Within. Give a length for a timed practice, or leave it empty for an open-ended practice that you finish in the app.",
    searchKeywords: ["meditation", "mindfulness", "timer"]
  )
  static let openAppWhenRun = true

  @available(iOS 26.0, *)
  static var supportedModes: IntentModes { .foreground }

  @available(iOS 27.0, *)
  static var allowedExecutionTargets: IntentExecutionTargets { .main }

  @Parameter(
    title: "Minutes",
    description: "Length of the practice in minutes, from 1 to 180. Leave empty for an open-ended practice.",
    inclusiveRange: (1, 180)
  )
  var minutes: Int?

  @Dependency
  private var controller: PracticeIntentController

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<PracticeStatusEntity> & ProvidesDialog {
    let outcome = try await controller.startSilentPractice(minutes: minutes)
    return .result(
      value: PracticeStatusEntity(status: outcome.status),
      dialog: PracticeIntentDialog.silentStart(outcome)
    )
  }
}

struct StartGuidedPracticeIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Guided Practice"
  static let description = IntentDescription(
    "Starts one of the guided meditations in Arrive Within, with English or German narration.",
    searchKeywords: ["meditation", "guided meditation", "sleep"]
  )
  static let openAppWhenRun = true

  @available(iOS 26.0, *)
  static var supportedModes: IntentModes { .foreground }

  @available(iOS 27.0, *)
  static var allowedExecutionTargets: IntentExecutionTargets { .main }

  @Parameter(
    title: "Guided Practice",
    description: "The guided meditation to start. Each one has a purpose, such as sleep, focus, or calm, and a length in minutes.",
    requestValueDialog: "Which guided practice would you like to start?"
  )
  var practice: GuidedPracticeEntity

  @Parameter(
    title: "Narration Language",
    description: "English or German narration. Leave empty to use the app language."
  )
  var narrationLanguage: NarrationLanguageAppEnum?

  @Dependency
  private var controller: PracticeIntentController

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<PracticeStatusEntity> & ProvidesDialog {
    let outcome = try await controller.startGuidedPractice(
      practiceID: practice.id,
      language: narrationLanguage?.guidedLanguage
    )
    return .result(
      value: PracticeStatusEntity(status: outcome.status),
      dialog: PracticeIntentDialog.guidedStart(outcome, title: practice.title)
    )
  }
}

struct SetPracticePausedIntent: AppIntent {
  static let title: LocalizedStringResource = "Pause or Resume Practice"
  static let description = IntentDescription(
    "Pauses or resumes the meditation practice in progress in Arrive Within. It never ends the practice; finishing stays in the app.",
    searchKeywords: ["meditation", "mindfulness"]
  )

  @available(iOS 26.0, *)
  static var supportedModes: IntentModes { .background }

  @available(iOS 27.0, *)
  static var allowedExecutionTargets: IntentExecutionTargets { .main }

  @Parameter(
    title: "Action",
    description: "Pause holds the practice in progress. Resume continues a paused practice."
  )
  var action: PracticeControlAppEnum

  @Dependency
  private var controller: PracticeIntentController

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<PracticeStatusEntity> & ProvidesDialog {
    let outcome = try await controller.setPaused(action == .pause)
    return .result(
      value: PracticeStatusEntity(status: outcome.status),
      dialog: PracticeIntentDialog.control(outcome, action: action)
    )
  }
}

/// Replies state only what happened; none claims growth or completion.
enum PracticeIntentDialog {
  static func silentStart(_ outcome: PracticeIntentStartOutcome) -> IntentDialog {
    guard case .started(let status) = outcome else { return alreadyInProgress(outcome.status) }
    let preparing = status.phase == .preparing
    guard let minutes = status.plannedMinutes else {
      return preparing
        ? "Settle in. Your open-ended meditation begins in a moment. Finish it in Arrive Within when you are ready."
        : "Your open-ended meditation has started. Finish it in Arrive Within when you are ready."
    }
    switch (preparing, status.isBelowGrowthMinimum) {
    case (false, false):
      return "Your \(minutes)-minute meditation has started."
    case (true, false):
      return "Settle in. Your \(minutes)-minute meditation begins in a moment."
    case (false, true):
      return "Your \(minutes)-minute meditation has started. Practices under 3 minutes are saved but do not grow the garden."
    case (true, true):
      return "Settle in. Your \(minutes)-minute meditation begins in a moment. Practices under 3 minutes are saved but do not grow the garden."
    }
  }

  static func guidedStart(
    _ outcome: PracticeIntentStartOutcome,
    title: LocalizedStringResource
  ) -> IntentDialog {
    guard case .started = outcome else { return alreadyInProgress(outcome.status) }
    return "\(title) has started."
  }

  static func control(
    _ outcome: PracticeIntentControlOutcome,
    action: PracticeControlAppEnum
  ) -> IntentDialog {
    switch (outcome, action) {
    case (.changed, .pause): "Your practice is paused."
    case (.changed, .resume): "Your practice continues."
    case (.unchanged, .pause): "Your practice is already paused."
    case (.unchanged, .resume): "Your practice is already in progress."
    }
  }

  static func alreadyInProgress(_ status: PracticeIntentStatus) -> IntentDialog {
    switch status.phase {
    case .preparing: "A practice is already settling in, so nothing new started."
    case .running: "A practice is already in progress, so nothing new started."
    case .paused: "A paused practice is waiting in Arrive Within, so nothing new started. You can resume it."
    case .awaitingRecoveryChoice:
      "An interrupted practice needs your choice in Arrive Within before a new one can start."
    case .finishing: "A practice is finishing, so nothing new started."
    }
  }
}

extension PracticeIntentFailure: CustomLocalizedStringResourceConvertible {
  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .invalidDuration:
      "Choose a length from 1 to 180 minutes, or leave it empty for an open-ended practice."
    case .unknownPractice:
      "That guided practice is not in Arrive Within. Choose one from the list."
    case .narrationUnavailable:
      "This guided practice is not available offline in this build. Choose another practice or start a silent practice."
    case .catalogUnavailable:
      "The guided practices are unavailable right now. Start a silent practice instead."
    case .stillOpening:
      "Arrive Within is still opening. Try again in a moment."
    case .dataUnavailable:
      "Arrive Within could not open your practice data. Open the app to try again."
    case .busy:
      "Arrive Within is finishing a data task. Try again when it is done."
    case .couldNotStart:
      "The practice could not start. Your progress has not changed. Try again in Arrive Within."
    case .noLivePractice:
      "No practice is in progress."
    case .recoveryChoicePending:
      "An interrupted practice needs your choice in Arrive Within first."
    case .stillPreparing:
      "Your practice is still settling in. You can pause it once it begins."
    case .narrationCannotResume:
      "The guided narration cannot continue right now. Open Arrive Within to continue."
    case .couldNotChange:
      "The practice could not be changed. Open Arrive Within to continue."
    }
  }
}

struct ArriveWithinShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartSilentPracticeIntent(),
      phrases: [
        "Begin a silent practice in \(.applicationName)",
        "Start a silent meditation in \(.applicationName)",
        "Start an open-ended meditation in \(.applicationName)",
      ],
      shortTitle: "Silent Practice",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: StartGuidedPracticeIntent(),
      phrases: [
        "Start \(\.$practice) in \(.applicationName)",
        "Play \(\.$practice) in \(.applicationName)",
        "Start a guided practice in \(.applicationName)",
      ],
      shortTitle: "Guided Practice",
      systemImageName: "headphones"
    )
    AppShortcut(
      intent: SetPracticePausedIntent(),
      phrases: [
        "\(\.$action) my meditation in \(.applicationName)",
        "\(\.$action) my practice in \(.applicationName)",
      ],
      shortTitle: "Pause or Resume",
      systemImageName: "pause.circle"
    )
  }
}

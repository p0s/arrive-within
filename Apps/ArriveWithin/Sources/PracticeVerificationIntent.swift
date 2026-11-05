#if DEBUG
  import AppIntents

  /// DEBUG-only readback for the AppIntentsTesting system tests (ADR-0015). It is
  /// hidden from Shortcuts, changes nothing, and is not compiled into Release.
  struct InspectPracticeForVerificationIntent: AppIntent {
    static let title: LocalizedStringResource = "Inspect Practice for Verification"
    static let isDiscoverable = false

    @Dependency
    private var controller: PracticeIntentController

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<PracticeVerificationEntity> {
      let snapshot = await controller.verificationSnapshot()
      return .result(value: PracticeVerificationEntity(snapshot: snapshot))
    }
  }

  struct PracticeVerificationEntity: TransientAppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Practice Verification")

    @Property(title: "Session Identifier")
    var sessionIdentifier: String

    @Property(title: "Phase")
    var phase: String

    @Property(title: "Active Milliseconds")
    var activeMilliseconds: Int

    @Property(title: "Target Milliseconds")
    var targetMilliseconds: Int

    @Property(title: "Guided Content Identifier")
    var guidedContentIdentifier: String

    @Property(title: "Guided Content Version")
    var guidedContentVersion: Int

    @Property(title: "Practice Event Count")
    var practiceEventCount: Int

    init() {
      sessionIdentifier = ""
      phase = "none"
      activeMilliseconds = 0
      targetMilliseconds = -1
      guidedContentIdentifier = ""
      guidedContentVersion = 0
      practiceEventCount = 0
    }

    init(snapshot: PracticeVerificationSnapshot) {
      self.init()
      sessionIdentifier = snapshot.sessionID?.uuidString ?? ""
      phase = snapshot.phase?.rawValue ?? "none"
      activeMilliseconds = Int(snapshot.activeMilliseconds)
      targetMilliseconds = snapshot.targetMilliseconds.map { Int($0) } ?? -1
      guidedContentIdentifier = snapshot.guidedContentID ?? ""
      guidedContentVersion = snapshot.guidedContentVersion ?? 0
      practiceEventCount = snapshot.practiceEventCount
    }

    var displayRepresentation: DisplayRepresentation {
      DisplayRepresentation(title: "\(phase)")
    }
  }
#endif

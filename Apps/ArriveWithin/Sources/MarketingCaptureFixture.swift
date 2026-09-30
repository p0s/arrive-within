import Foundation
import ArriveWithinDomain

enum UITestMarketingCaptureID: String, CaseIterable, Sendable {
  case gardenSeed = "garden-seed"
  case gardenHero = "garden-hero"
  case gardenDay = "garden-day"
  case journeyCalendar = "journey-calendar"
  case journeyMilestones = "journey-milestones"
  case journal = "journal"

  var section: AppSection {
    switch self {
    case .gardenSeed, .gardenHero, .gardenDay:
      .garden
    case .journeyCalendar, .journeyMilestones:
      .journey
    case .journal:
      .journal
    }
  }

  var readySurface: String {
    switch self {
    case .gardenSeed, .gardenHero, .gardenDay:
      "garden"
    case .journeyCalendar:
      "journey"
    case .journeyMilestones:
      "journey-milestones"
    case .journal:
      "journal-editor"
    }
  }

  var requiresRenderer: Bool {
    section == .garden
  }

  var expectedAppearance: String {
    switch self {
    case .gardenSeed, .gardenHero:
      "dark"
    case .gardenDay, .journeyCalendar, .journeyMilestones, .journal:
      "light"
    }
  }

  var journeyDay: Int? {
    self == .gardenSeed ? nil : 30
  }

  var requiresDuskOrNight: Bool {
    self == .gardenSeed || self == .gardenHero
  }
}

struct UITestMarketingCaptureFixture: Equatable, Sendable {
  enum FixtureError: Error {
    case invalidArguments
  }

  let captureID: UITestMarketingCaptureID
  let localeID: String
  let languageCode: String
  let appearance: String
  let namespace: UUID

  static func parse(arguments: [String]) throws -> Self? {
    let captureIndexes = arguments.indices.filter { arguments[$0] == "-ui-test-marketing-capture" }
    guard !captureIndexes.isEmpty else { return nil }
    guard captureIndexes.count == 1,
      let captureIndex = captureIndexes.first,
      arguments.indices.contains(captureIndex + 1),
      let captureID = UITestMarketingCaptureID(rawValue: arguments[captureIndex + 1])
    else {
      throw FixtureError.invalidArguments
    }

    func value(after flag: String) -> String? {
      guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
        return nil
      }
      return arguments[index + 1]
    }

    guard let languageCode = value(after: "-ui-test-language"),
      ["en", "de"].contains(languageCode),
      let namespaceValue = value(after: "-ui-test-namespace"),
      let namespace = UUID(uuidString: namespaceValue),
      arguments.filter({ $0 == "-ui-test-namespace" }).count == 1,
      arguments.contains("-ui-test-reset"),
      arguments.contains("-ui-test-reduce-motion"),
      arguments.contains("-ui-test-disable-autocorrection"),
      !arguments.contains("-ui-test-wall-clock-epoch"),
      !arguments.contains("-ui-test-time-scale"),
      !arguments.contains("-ui-test-status-bar-time"),
      !arguments.contains("-ui-test-status-bar-override"),
      !arguments.contains("-ui-test-time-zone")
    else {
      throw FixtureError.invalidArguments
    }

    let requestsLight = arguments.contains("-ui-test-light-appearance")
    let requestsDark = arguments.contains("-ui-test-dark-appearance")
    guard requestsLight != requestsDark else { throw FixtureError.invalidArguments }
    let appearance = requestsLight ? "light" : "dark"
    guard appearance == captureID.expectedAppearance else { throw FixtureError.invalidArguments }

    let journeyDayIndexes = arguments.indices.filter { arguments[$0] == "-ui-test-journey-day" }
    if let journeyDay = captureID.journeyDay {
      guard journeyDayIndexes.count == 1,
        value(after: "-ui-test-journey-day") == String(journeyDay)
      else {
        throw FixtureError.invalidArguments
      }
    } else if !journeyDayIndexes.isEmpty {
      throw FixtureError.invalidArguments
    }

    let seed = value(after: "-ui-test-seed")
    guard let seedValue = seed.flatMap(UInt64.init),
      seedValue <= GardenSeedContract.maximumExactCrossRuntimeValue
    else {
      throw FixtureError.invalidArguments
    }

    return Self(
      captureID: captureID,
      localeID: languageCode == "de" ? "de-DE" : "en-US",
      languageCode: languageCode,
      appearance: appearance,
      namespace: namespace
    )
  }

  var syntheticJournalText: String {
    languageCode == "de"
      ? "Der Atem wurde ruhiger. Ich bemerkte, wie der Raum um mich stiller wurde."
      : "Breathing felt steady. I noticed the room becoming quieter around me."
  }
}

struct PhysicalMarketingCaptureReport: Encodable, Sendable {
  let schemaVersion: Int
  let captureID: String
  let locale: String
  let appearance: String
  let namespace: String
  let readySurface: String
  let rendererReady: Bool
  let journalEditorPrefilled: Bool
  let bundleIdentifier: String
  let marketingVersion: String
  let buildNumber: String
  let sourceCommit: String
  let sourceManifestRevision: String
  let startedAt: String
  let captureLocalDate: String
  let visibleStatusTime: String
  let timezone: String
  let gardenPhase: String

  init(
    fixture: UITestMarketingCaptureFixture,
    actualAppearance: String,
    surface: String,
    rendererReady: Bool,
    journalEditorPrefilled: Bool,
    sourceManifestRevision: String,
    now: Date = Date(),
    bundle: Bundle = .main,
    timezone: TimeZone = .current
  ) {
    let info = bundle.infoDictionary ?? [:]
    schemaVersion = 1
    captureID = fixture.captureID.rawValue
    locale = fixture.localeID
    appearance = actualAppearance
    namespace = fixture.namespace.uuidString.lowercased()
    readySurface = surface
    self.rendererReady = rendererReady
    self.journalEditorPrefilled = journalEditorPrefilled
    bundleIdentifier = bundle.bundleIdentifier ?? ""
    marketingVersion = info["CFBundleShortVersionString"] as? String ?? ""
    buildNumber = info["CFBundleVersion"] as? String ?? ""
    sourceCommit = info["V2N_BUILD_SOURCE_COMMIT"] as? String ?? ""
    self.sourceManifestRevision = sourceManifestRevision

    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    startedAt = iso.string(from: now)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timezone
    let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: now)
    captureLocalDate = String(
      format: "%04d-%02d-%02d",
      components.year ?? 0,
      components.month ?? 0,
      components.day ?? 0
    )
    visibleStatusTime = String(
      format: "%02d:%02d",
      components.hour ?? 0,
      components.minute ?? 0
    )
    self.timezone = timezone.identifier
    let hour = components.hour ?? 0
    if hour < 5 {
      gardenPhase = "night"
    } else if hour < 8 {
      gardenPhase = "dawn"
    } else if hour < 17 {
      gardenPhase = "day"
    } else if hour < 20 {
      gardenPhase = "dusk"
    } else {
      gardenPhase = "night"
    }
  }

  static func phase(at hour: Int) -> String {
    if hour < 5 { return "night" }
    if hour < 8 { return "dawn" }
    if hour < 17 { return "day" }
    if hour < 20 { return "dusk" }
    return "night"
  }
}

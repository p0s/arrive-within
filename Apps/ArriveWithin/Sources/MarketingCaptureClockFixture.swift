#if DEBUG
import Foundation

/// A simulator-only presentation clock. Production and physical release tests use their own clocks.
struct MarketingCaptureClockFixture: Decodable, Equatable, Sendable {
  let id: String
  let epoch: TimeInterval
  let instant: String
  let timezone: String
  let localDate: String
  let localTime: String
  let gardenPhase: String

  var date: Date { Date(timeIntervalSince1970: epoch) }
  var timeZone: TimeZone { TimeZone(identifier: timezone)! }

  enum CodingKeys: String, CodingKey {
    case id, epoch, instant, timezone
    case localDate = "local_date"
    case localTime = "local_time"
    case gardenPhase = "garden_phase"
  }

  enum FixtureError: Error { case invalidDefinition, invalidArguments }

  private struct Definition: Decodable {
    let schemaVersion: Int
    let fixtures: [MarketingCaptureClockFixture]
    enum CodingKeys: String, CodingKey {
      case fixtures
      case schemaVersion = "schema_version"
    }
  }

  static func load(id: String, bundle: Bundle = .main) throws -> Self {
    guard let url = bundle.url(forResource: "MarketingCaptureClockFixtures", withExtension: "json") else {
      throw FixtureError.invalidDefinition
    }
    let definition = try JSONDecoder().decode(Definition.self, from: Data(contentsOf: url))
    guard definition.schemaVersion == 1,
      Set(definition.fixtures.map(\.id)) == Set(["day-v1", "dusk-v1"]),
      definition.fixtures.count == 2,
      let fixture = definition.fixtures.first(where: { $0.id == id }),
      fixture.epoch.isFinite, fixture.timezone == "Asia/Singapore",
      ISO8601DateFormatter().date(from: fixture.instant) == fixture.date
    else { throw FixtureError.invalidDefinition }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = fixture.timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    guard formatter.string(from: fixture.date) == "\(fixture.localDate) \(fixture.localTime)",
      (id == "day-v1" && fixture.localTime == "09:41" && fixture.gardenPhase == "day")
        || (id == "dusk-v1" && fixture.localTime == "17:41" && fixture.gardenPhase == "dusk")
    else { throw FixtureError.invalidDefinition }
    return fixture
  }

  static func parse(arguments: [String]) throws -> Self? {
    let indexes = arguments.indices.filter { arguments[$0] == "-ui-test-marketing-clock" }
    guard !indexes.isEmpty else { return nil }
    #if targetEnvironment(simulator)
    guard indexes.count == 1, let index = indexes.first, arguments.indices.contains(index + 1),
      arguments.contains("-ui-test-reset"), arguments.contains("-ui-test-capture-provenance"),
      !arguments.contains("-ui-test-marketing-capture"),
      !arguments.contains("-ui-test-wall-clock-epoch"), !arguments.contains("-ui-test-time-scale"),
      !arguments.contains("-ui-test-time-zone"), !arguments.contains("-ui-test-status-bar-time"),
      !arguments.contains("-ui-test-status-bar-override")
    else { throw FixtureError.invalidArguments }
    return try load(id: arguments[index + 1])
    #else
    throw FixtureError.invalidArguments
    #endif
  }
}
#endif

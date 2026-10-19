#if DEBUG
import ArriveWithinDomain
import XCTest
@testable import ArriveWithin

final class MarketingCaptureClockFixtureTests: XCTestCase {
  func testNamedClockFixturesDriveNativeGardenPhase() throws {
    for (id, phase) in [("day-v1", GardenDayPhase.day), ("dusk-v1", .dusk)] {
      let fixture = try MarketingCaptureClockFixture.load(id: id)
      XCTAssertEqual(GardenDayPhase.presentation(at: fixture.date, timeZone: fixture.timeZone), phase)
      XCTAssertEqual(fixture.gardenPhase, phase.rawValue)
      XCTAssertEqual(fixture.localDate, "2026-08-01")
    }
  }

  func testUnknownFixtureFailsClosed() {
    XCTAssertThrowsError(try MarketingCaptureClockFixture.load(id: "night-v1"))
  }

  func testOrdinaryLaunchHasNoMarketingClock() throws {
    XCTAssertNil(try MarketingCaptureClockFixture.parse(arguments: ["ArriveWithin", "-ui-test-reset"]))
  }

  func testMalformedAndConflictingCaptureArgumentsFailClosed() {
    let valid = ["-ui-test-reset", "-ui-test-capture-provenance", "-ui-test-marketing-clock", "day-v1"]
    for arguments in [
      ["-ui-test-marketing-clock", "day-v1"],
      Array(valid.dropLast()),
      valid + ["-ui-test-marketing-clock", "day-v1"],
      valid + ["-ui-test-wall-clock-epoch", "0"],
      valid + ["-ui-test-time-scale", "2"],
      valid + ["-ui-test-time-zone", "UTC"],
      valid + ["-ui-test-marketing-capture", "garden-day"],
    ] {
      XCTAssertThrowsError(try MarketingCaptureClockFixture.parse(arguments: arguments))
    }
  }
}
#endif

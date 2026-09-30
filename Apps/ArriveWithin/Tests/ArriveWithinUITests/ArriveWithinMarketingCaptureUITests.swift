#if DEBUG
import Foundation
import XCTest

@MainActor
final class ArriveWithinMarketingCaptureUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testCaptureAllRequiredMarketingStatesEnglish() throws {
    try captureMarketingStates(
      locale: "en-US",
      language: "en",
      journalText: "Breathing felt steady. I noticed the room becoming quieter around me."
    )
  }

  func testCaptureAllRequiredMarketingStatesGerman() throws {
    try captureMarketingStates(
      locale: "de-DE",
      language: "de",
      journalText: "Der Atem wurde ruhiger. Ich bemerkte, wie der Raum um mich stiller wurde."
    )
  }

  func testCaptureGardenDayEnglish() throws {
    try captureGardenDay(locale: "en-US", language: "en")
  }

  func testCaptureGardenDayGerman() throws {
    try captureGardenDay(locale: "de-DE", language: "de")
  }

  private func captureGardenDay(locale: String, language: String) throws {
    XCUIDevice.shared.orientation = .portrait
    let app = launchApp(language: language, journeyDay: 30, appearance: "light", clockFixtureID: "day-v1")
    enterGarden(app)
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    try attach("marketing-\(locale)-garden-day", app: app)
    app.terminate()
  }

  private func captureMarketingStates(
    locale: String,
    language: String,
    journalText: String
  ) throws {
    XCUIDevice.shared.orientation = .portrait
    let seedApp = launchApp(language: language, appearance: "dark")
    enterGarden(seedApp)
    XCTAssertTrue(seedApp.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    try attach("marketing-\(locale)-garden-seed", app: seedApp)
    seedApp.terminate()

    let duskGardenApp = launchApp(language: language, journeyDay: 30, appearance: "dark")
    enterGarden(duskGardenApp)
    XCTAssertTrue(duskGardenApp.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    try attach("marketing-\(locale)-garden-hero", app: duskGardenApp)
    duskGardenApp.terminate()

    let app = launchApp(language: language, journeyDay: 30, appearance: "light")
    enterGarden(app)

    selectSection("journey", app: app)
    let calendar = app.descendants(matching: .any)["journey.calendar"]
    reveal(calendar, in: app)
    XCTAssertTrue(calendar.waitForExistence(timeout: 6))
    try attach("marketing-\(locale)-journey-calendar", app: app)

    let finalMilestone = app.descendants(matching: .any)["journey.milestone.15"]
    reveal(finalMilestone, in: app)
    XCTAssertTrue(finalMilestone.waitForExistence(timeout: 6))
    try attach("marketing-\(locale)-journey-milestones", app: app)

    app.terminate()

    let journalApp = launchApp(
      language: language,
      appearance: "light",
      extraArguments: ["-ui-test-journal-recorder-synthetic"]
    )
    enterGarden(journalApp)
    selectSection("journal", app: journalApp)
    let create = journalApp.buttons["journal.empty.new"]
    XCTAssertTrue(create.waitForExistence(timeout: 6))
    create.tap()
    let editor = journalApp.textViews["journal.editor.text"]
    XCTAssertTrue(editor.waitForExistence(timeout: 6))
    editor.typeText(journalText)
    let keyboardDone = journalApp.buttons["journal.editor.keyboard.done"]
    XCTAssertTrue(keyboardDone.waitForExistence(timeout: 5))
    keyboardDone.tap()
    try attach("marketing-\(locale)-journal", app: journalApp)
    journalApp.terminate()
  }

  private func launchApp(
    language: String,
    journeyDay: Int? = nil,
    appearance: String,
    clockFixtureID: String = "dusk-v1",
    extraArguments: [String] = []
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-language", language,
      "-ui-test-reduce-motion",
      "-ui-test-disable-autocorrection",
      "-ui-test-capture-provenance",
      "-ui-test-marketing-clock", clockFixtureID,
      "-ui-test-\(appearance)-appearance",
    ]
    app.launchArguments.append(contentsOf: extraArguments)
    if let journeyDay {
      app.launchArguments.append(contentsOf: ["-ui-test-journey-day", String(journeyDay)])
    }
    app.launch()
    return app
  }

  private func enterGarden(_ app: XCUIApplication) {
    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 8))
  }

  private func selectSection(_ section: String, app: XCUIApplication) {
    let tab = app.tabBars.buttons["navigation.tab.\(section)"]
    if tab.waitForExistence(timeout: 2) {
      tab.tap()
      return
    }
    let sidebar = app.staticTexts["navigation.sidebar.\(section)"]
    XCTAssertTrue(sidebar.waitForExistence(timeout: 5), "Missing navigation destination \(section)")
    sidebar.tap()
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<7 {
      if element.exists && element.isHittable { return }
      let scrollContainer = [
        app.collectionViews.firstMatch,
        app.tables.firstMatch,
        app.scrollViews.firstMatch,
      ].first(where: \.exists)
      (scrollContainer ?? app).swipeUp()
    }
  }

  private func attach(_ name: String, app: XCUIApplication) throws {
    let locale = name.contains("marketing-de-DE-") ? "de-DE" : "en-US"
    let captureID = String(name.dropFirst("marketing-\(locale)-".count))
    let expectedAppearance = ["garden-seed", "garden-hero"].contains(captureID) ? "dark" : "light"
    let provenance = app.descendants(matching: .any)["marketing.capture.provenance"]
    let hasCaptureProvenance = provenance.waitForExistence(timeout: 3)
    guard hasCaptureProvenance else {
      throw NSError(
        domain: "ArriveWithinMarketingCapture",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "App is missing build-bound capture provenance"]
      )
    }
    var fields: [String: String] = [:]
    for component in provenance.label.split(separator: ";") {
      let parts = component.split(separator: "=", maxSplits: 1)
      guard parts.count == 2 else {
        throw NSError(
          domain: "ArriveWithinMarketingCapture",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "App capture provenance contains a malformed field"]
        )
      }
      let key = String(parts[0])
      guard fields[key] == nil else {
        throw NSError(
          domain: "ArriveWithinMarketingCapture",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "App capture provenance contains a duplicate field"]
        )
      }
      fields[key] = String(parts[1])
    }
    XCTAssertEqual(fields["bundle_id"], "com.philipps.arrivewithin.ios")
    XCTAssertEqual(fields["marketing_version"], "1.0.2")
    XCTAssertEqual(fields["build_number"], "19")
    XCTAssertEqual(fields["appearance"], expectedAppearance, "Captured app color scheme must match the selected screenshot state")
    XCTAssertTrue(fields["source_commit"].map { $0.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil } ?? false)
    XCTAssertTrue(fields["source_revision"].map { $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil } ?? false)
    let fixture = try MarketingCaptureClockFixture.load(
      id: captureID == "garden-day" ? "day-v1" : "dusk-v1",
      bundle: Bundle(for: Self.self)
    )
    XCTAssertEqual(fields["clock_fixture_id"], fixture.id)
    XCTAssertEqual(fields["clock_epoch"], String(Int64(fixture.epoch)))
    XCTAssertEqual(fields["timezone"], fixture.timezone)
    XCTAssertEqual(fields["garden_phase"], fixture.gardenPhase, "The rendered Garden phase must come from the injected native clock")
    let capturedAt = Date()
    let timestampFormatter = ISO8601DateFormatter()
    timestampFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)

    let proof: [String: String] = [
      "schema": "arrive-within-capture-build-proof/v2",
      "capture_id": captureID,
      "locale": locale,
      "bundle_id": fields["bundle_id"] ?? "",
      "marketing_version": fields["marketing_version"] ?? "",
      "build_number": fields["build_number"] ?? "",
      "appearance": fields["appearance"] ?? "",
      "source_commit": fields["source_commit"] ?? "",
      "source_revision": fields["source_revision"] ?? "",
      "clock_fixture_id": fields["clock_fixture_id"] ?? "",
      "clock_epoch": fields["clock_epoch"] ?? "",
      "timezone": fields["timezone"] ?? "",
      "garden_phase": fields["garden_phase"] ?? "",
      "captured_at": timestampFormatter.string(from: capturedAt),
      "system_timezone": TimeZone.current.identifier,
    ]
    let proofData = try JSONSerialization.data(withJSONObject: proof, options: [.sortedKeys])
    let proofAttachment = XCTAttachment(data: proofData, uniformTypeIdentifier: "public.json")
    proofAttachment.name = "capture-source-proof-\(locale)-\(captureID)"
    proofAttachment.lifetime = .keepAlways
    add(proofAttachment)
  }
}
#endif

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
    assertSingaporeCaptureWindow(isDay: true)

    let app = launchApp(language: language, journeyDay: 30, appearance: "light")
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
    assertSingaporeCaptureWindow(isDay: false)
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

  private func assertSingaporeCaptureWindow(isDay: Bool) {
    let timeZone = TimeZone.current
    XCTAssertEqual(timeZone.identifier, "Asia/Singapore", "Marketing captures must use the real Singapore local clock")
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let localHour = calendar.component(.hour, from: Date())
    if isDay {
      XCTAssertTrue((8..<17).contains(localHour), "Garden-day captures require 08:00–16:59 SGT")
    } else {
      XCTAssertTrue(localHour >= 17 || localHour < 5, "Dark Garden captures require 17:00–04:59 SGT")
    }
  }

  private func launchApp(
    language: String,
    journeyDay: Int? = nil,
    appearance: String,
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
    let provenance = app.staticTexts["marketing.capture.provenance"]
    let hasCaptureProvenance = provenance.waitForExistence(timeout: 3)
    guard hasCaptureProvenance else {
      throw NSError(
        domain: "ArriveWithinMarketingCapture",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "App is missing build-bound capture provenance"]
      )
    }
    let fields = Dictionary(uniqueKeysWithValues: provenance.label.split(separator: ";").compactMap { component in
      let parts = component.split(separator: "=", maxSplits: 1).map(String.init)
      guard parts.count == 2 else { return nil }
      return (parts[0], parts[1])
    })
    XCTAssertEqual(fields["bundle_id"], "com.philipps.arrivewithin.ios")
    XCTAssertEqual(fields["marketing_version"], "1.0.2")
    XCTAssertEqual(fields["build_number"], "19")
    XCTAssertEqual(fields["appearance"], expectedAppearance, "Captured app color scheme must match the selected screenshot state")
    XCTAssertTrue(fields["source_commit"].map { $0.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil } ?? false)
    XCTAssertTrue(fields["source_revision"].map { $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil } ?? false)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)

    let proof: [String: String] = [
      "schema": "arrive-within-capture-build-proof/v1",
      "capture_id": captureID,
      "locale": locale,
      "bundle_id": fields["bundle_id"] ?? "",
      "marketing_version": fields["marketing_version"] ?? "",
      "build_number": fields["build_number"] ?? "",
      "appearance": fields["appearance"] ?? "",
      "source_commit": fields["source_commit"] ?? "",
      "source_revision": fields["source_revision"] ?? "",
    ]
    let proofData = try JSONSerialization.data(withJSONObject: proof, options: [.sortedKeys])
    let proofAttachment = XCTAttachment(data: proofData, uniformTypeIdentifier: "public.json")
    proofAttachment.name = "capture-source-proof-\(locale)-\(captureID)"
    proofAttachment.lifetime = .keepAlways
    add(proofAttachment)
  }
}

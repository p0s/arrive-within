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

  private func captureMarketingStates(
    locale: String,
    language: String,
    journalText: String
  ) throws {
    XCUIDevice.shared.orientation = .portrait

    let seedApp = launchApp(language: language)
    enterGarden(seedApp)
    XCTAssertTrue(seedApp.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    attach("marketing-\(locale)-garden-seed", app: seedApp)
    seedApp.terminate()

    let app = launchApp(language: language, journeyDay: 30)
    enterGarden(app)
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    attach("marketing-\(locale)-garden-hero", app: app)

    selectSection("journey", app: app)
    let calendar = app.descendants(matching: .any)["journey.calendar"]
    reveal(calendar, in: app)
    XCTAssertTrue(calendar.waitForExistence(timeout: 6))
    attach("marketing-\(locale)-journey-calendar", app: app)

    let finalMilestone = app.descendants(matching: .any)["journey.milestone.15"]
    reveal(finalMilestone, in: app)
    XCTAssertTrue(finalMilestone.waitForExistence(timeout: 6))
    attach("marketing-\(locale)-journey-milestones", app: app)

    app.terminate()

    let journalApp = launchApp(
      language: language,
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
    attach("marketing-\(locale)-journal", app: journalApp)
    journalApp.terminate()
  }

  private func launchApp(
    language: String,
    journeyDay: Int? = nil,
    extraArguments: [String] = []
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-language", language,
      "-ui-test-reduce-motion",
      "-ui-test-disable-autocorrection",
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

  private func attach(_ name: String, app: XCUIApplication) {
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}

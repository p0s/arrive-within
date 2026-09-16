import XCTest

@MainActor
final class ArriveWithinVerificationUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testIsolatedPracticePersistsAndNativeFallbackRemainsOperable() throws {
    let app = XCUIApplication()
    let isolated = namespaceArguments()
    app.launchArguments = isolated + ["-ui-test-seed", "424242", "-ui-test-time-scale", "15"]
    app.launch()
    defer { app.terminate() }

    XCTAssertTrue(app.buttons["onboarding.begin"].waitForExistence(timeout: 8))
    app.buttons["onboarding.begin"].tap()
    XCTAssertTrue(app.staticTexts["session.timer"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["session.completed"].waitForExistence(timeout: 25))
    app.buttons["session.return.garden"].tap()
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
    assertGrowth(app)
    attach(app, name: "Isolated first practice — garden growth")

    app.terminate()
    app.launchArguments = isolated
    app.launch()
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
    assertGrowth(app)
    XCTAssertFalse(app.buttons["onboarding.begin"].exists)

    app.terminate()
    app.launchArguments = isolated + ["-ui-test-native-garden"]
    app.launch()
    XCTAssertTrue(app.buttons["garden.renderer.retry"].waitForExistence(timeout: 8))
    assertGrowth(app)
    XCTAssertFalse(app.buttons["onboarding.begin"].exists)
    attach(app, name: "Isolated persisted practice — native garden fallback")
  }

  func testIsolatedReminderDenialRetainsScheduleAndAuthorizationRecovers() throws {
    let app = XCUIApplication()
    let isolated = namespaceArguments()
    app.launchArguments = isolated + ["-ui-test-reminders-denied"]
    app.launch()
    defer { app.terminate() }
    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    openReminders(app)
    app.buttons["reminders.add.action"].tap()
    XCTAssertTrue(app.navigationBars["New reminder"].waitForExistence(timeout: 5))
    app.buttons["reminders.save.action"].tap()
    // Previously denied permission uses persistent recovery UI; no new request is made.
    XCTAssertTrue(app.buttons["reminders.permission.openSettings"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["reminders.permission.openSettings"].isHittable)
    XCTAssertEqual(app.alerts.count, 0)
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "Notifications are off")
    let rows = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "reminders.edit."))
    XCTAssertEqual(rows.count, 1)
    let savedIdentifier = rows.firstMatch.identifier
    attach(app, name: "Isolated reminder — denial preserves schedule")

    app.terminate()
    app.launchArguments = isolated + ["-ui-test-reminders-authorized"]
    app.launch()
    openReminders(app)
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "Weekly reminders are scheduled")
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows.firstMatch.identifier, savedIdentifier)
    attach(app, name: "Isolated reminder — authorization recovery")
  }

  private func namespaceArguments() -> [String] {
    ["-ui-test-namespace", UUID().uuidString, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
  }

  private func assertGrowth(_ app: XCUIApplication) {
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
  }

  private func openReminders(_ app: XCUIApplication) {
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 8))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["settings.reminders"].waitForExistence(timeout: 5))
    app.buttons["settings.reminders"].tap()
    XCTAssertTrue(app.staticTexts["reminders.status"].waitForExistence(timeout: 5))
  }

  private func attach(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

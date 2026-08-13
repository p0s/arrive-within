import XCTest

@MainActor
final class ArriveWithinUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testThreeMinutePracticeGrowsRendererRestoresAndFallsBack() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-time-scale", "15",
    ]
    app.launch()

    let begin = app.buttons["onboarding.begin"]
    XCTAssertTrue(begin.waitForExistence(timeout: 8))
    begin.tap()

    XCTAssertTrue(app.staticTexts["session.timer"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["session.completed"].waitForExistence(timeout: 25))
    app.buttons["session.return.garden"].tap()

    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")

    let growthScreenshot = XCTAttachment(screenshot: app.screenshot())
    growthScreenshot.name = "Living garden — first qualifying practice"
    growthScreenshot.lifetime = .keepAlways
    add(growthScreenshot)

    app.terminate()
    app.launchArguments = []
    app.launch()

    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
    XCTAssertFalse(app.buttons["onboarding.begin"].exists)

    app.terminate()
    app.launchArguments = ["-ui-test-native-garden"]
    app.launch()

    XCTAssertTrue(app.buttons["garden.renderer.retry"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
    XCTAssertFalse(app.buttons["onboarding.begin"].exists)
  }

  func testGermanFirstUseHasEquivalentPrimaryPaths() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-AppleLanguages", "(de)",
      "-AppleLocale", "de_DE",
    ]
    app.launch()

    XCTAssertTrue(app.staticTexts["onboarding.title"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["onboarding.title"].label, "Komm bei dir an.")
    XCTAssertTrue(app.buttons["onboarding.begin"].exists)
    XCTAssertTrue(app.buttons["onboarding.explore"].exists)
  }

  func testVisibleLanguageOverrideRelocalizesImmediatelyAndPersists() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-test-reset", "-ui-test-seed", "424242"]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 8))
    app.buttons["Settings"].tap()

    let language = app.buttons["settings.language"]
    XCTAssertTrue(language.waitForExistence(timeout: 5))
    language.tap()
    let german = app.buttons["Deutsch"]
    XCTAssertTrue(german.waitForExistence(timeout: 5))
    german.tap()

    XCTAssertTrue(app.navigationBars["Einstellungen"].waitForExistence(timeout: 5))
    let localizedScreenshot = XCTAttachment(screenshot: app.screenshot())
    localizedScreenshot.name = "Einstellungen — sichtbare Geräte-Sprache"
    localizedScreenshot.lifetime = .keepAlways
    add(localizedScreenshot)

    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Ein Samen wartet")
    XCTAssertTrue(app.buttons["Einstellungen"].exists)
  }

  func testAccessibilityTypeKeepsPracticeModeAndActionReachable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      "-ui-test-dynamic-type-ax5",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    let practiceTab = app.tabBars.buttons["navigation.tab.practice"]
    XCTAssertTrue(practiceTab.waitForExistence(timeout: 5))
    practiceTab.tap()

    let modePicker = app.descendants(matching: .any)["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    XCTAssertTrue(modePicker.isHittable)
    XCTAssertFalse(app.segmentedControls["practice.mode"].exists)
    modePicker.tap()
    let stopwatch = app.buttons["Stopwatch"]
    XCTAssertTrue(stopwatch.waitForExistence(timeout: 5))
    stopwatch.tap()

    let start = app.buttons["practice.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    reveal({ start }, in: app)
    XCTAssertTrue(start.isHittable)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Practice — AX5 mode choice and primary action"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testGermanAccessibilityTypeKeepsLongPracticeLabelsReachable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-AppleLanguages", "(de)",
      "-AppleLocale", "de_DE",
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      "-ui-test-dynamic-type-ax5",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    let practiceTab = app.tabBars.buttons["navigation.tab.practice"]
    XCTAssertTrue(practiceTab.waitForExistence(timeout: 5))
    practiceTab.tap()

    let modePicker = app.descendants(matching: .any)["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    XCTAssertFalse(app.segmentedControls["practice.mode"].exists)
    modePicker.tap()
    let stopwatch = app.buttons["Stoppuhr"]
    XCTAssertTrue(stopwatch.waitForExistence(timeout: 5))
    stopwatch.tap()

    let start = app.buttons["practice.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    reveal({ start }, in: app)
    XCTAssertTrue(start.isHittable)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Meditieren — deutsche AX5-Beschriftungen"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testIPadSidebarSurvivesLandscapeAndNavigatesEveryPrimarySection() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-test-reset", "-ui-test-seed", "424242"]
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()

    let destinations: [(String, String?)] = [
      ("practice", "Practice"),
      ("journey", "Journey"),
      ("journal", "Journal"),
      ("garden", nil),
    ]
    for (section, title) in destinations {
      let sidebarItem = app.staticTexts["navigation.sidebar.\(section)"]
      XCTAssertTrue(sidebarItem.waitForExistence(timeout: 5), "Missing iPad sidebar \(section)")
      sidebarItem.tap()
      if let title {
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
      } else {
        XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.navigationBars["Your garden"].exists)
      }
    }

    app.typeKey("2", modifierFlags: .command)
    XCTAssertTrue(app.navigationBars["Practice"].waitForExistence(timeout: 5))
    app.typeKey("4", modifierFlags: .command)
    XCTAssertTrue(app.navigationBars["Journal"].waitForExistence(timeout: 5))

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "iPad landscape — adaptive four-section sidebar"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testGardenFirstHomeKeepsRendererAndQuietOverlaysProminentOnIPad() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-test-reset", "-ui-test-seed", "424242"]
    XCUIDevice.shared.orientation = .portrait
    defer { XCUIDevice.shared.orientation = .portrait }
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()

    let renderer = app.webViews["garden.renderer.ready"]
    XCTAssertTrue(renderer.waitForExistence(timeout: 12))
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["garden.meditate"].isHittable)
    XCTAssertTrue(app.buttons["garden.settings"].isHittable)
    XCTAssertFalse(app.navigationBars["Your garden"].exists)
    XCTAssertFalse(app.buttons["garden.camera.reset"].exists)
    XCTAssertFalse(app.buttons["garden.describe"].exists)
    for section in ["garden", "practice", "journey", "journal"] {
      XCTAssertTrue(
        app.staticTexts["navigation.sidebar.\(section)"].isHittable,
        "Missing floating Garden navigation item: \(section)"
      )
    }

    let portrait = XCTAttachment(screenshot: app.screenshot())
    portrait.name = "Garden-first home — iPad portrait"
    portrait.lifetime = .keepAlways
    add(portrait)

    let center = renderer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let right = renderer.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.5))
    let left = renderer.coordinate(withNormalizedOffset: CGVector(dx: 0.22, dy: 0.5))
    center.press(forDuration: 0.1, thenDragTo: right, withVelocity: .slow, thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 1)
    XCTAssertTrue(renderer.exists)
    XCTAssertFalse(app.buttons["garden.renderer.retry"].exists)
    let rightOrbit = XCTAttachment(screenshot: app.screenshot())
    rightOrbit.name = "Garden-first home — Twilight orbit right"
    rightOrbit.lifetime = .keepAlways
    add(rightOrbit)

    center.press(forDuration: 0.1, thenDragTo: left, withVelocity: .slow, thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 1)
    XCTAssertTrue(renderer.exists)
    XCTAssertFalse(app.buttons["garden.renderer.retry"].exists)
    let leftOrbit = XCTAttachment(screenshot: app.screenshot())
    leftOrbit.name = "Garden-first home — Twilight orbit left"
    leftOrbit.lifetime = .keepAlways
    add(leftOrbit)

    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["garden.meditate"].isHittable)
    XCTAssertTrue(app.buttons["garden.settings"].isHittable)
    XCTAssertFalse(app.navigationBars["Your garden"].exists)
    Thread.sleep(forTimeInterval: 2)

    let landscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    landscape.name = "Garden-first home — iPad landscape"
    landscape.lifetime = .keepAlways
    add(landscape)

    app.buttons["garden.settings"].tap()
    XCTAssertTrue(app.buttons["settings.language"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.descendants(matching: .any)["settings.privacy"].exists)
    XCTAssertTrue(app.descendants(matching: .any)["settings.support"].exists)
  }

  func testReducedEffectsAndIncreasedContrastKeepNativeGardenOperable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-native-garden",
      "-ui-test-reduce-motion",
      "-ui-test-reduce-transparency",
      "-ui-test-increased-contrast",
      "-AppleInterfaceStyle", "Dark",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["garden.nativeFallback.message"].exists)
    XCTAssertTrue(app.buttons["garden.renderer.retry"].exists)
    XCTAssertTrue(app.buttons["garden.meditate"].exists)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Native garden — dark increased contrast and reduced effects"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testFirstUseNativeGardenAndPracticePassAutomatedAccessibilityAudit() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-native-garden",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    try app.performAccessibilityAudit()

    app.buttons["onboarding.explore"].tap()
    XCTAssertTrue(app.staticTexts["garden.nativeFallback.message"].waitForExistence(timeout: 8))
    try app.performAccessibilityAudit()

    app.buttons["garden.meditate"].tap()
    XCTAssertTrue(app.descendants(matching: .any)["practice.mode"].waitForExistence(timeout: 5))
    try app.performAccessibilityAudit()
  }

  func testIPadAccessibilityTypeKeepsSidebarAndPracticeReachable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      "-ui-test-dynamic-type-ax5",
    ]
    XCUIDevice.shared.orientation = .portrait
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    let practiceSidebar = app.staticTexts["navigation.sidebar.practice"]
    XCTAssertTrue(practiceSidebar.waitForExistence(timeout: 8))
    practiceSidebar.tap()

    let modePicker = app.descendants(matching: .any)["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    XCTAssertFalse(app.segmentedControls["practice.mode"].exists)
    modePicker.tap()
    let stopwatch = app.buttons["Stopwatch"]
    XCTAssertTrue(stopwatch.waitForExistence(timeout: 5))
    stopwatch.tap()

    let start = app.buttons["practice.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    reveal({ start }, in: app)
    XCTAssertTrue(start.isHittable)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "iPad portrait — AX5 practice remains operable"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testSmallIPadGermanDarkAX5KeepsEveryPrimaryPathReachable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-AppleLanguages", "(de)",
      "-AppleLocale", "de_DE",
      "-AppleInterfaceStyle", "Dark",
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      "-ui-test-dynamic-type-ax5",
      "-ui-test-native-garden",
      "-ui-test-reduce-motion",
      "-ui-test-reduce-transparency",
      "-ui-test-increased-contrast",
    ]
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    // Dynamic Type and contrast are covered by direct AX5 assertions here and
    // the separate unmodified full-audit test below. XCTest cannot reliably
    // mutate an already overridden AX5/custom-accessibility environment.
    let boundedAuditTypes: XCUIAccessibilityAuditType = [
      .elementDetection,
      .hitRegion,
      .sufficientElementDescription,
      .trait,
    ]
    try app.performAccessibilityAudit(for: boundedAuditTypes)
    explore.tap()

    for section in ["garden", "practice", "journey", "journal"] {
      let sidebar = app.staticTexts["navigation.sidebar.\(section)"]
      let tab = app.tabBars.buttons["navigation.tab.\(section)"]
      if sidebar.waitForExistence(timeout: 2) {
        XCTAssertTrue(sidebar.isHittable, "Small-iPad sidebar item \(section) is not reachable")
        sidebar.tap()
      } else {
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "Small-iPad tab item \(section) is missing")
        XCTAssertTrue(tab.isHittable, "Small-iPad tab item \(section) is not reachable")
        tab.tap()
      }
    }

    let practiceSidebar = app.staticTexts["navigation.sidebar.practice"]
    let practiceTab = app.tabBars.buttons["navigation.tab.practice"]
    if practiceSidebar.exists {
      practiceSidebar.tap()
    } else {
      practiceTab.tap()
    }
    let modePicker = app.descendants(matching: .any)["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    XCTAssertTrue(modePicker.isHittable)
    try app.performAccessibilityAudit(for: boundedAuditTypes)
    modePicker.tap()
    let stopwatch = app.buttons["Stoppuhr"]
    XCTAssertTrue(stopwatch.waitForExistence(timeout: 5))
    stopwatch.tap()
    let start = app.buttons["practice.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    reveal({ start }, in: app)
    XCTAssertTrue(start.isHittable)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Kleines iPad — Deutsch, dunkel, AX5, reduzierte Effekte"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testSmallIPadGermanPracticePassesFullAccessibilityAudit() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-AppleLanguages", "(de)",
      "-AppleLocale", "de_DE",
      "-ui-test-native-garden",
    ]
    XCUIDevice.shared.orientation = .portrait
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    try app.performAccessibilityAudit()
    explore.tap()

    let practiceSidebar = app.staticTexts["navigation.sidebar.practice"]
    let practiceTab = app.tabBars.buttons["navigation.tab.practice"]
    if practiceSidebar.waitForExistence(timeout: 2) {
      practiceSidebar.tap()
    } else {
      XCTAssertTrue(practiceTab.waitForExistence(timeout: 5))
      practiceTab.tap()
    }
    XCTAssertTrue(app.descendants(matching: .any)["practice.mode"].waitForExistence(timeout: 5))
    let nonContrastAudits: XCUIAccessibilityAuditType = [
      .elementDetection,
      .hitRegion,
      .sufficientElementDescription,
      .dynamicType,
      .textClipped,
      .trait,
    ]
    try app.performAccessibilityAudit(for: nonContrastAudits)

    try app.performAccessibilityAudit(for: .contrast)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Small iPad — German Practice full accessibility audit"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testBundledRendererLoadsWithoutNetworkFallback() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()

    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.webViews["garden.renderer.ready"].waitForExistence(timeout: 8),
      "The page must complete its WebGL2 readiness handshake, not merely create a WKWebView."
    )

    let fallback = app.staticTexts["garden.nativeFallback.message"]
    let unexpectedFallback = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"),
      object: fallback
    )
    unexpectedFallback.isInverted = true
    XCTAssertEqual(XCTWaiter.wait(for: [unexpectedFallback], timeout: 3), .completed)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Living garden — deterministic seed 424242"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testRendererRecoversContextLossAndFallbackOffersDiagnostics() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-renderer-context-cycle",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()

    XCTAssertTrue(
      app.webViews["garden.renderer.recovered"].waitForExistence(timeout: 12),
      "The same WKWebView must survive an actual WEBGL_lose_context loss and restoration cycle."
    )
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "A seed is waiting")
    XCTAssertFalse(app.staticTexts["garden.nativeFallback.message"].exists)
    XCTAssertTrue(app.buttons["garden.meditate"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["garden.meditate"].label, "Meditate")
    Thread.sleep(forTimeInterval: 1)

    let recoveryScreenshot = XCTAttachment(screenshot: app.screenshot())
    recoveryScreenshot.name = "Living garden — recovered WebGL context"
    recoveryScreenshot.lifetime = .keepAlways
    add(recoveryScreenshot)

    app.terminate()
    app.launchArguments = ["-ui-test-native-garden"]
    app.launch()

    XCTAssertTrue(app.buttons["garden.renderer.retry"].waitForExistence(timeout: 8))
    let prepare = app.buttons["garden.renderer.diagnostics.prepare"]
    XCTAssertTrue(prepare.waitForExistence(timeout: 5))
    prepare.tap()
    XCTAssertTrue(app.buttons["garden.renderer.diagnostics.share"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["garden.meditate"].exists)

    let fallbackScreenshot = XCTAttachment(screenshot: app.screenshot())
    fallbackScreenshot.name = "Native garden — retry and redacted diagnostics"
    fallbackScreenshot.lifetime = .keepAlways
    add(fallbackScreenshot)
  }

  func testZeroAudioReleasePresentsOnlyCompletePracticeModes() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-test-reset", "-ui-test-seed", "424242"]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()

    let meditateTab = app.tabBars.buttons["navigation.tab.practice"]
    XCTAssertTrue(meditateTab.waitForExistence(timeout: 5))
    meditateTab.tap()

    let modePicker = app.segmentedControls["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    XCTAssertTrue(modePicker.buttons["Timer"].exists)
    XCTAssertTrue(modePicker.buttons["Stopwatch"].exists)
    XCTAssertFalse(modePicker.buttons["Guided"].exists)
    XCTAssertFalse(app.buttons["guided.library.open"].exists)
    XCTAssertTrue(app.buttons["practice.start"].exists)
  }

  func testStopwatchQualifiesPersistsPausedStateAndFinishesAfterRelaunch() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-time-scale", "120",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let meditateTab = app.tabBars.buttons["navigation.tab.practice"]
    XCTAssertTrue(meditateTab.waitForExistence(timeout: 5))
    meditateTab.tap()

    let modePicker = app.segmentedControls["practice.mode"]
    XCTAssertTrue(modePicker.waitForExistence(timeout: 5))
    let stopwatch = modePicker.buttons["Stopwatch"]
    XCTAssertTrue(stopwatch.exists)
    stopwatch.tap()
    XCTAssertTrue(app.staticTexts["Open-ended practice. Finish when you are ready."].exists)
    app.buttons["practice.start"].tap()

    XCTAssertTrue(app.staticTexts["session.mode"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["session.mode"].label, "Stopwatch")
    XCTAssertTrue(app.staticTexts["session.qualifies"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["session.pause"].exists)
    app.buttons["session.pause"].tap()
    XCTAssertTrue(app.buttons["session.resume"].waitForExistence(timeout: 5))

    app.terminate()
    app.launchArguments = []
    app.launch()
    let restoredMeditateTab = app.tabBars.buttons["navigation.tab.practice"]
    XCTAssertTrue(restoredMeditateTab.waitForExistence(timeout: 8))
    restoredMeditateTab.tap()
    XCTAssertTrue(app.staticTexts["session.mode"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["session.mode"].label, "Stopwatch")
    XCTAssertTrue(app.staticTexts["session.qualifies"].exists)
    XCTAssertTrue(app.buttons["session.resume"].exists)
    let restoredScreenshot = XCTAttachment(screenshot: app.screenshot())
    restoredScreenshot.name = "Stopwatch — qualified paused state restored after relaunch"
    restoredScreenshot.lifetime = .keepAlways
    add(restoredScreenshot)
    app.buttons["session.finish"].tap()

    XCTAssertTrue(app.staticTexts["session.completed"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["session.completed"].label, "Your garden grew")
    XCTAssertTrue(app.staticTexts["This practice is safely in your journey."].exists)
  }

  func testAllFifteenMilestonesRenderAsOneMatureLivingWorld() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-journey-day", "30",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()

    XCTAssertTrue(app.staticTexts["Day 30 of 30"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["garden.nativeFallback.message"].exists)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Living garden — all fifteen milestone systems"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testJourneyExplainsStatisticsAndPersistsAChangeableVariant() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-journey-day", "30",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let journeyTab = app.tabBars.buttons["navigation.tab.journey"]
    XCTAssertTrue(journeyTab.waitForExistence(timeout: 5))
    journeyTab.tap()

    XCTAssertTrue(app.staticTexts["journey.statistics"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["journey.history"].exists)
    let fullHistory = app.buttons["journey.history.all"]
    XCTAssertTrue(fullHistory.exists)
    reveal({ fullHistory }, in: app)
    XCTAssertTrue(fullHistory.isHittable)
    fullHistory.tap()
    XCTAssertTrue(app.navigationBars["Practice history"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Stopwatch"].waitForExistence(timeout: 5))
    app.navigationBars.buttons["Journey"].tap()
    XCTAssertTrue(app.staticTexts["journey.milestone.01"].exists)
    XCTAssertTrue(app.staticTexts["journey.milestone.15"].waitForExistence(timeout: 5))

    let variant = app.buttons["journey.variant.01"]
    XCTAssertTrue(variant.waitForExistence(timeout: 5))
    reveal({ variant }, in: app)
    XCTAssertTrue(variant.isHittable)
    variant.tap()
    let rootFan = app.buttons["Root fan"]
    XCTAssertTrue(rootFan.waitForExistence(timeout: 5))
    rootFan.tap()
    XCTAssertTrue(app.buttons["Garden variant: Root fan"].waitForExistence(timeout: 5))

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Journey — deterministic statistics and milestone choices"
    screenshot.lifetime = .keepAlways
    add(screenshot)

    app.terminate()
    app.launchArguments = []
    app.launch()
    let restoredJourneyTab = app.tabBars.buttons["navigation.tab.journey"]
    XCTAssertTrue(restoredJourneyTab.waitForExistence(timeout: 8))
    restoredJourneyTab.tap()
    let restoredVariant = app.buttons["Garden variant: Root fan"]
    XCTAssertTrue(restoredVariant.waitForExistence(timeout: 8))
    reveal({ restoredVariant }, in: app)
    XCTAssertTrue(restoredVariant.isHittable)
  }

  func testTravelMidnightAndDSTJourneyRemainsTruthfulWhenRendered() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-language", "en",
      "-ui-test-journey-calendar-edges",
      "-ui-test-wall-clock-epoch", "1786363200",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let journeyTab = app.tabBars.buttons["navigation.tab.journey"]
    if journeyTab.waitForExistence(timeout: 2) {
      journeyTab.tap()
    } else {
      let journeySidebar = app.staticTexts["navigation.sidebar.journey"]
      XCTAssertTrue(journeySidebar.waitForExistence(timeout: 5))
      journeySidebar.tap()
    }

    XCTAssertTrue(app.staticTexts["3 of 30 practice days"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["journey.statistics.streak.current.value"].label, "0")
    XCTAssertEqual(app.staticTexts["journey.statistics.streak.best.value"].label, "3")
    XCTAssertEqual(app.staticTexts["journey.statistics.days.value"].label, "3")
    XCTAssertEqual(app.staticTexts["journey.statistics.sessions.value"].label, "4")
    let completion = app.staticTexts["journey.milestone.completed.01"]
    XCTAssertTrue(completion.waitForExistence(timeout: 5))
    XCTAssertTrue(completion.label.contains("Mar 8, 2026"))

    let practiceCalendar = app.staticTexts["journey.calendar"]
    reveal({ practiceCalendar }, in: app)
    XCTAssertTrue(practiceCalendar.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["journey.calendar.month"].label.contains("March 2026"))
    XCTAssertTrue(app.buttons["journey.calendar.day.2026-03-07"].label.contains("Garden practice"))
    XCTAssertTrue(app.buttons["journey.calendar.day.2026-03-10"].label.contains("Saved practice"))
    XCTAssertTrue(app.buttons["journey.calendar.day.2026-03-11"].label.contains("No practice"))

    let selectedDay = app.buttons["journey.calendar.day.2026-03-08"]
    XCTAssertTrue(selectedDay.isHittable)
    selectedDay.tap()
    XCTAssertTrue(
      app.buttons["journey.calendar.day.2026-03-08"].label.contains("Selected")
    )
    XCTAssertTrue(app.staticTexts["journey.calendar.selected"].waitForExistence(timeout: 5))

    let currentMonth = app.buttons["journey.calendar.current"]
    XCTAssertTrue(currentMonth.isEnabled)
    currentMonth.tap()
    XCTAssertTrue(app.staticTexts["journey.calendar.month"].label.contains("August 2026"))
    let today = app.buttons["journey.calendar.day.2026-08-10"]
    XCTAssertTrue(today.waitForExistence(timeout: 5))
    XCTAssertTrue(today.label.contains("Today"))
    XCTAssertTrue(today.label.contains("No practice"))

    let calendarScreenshot = XCTAttachment(screenshot: app.screenshot())
    calendarScreenshot.name = "Journey — private monthly practice calendar"
    calendarScreenshot.lifetime = .keepAlways
    add(calendarScreenshot)

    let fullHistory = app.buttons["journey.history.all"]
    reveal({ fullHistory }, in: app)
    XCTAssertTrue(fullHistory.isHittable)
    fullHistory.tap()
    for ordinal in 1...4 {
      let identifier = String(
        format: "journey.history.93000000-0000-4000-8000-%012x",
        ordinal
      )
      XCTAssertTrue(
        app.descendants(matching: .any)[identifier].waitForExistence(timeout: 5)
      )
    }

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Journey — stored midnight, DST, and travel practice days"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testPrivateTextReflectionSearchEditRelaunchAndDelete() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-test-reset", "-ui-test-seed", "424242"]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let journalTab = app.tabBars.buttons["navigation.tab.journal"]
    XCTAssertTrue(journalTab.waitForExistence(timeout: 5))
    journalTab.tap()

    let create = app.buttons["journal.empty.new"]
    XCTAssertTrue(create.waitForExistence(timeout: 5))
    create.tap()
    let editor = app.textViews["journal.editor.text"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.typeText("Breathing felt steady near the old tree.")
    app.buttons["journal.editor.save"].tap()

    XCTAssertTrue(app.staticTexts["Breathing felt steady near the old tree."].waitForExistence(timeout: 5))

    app.terminate()
    app.launchArguments = []
    app.launch()
    let restoredJournalTab = app.tabBars.buttons["navigation.tab.journal"]
    XCTAssertTrue(restoredJournalTab.waitForExistence(timeout: 8))
    restoredJournalTab.tap()
    let restoredText = app.staticTexts["Breathing felt steady near the old tree."]
    XCTAssertTrue(restoredText.waitForExistence(timeout: 5))
    restoredText.tap()

    let restoredEditor = app.textViews["journal.editor.text"]
    XCTAssertTrue(restoredEditor.waitForExistence(timeout: 5))
    restoredEditor.tap()
    restoredEditor.typeText(" My shoulders softened. ")
    app.buttons["journal.editor.save"].tap()
    let editedText = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS[c] %@", "shoulders softened")
    ).firstMatch
    XCTAssertTrue(editedText.waitForExistence(timeout: 5))
    XCTAssertTrue(editedText.label.contains("Breathing felt steady near the old tree."))

    let search = app.searchFields["Search words or dates"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("shoulders")
    XCTAssertTrue(editedText.exists)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Journal — private searchable reflection"
    screenshot.lifetime = .keepAlways
    add(screenshot)

    let actions = app.buttons["More actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5))
    actions.tap()
    let delete = app.buttons["Delete"]
    XCTAssertTrue(delete.waitForExistence(timeout: 5))
    delete.tap()
    let confirm = app.alerts.buttons["Delete reflection"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()

    XCTAssertFalse(editedText.waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["journal.empty.new"].waitForExistence(timeout: 5))
  }

  func testCompletedPracticeOffersAnOptionalLinkedReflection() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-time-scale", "120",
    ]
    app.launch()

    let begin = app.buttons["onboarding.begin"]
    XCTAssertTrue(begin.waitForExistence(timeout: 8))
    begin.tap()
    XCTAssertTrue(app.staticTexts["session.completed"].waitForExistence(timeout: 8))

    let reflect = app.buttons["session.reflect"]
    XCTAssertTrue(reflect.exists)
    reflect.tap()
    let editor = app.textViews["journal.editor.text"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText("A quiet ending after practice.")
    app.buttons["journal.editor.save"].tap()

    XCTAssertTrue(app.staticTexts["A quiet ending after practice."].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Practice"].exists)

    app.terminate()
    app.launchArguments = []
    app.launch()
    let journalTab = app.tabBars.buttons["navigation.tab.journal"]
    XCTAssertTrue(journalTab.waitForExistence(timeout: 8))
    journalTab.tap()
    XCTAssertTrue(app.staticTexts["A quiet ending after practice."].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Practice"].exists)
  }

  func testDeniedVoiceRecordingNeverLosesAnInProgressTextReflection() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-journal-recorder-unavailable",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let journalTab = app.tabBars.buttons["navigation.tab.journal"]
    XCTAssertTrue(journalTab.waitForExistence(timeout: 5))
    journalTab.tap()
    app.buttons["journal.empty.new"].tap()

    let editor = app.textViews["journal.editor.text"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText("These words must remain when recording is unavailable.")
    let record = app.buttons["journal.voice.record"]
    XCTAssertTrue(record.exists)
    record.tap()

    XCTAssertTrue(
      app.staticTexts["Microphone access is off. Your text reflection remains available."]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(String(describing: editor.value).contains("These words must remain"))
    app.buttons["journal.editor.save"].tap()
    XCTAssertTrue(
      app.staticTexts["These words must remain when recording is unavailable."]
        .waitForExistence(timeout: 5)
    )
  }

  func testLocalDataExportResetAndCompleteDeletionRemainTruthful() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-journey-day", "2",
    ]
    app.launch()

    let explore = app.buttons["onboarding.explore"]
    XCTAssertTrue(explore.waitForExistence(timeout: 8))
    explore.tap()
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 8))
    settings.tap()
    let dataAndSync = app.buttons["settings.dataAndSync"]
    XCTAssertTrue(dataAndSync.waitForExistence(timeout: 5))
    dataAndSync.tap()

    XCTAssertTrue(app.staticTexts["Stored on this device"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Practice sessions"].exists)
    XCTAssertEqual(
      app.staticTexts["data.count.sessions.value"].label,
      "Practice sessions, 2"
    )

    let export = app.buttons["data.export.action"]
    XCTAssertTrue(export.exists)
    export.tap()
    XCTAssertTrue(app.buttons["data.export.share"].waitForExistence(timeout: 8))

    let reset = app.buttons["data.reset.action"]
    reveal({ reset }, in: app)
    XCTAssertTrue(reset.isHittable)
    reset.tap()
    let confirmReset = app.buttons["Reset garden"]
    XCTAssertTrue(confirmReset.waitForExistence(timeout: 5))
    confirmReset.tap()
    let resetComplete = app.staticTexts[
      "A new garden has begun. Old-generation data cannot change it."
    ]
    XCTAssertTrue(resetComplete.waitForExistence(timeout: 8))
    app.buttons["OK"].tap()

    let delete = app.buttons["data.delete.action"]
    reveal({ delete }, in: app)
    XCTAssertTrue(delete.isHittable)
    delete.tap()
    let confirmDelete = app.buttons["Delete everything"]
    XCTAssertTrue(confirmDelete.waitForExistence(timeout: 5))
    confirmDelete.tap()

    XCTAssertTrue(app.staticTexts["onboarding.title"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["data.delete.complete"].exists)

    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(app.staticTexts["onboarding.title"].waitForExistence(timeout: 8))
  }

  func testWeeklyReminderCreatesPersistsReconcilesAndDeletesWithoutSystemPrompt() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-reminders-authorized",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 8))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["settings.reminders"].waitForExistence(timeout: 5))
    app.buttons["settings.reminders"].tap()

    XCTAssertTrue(app.staticTexts["reminders.status"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "No active reminders")
    app.buttons["reminders.add.action"].tap()
    XCTAssertTrue(app.navigationBars["New reminder"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["reminders.editor.day"].exists)
    XCTAssertTrue(app.datePickers["reminders.editor.time"].exists)
    app.buttons["reminders.save.action"].tap()

    XCTAssertTrue(app.staticTexts["reminders.status"].waitForExistence(timeout: 5))
    XCTAssertEqual(
      app.staticTexts["reminders.status"].label,
      "Weekly reminders are scheduled"
    )
    let reminderRow = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "reminders.edit.")
    ).firstMatch
    XCTAssertTrue(reminderRow.waitForExistence(timeout: 5))

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Reminders — contextual weekly schedule"
    screenshot.lifetime = .keepAlways
    add(screenshot)

    app.terminate()
    app.launchArguments = ["-ui-test-reminders-authorized"]
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 8))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["settings.reminders"].waitForExistence(timeout: 5))
    app.buttons["settings.reminders"].tap()
    XCTAssertTrue(app.staticTexts["reminders.status"].waitForExistence(timeout: 5))
    XCTAssertEqual(
      app.staticTexts["reminders.status"].label,
      "Weekly reminders are scheduled"
    )

    let restoredRow = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "reminders.edit.")
    ).firstMatch
    XCTAssertTrue(restoredRow.waitForExistence(timeout: 5))
    restoredRow.tap()
    XCTAssertTrue(app.navigationBars["Edit reminder"].waitForExistence(timeout: 5))
    app.buttons["reminders.delete.action"].tap()
    XCTAssertTrue(app.buttons["reminders.add.action"].waitForExistence(timeout: 5))
    XCTAssertFalse(restoredRow.waitForExistence(timeout: 2))
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "No active reminders")
  }

  func testPhysicalIPadRealTimerPersistsExactlyOnceAcrossBackgroundAndRelaunch() throws {
    try requirePhysicalDevice()

    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-language", "en",
    ]
    app.launch()

    let begin = app.buttons["onboarding.begin"]
    XCTAssertTrue(begin.waitForExistence(timeout: 8))
    let startedAt = Date()
    begin.tap()
    XCTAssertTrue(app.staticTexts["session.timer"].waitForExistence(timeout: 8))

    Thread.sleep(forTimeInterval: 5)
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 180)
    app.activate()

    XCTAssertTrue(
      app.staticTexts["session.completed"].waitForExistence(timeout: 20),
      "A real three-minute timer must complete truthfully after background recovery."
    )
    XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(startedAt), 180)
    XCTAssertEqual(app.staticTexts["session.completed"].label, "Your garden grew")
    app.buttons["session.return.garden"].tap()

    XCTAssertTrue(app.webViews["garden.renderer.ready"].waitForExistence(timeout: 12))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
    openJourney(in: app)
    XCTAssertTrue(app.staticTexts["journey.statistics"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["journey.statistics.sessions.value"].label, "1")
    XCTAssertEqual(app.staticTexts["journey.statistics.days.value"].label, "1")

    let calendar = app.staticTexts["journey.calendar"]
    reveal({ calendar }, in: app)
    XCTAssertTrue(calendar.waitForExistence(timeout: 5))
    let today = app.buttons.matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@",
        "journey.calendar.day.",
        "Today"
      )
    ).firstMatch
    XCTAssertTrue(today.waitForExistence(timeout: 5))
    XCTAssertTrue(today.label.contains("Garden practice"))
    today.tap()
    XCTAssertTrue(today.label.contains("Selected"))
    XCTAssertTrue(app.staticTexts["journey.calendar.selected"].waitForExistence(timeout: 5))

    let completedScreenshot = XCTAttachment(screenshot: app.screenshot())
    completedScreenshot.name = "Physical iPad — real timer, immutable history, and calendar"
    completedScreenshot.lifetime = .keepAlways
    add(completedScreenshot)

    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(app.staticTexts["garden.stage"].waitForExistence(timeout: 12))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
    openJourney(in: app)
    XCTAssertEqual(app.staticTexts["journey.statistics.sessions.value"].label, "1")
    XCTAssertEqual(app.staticTexts["journey.statistics.days.value"].label, "1")

    app.terminate()
    app.launchArguments = ["-ui-test-native-garden"]
    app.launch()
    XCTAssertTrue(app.buttons["garden.renderer.retry"].waitForExistence(timeout: 12))
    XCTAssertEqual(app.staticTexts["garden.stage"].label, "Your practice is taking root")
    XCTAssertTrue(app.buttons["garden.meditate"].isHittable)
  }

  func testPhysicalIPadPermissionDenialPreservesTextAndRemovesReminder() throws {
    try requirePhysicalDevice()

    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-reset",
      "-ui-test-seed", "424242",
      "-ui-test-language", "en",
    ]
    let permissionMonitor = addUIInterruptionMonitor(
      withDescription: "Arrive Within permission request"
    ) { alert in
      for label in ["Don’t Allow", "Don't Allow", "Do Not Allow", "Nicht erlauben"] {
        let button = alert.buttons[label]
        if button.exists {
          button.tap()
          return true
        }
      }
      return false
    }
    defer { removeUIInterruptionMonitor(permissionMonitor) }
    app.launch()

    XCTAssertTrue(app.buttons["onboarding.explore"].waitForExistence(timeout: 8))
    app.buttons["onboarding.explore"].tap()
    openJournal(in: app)
    XCTAssertTrue(app.buttons["journal.empty.new"].waitForExistence(timeout: 5))
    app.buttons["journal.empty.new"].tap()

    let editor = app.textViews["journal.editor.text"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText("Synthetic physical permission check.")
    app.buttons["journal.voice.record"].tap()
    app.tap()
    XCTAssertTrue(
      app.staticTexts["Microphone access is off. Your text reflection remains available."]
        .waitForExistence(timeout: 8)
    )
    XCTAssertTrue(String(describing: editor.value).contains("Synthetic physical permission check."))
    app.buttons["journal.editor.save"].tap()
    let reflection = app.staticTexts["Synthetic physical permission check."]
    XCTAssertTrue(reflection.waitForExistence(timeout: 5))
    reflection.tap()
    app.buttons["More actions"].tap()
    app.buttons["Delete"].tap()
    XCTAssertTrue(app.alerts.buttons["Delete reflection"].waitForExistence(timeout: 5))
    app.alerts.buttons["Delete reflection"].tap()
    XCTAssertTrue(app.buttons["journal.empty.new"].waitForExistence(timeout: 5))

    openGarden(in: app)
    XCTAssertTrue(app.buttons["garden.settings"].waitForExistence(timeout: 5))
    app.buttons["garden.settings"].tap()
    app.buttons["settings.reminders"].tap()
    XCTAssertTrue(app.buttons["reminders.add.action"].waitForExistence(timeout: 5))
    app.buttons["reminders.add.action"].tap()
    app.buttons["reminders.save.action"].tap()
    app.tap()

    let deniedNotice = app.alerts["Notifications remain off"]
    if deniedNotice.waitForExistence(timeout: 8) {
      deniedNotice.buttons["OK"].tap()
    }
    XCTAssertTrue(app.staticTexts["reminders.status"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "Notifications are off")
    let reminder = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "reminders.edit.")
    ).firstMatch
    XCTAssertTrue(reminder.waitForExistence(timeout: 5))
    reminder.tap()
    app.buttons["reminders.delete.action"].tap()
    XCTAssertTrue(app.buttons["reminders.add.action"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["reminders.status"].label, "No active reminders")

    let permissionScreenshot = XCTAttachment(screenshot: app.screenshot())
    permissionScreenshot.name = "Physical iPad — private permission-denial recovery"
    permissionScreenshot.lifetime = .keepAlways
    add(permissionScreenshot)
  }

  private func requirePhysicalDevice() throws {
    try XCTSkipIf(
      ProcessInfo.processInfo.environment["SIMULATOR_UDID"] != nil,
      "This exact-duration and system-permission proof requires physical hardware."
    )
  }

  private func openGarden(in app: XCUIApplication) {
    let tab = app.tabBars.buttons["navigation.tab.garden"]
    if tab.waitForExistence(timeout: 2) {
      tab.tap()
    } else {
      let sidebar = app.staticTexts["navigation.sidebar.garden"]
      XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
      sidebar.tap()
    }
  }

  private func openJourney(in app: XCUIApplication) {
    let tab = app.tabBars.buttons["navigation.tab.journey"]
    if tab.waitForExistence(timeout: 2) {
      tab.tap()
    } else {
      let sidebar = app.staticTexts["navigation.sidebar.journey"]
      XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
      sidebar.tap()
    }
  }

  private func openJournal(in app: XCUIApplication) {
    let tab = app.tabBars.buttons["navigation.tab.journal"]
    if tab.waitForExistence(timeout: 2) {
      tab.tap()
    } else {
      let sidebar = app.staticTexts["navigation.sidebar.journal"]
      XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
      sidebar.tap()
    }
  }

  @discardableResult
  private func reveal(
    _ elementQuery: () -> XCUIElement,
    in app: XCUIApplication,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> XCUIElement {
    for _ in 0..<6 {
      let element = elementQuery()
      if element.exists && element.isHittable {
        return element
      }
      scrollPrimaryContainerUp(in: app)
    }

    let element = elementQuery()
    XCTAssertTrue(element.exists, "Element does not exist after bounded scrolling.", file: file, line: line)
    XCTAssertTrue(element.isHittable, "Element is not hittable after bounded scrolling.", file: file, line: line)
    return element
  }

  private func scrollPrimaryContainerUp(in app: XCUIApplication) {
    let collection = app.collectionViews.firstMatch
    if collection.exists && collection.isHittable {
      collection.swipeUp()
      return
    }
    let table = app.tables.firstMatch
    if table.exists && table.isHittable {
      table.swipeUp()
      return
    }
    let scrollView = app.scrollViews.firstMatch
    if scrollView.exists && scrollView.isHittable {
      scrollView.swipeUp()
      return
    }
    app.swipeUp()
  }

  private func focusTextField(
    _ identifier: String,
    in app: XCUIApplication,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> XCUIElement {
    let hasKeyboardFocus = NSPredicate(format: "hasKeyboardFocus == true")

    for _ in 0..<3 {
      let field = reveal({ app.textFields[identifier] }, in: app, file: file, line: line)
      field.tap()

      let focusedField = app.textFields
        .matching(identifier: identifier)
        .matching(hasKeyboardFocus)
        .firstMatch
      if focusedField.waitForExistence(timeout: 2) {
        return focusedField
      }
    }

    XCTFail("Text field did not acquire keyboard focus after bounded taps.", file: file, line: line)
    return app.textFields[identifier]
  }

  private func waitForValue(
    _ expectedValue: String,
    of element: XCUIElement,
    timeout: TimeInterval
  ) -> Bool {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == %@", expectedValue),
      object: element
    )
    return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
  }

  private func assertPreviewField(
    _ element: XCUIElement,
    fieldLabel: String,
    expectedValue: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertTrue(element.waitForExistence(timeout: 5), file: file, line: line)
    let combinedPrefix = "\(fieldLabel), "
    if element.label.hasPrefix(combinedPrefix) {
      XCTAssertEqual(
        String(element.label.dropFirst(combinedPrefix.count)),
        expectedValue,
        file: file,
        line: line
      )
    } else {
      XCTAssertEqual(element.label, expectedValue, file: file, line: line)
    }
  }
}

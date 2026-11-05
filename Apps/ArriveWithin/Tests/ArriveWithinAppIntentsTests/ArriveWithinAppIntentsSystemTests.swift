import AppIntents
import AppIntentsTesting
import XCTest

/// AppIntentsTesting system tests for ADR-0015. Each test launches the app in a
/// fresh isolated DEBUG namespace, runs the real intents through the system, and
/// reads state back only through the hidden DEBUG inspection intent.
@MainActor
final class ArriveWithinAppIntentsSystemTests: XCTestCase {
  private let definitions = IntentDefinitions(bundleIdentifier: "com.philipps.arrivewithin.ios")

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testSilentStartReportsTheTimerAndRepeatedStartsReuseIt() async throws {
    let app = launchIsolatedApp()
    defer { app.terminate() }
    let startSilent = definitions.intents["StartSilentPracticeIntent"]

    let started = try await startSilent.makeIntent(minutes: 10).run()
    let mode: AnyAppEnum = try started.value.mode
    let plannedMinutes: Int = try started.value.plannedMinutes
    XCTAssertEqual(mode.rawValue, "timer")
    XCTAssertEqual(plannedMinutes, 10)

    let first = try await inspect()
    let sessionID: String = try first.sessionIdentifier
    let target: Int = try first.targetMilliseconds
    XCTAssertFalse(sessionID.isEmpty)
    XCTAssertEqual(target, 600_000)

    let repeated = try await startSilent.makeIntent(minutes: 5).run()
    let repeatedMinutes: Int = try repeated.value.plannedMinutes
    XCTAssertEqual(repeatedMinutes, 10)
    let openEnded = try await startSilent.makeIntent().run()
    let openEndedMode: AnyAppEnum = try openEnded.value.mode
    XCTAssertEqual(openEndedMode.rawValue, "timer")

    let after = try await inspect()
    let afterSessionID: String = try after.sessionIdentifier
    let afterTarget: Int = try after.targetMilliseconds
    let ledger: Int = try after.practiceEventCount
    XCTAssertEqual(afterSessionID, sessionID)
    XCTAssertEqual(afterTarget, 600_000)
    XCTAssertEqual(ledger, 0)
  }

  func testInvalidLengthStartsNothing() async throws {
    let app = launchIsolatedApp()
    defer { app.terminate() }

    do {
      _ = try await definitions.intents["StartSilentPracticeIntent"].makeIntent(minutes: 181).run()
      XCTFail("A length above 180 minutes must not start a practice")
    } catch {
      // Rejected by the parameter range or by the adapter's own check.
    }
    let state = try await inspect()
    let sessionID: String = try state.sessionIdentifier
    XCTAssertTrue(sessionID.isEmpty)
  }

  func testGuidedCatalogAndStartByEntityIdentifier() async throws {
    let app = launchIsolatedApp()
    defer { app.terminate() }
    let practices = definitions.entities["GuidedPracticeEntity"]

    let all = try await practices.allEntities()
    XCTAssertEqual(all.count, 42)
    XCTAssertEqual(
      Set(all.map(\.identifier.instanceIdentifier)),
      Set((1...42).map { String(format: "G%02d", $0) })
    )
    let matches = try await practices.entities(identifiers: ["G01"])
    let selected = try XCTUnwrap(matches.first)
    let minutes: Int = try selected.minutes
    XCTAssertEqual(minutes, 3)

    let english = definitions.enums["NarrationLanguageAppEnum"].makeCase("english")
    let result = try await definitions.intents["StartGuidedPracticeIntent"]
      .makeIntent(practice: selected, narrationLanguage: english)
      .run()
    let mode: AnyAppEnum = try result.value.mode
    XCTAssertEqual(mode.rawValue, "guided")

    let state = try await inspect()
    let contentID: String = try state.guidedContentIdentifier
    let version: Int = try state.guidedContentVersion
    let target: Int = try state.targetMilliseconds
    XCTAssertEqual(contentID, "G01")
    XCTAssertEqual(version, 1)
    XCTAssertEqual(target, 180_000)
  }

  func testPauseAndResumeExcludePausedTime() async throws {
    let app = launchIsolatedApp()
    defer { app.terminate() }
    let control = definitions.enums["PracticeControlAppEnum"]
    let setPaused = definitions.intents["SetPracticePausedIntent"]

    _ = try await definitions.intents["StartSilentPracticeIntent"].makeIntent().run()
    try await Task.sleep(for: .seconds(2))

    let paused = try await setPaused.makeIntent(action: control.makeCase("pause")).run()
    let pausedState: AnyAppEnum = try paused.value.state
    XCTAssertEqual(pausedState.rawValue, "paused")
    let atPause: Int = try await inspect().activeMilliseconds

    try await Task.sleep(for: .seconds(3))
    let whilePaused: Int = try await inspect().activeMilliseconds
    XCTAssertEqual(whilePaused, atPause)
    let repeated = try await setPaused.makeIntent(action: control.makeCase("pause")).run()
    let repeatedState: AnyAppEnum = try repeated.value.state
    XCTAssertEqual(repeatedState.rawValue, "paused")

    let resumed = try await setPaused.makeIntent(action: control.makeCase("resume")).run()
    let resumedState: AnyAppEnum = try resumed.value.state
    XCTAssertEqual(resumedState.rawValue, "running")
    try await Task.sleep(for: .seconds(1))
    let afterResume = try await inspect()
    let active: Int = try afterResume.activeMilliseconds
    let ledger: Int = try afterResume.practiceEventCount
    XCTAssertGreaterThan(active, atPause)
    XCTAssertLessThan(active - atPause, 3_000)
    XCTAssertEqual(ledger, 0)
  }

  func testPauseWithoutPracticeFails() async throws {
    let app = launchIsolatedApp()
    defer { app.terminate() }
    let control = definitions.enums["PracticeControlAppEnum"]

    do {
      _ = try await definitions.intents["SetPracticePausedIntent"]
        .makeIntent(action: control.makeCase("pause"))
        .run()
      XCTFail("Pausing without a practice must report that none is in progress")
    } catch {
      // The adapter reports "No practice is in progress."
    }
    let state = try await inspect()
    let sessionID: String = try state.sessionIdentifier
    let ledger: Int = try state.practiceEventCount
    XCTAssertTrue(sessionID.isEmpty)
    XCTAssertEqual(ledger, 0)
  }

  private func launchIsolatedApp() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-test-namespace", UUID().uuidString, "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
    ]
    app.launch()
    return app
  }

  private func inspect() async throws -> DynamicPropertyPath {
    let result = try await definitions.intents["InspectPracticeForVerificationIntent"].makeIntent().run()
    return result.value
  }
}

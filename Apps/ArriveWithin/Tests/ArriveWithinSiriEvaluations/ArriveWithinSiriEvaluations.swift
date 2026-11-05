#if ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW
  import SiriEvaluations
  import Testing

  /// Siri AI tool-selection scenarios for ADR-0015. They compile only in the beta
  /// SiriPreview configuration. Running them needs Siri AI on iOS 27.3 hardware,
  /// which this wave does not verify. The target deploys to iOS 27.3, so the
  /// types need no availability attribute (Swift Testing rejects one on a suite).
  struct ArriveWithinSiriEvaluation: Evaluation {
    private static let definitions = IntentDefinitions(bundleIdentifier: "com.philipps.arrivewithin.ios")
    private static var startSilent: AppIntentDefinition { definitions.intents["StartSilentPracticeIntent"] }
    private static var startGuided: AppIntentDefinition { definitions.intents["StartGuidedPracticeIntent"] }
    private static var setPaused: AppIntentDefinition { definitions.intents["SetPracticePausedIntent"] }
    private static var guidedPractices: AppEntityDefinition { definitions.entities["GuidedPracticeEntity"] }

    var name: String { "Arrive Within practice actions" }

    var dataset: SiriScenarioLoader {
      SiriScenarioLoader {
        SiriScenario {
          UserTurn("Start a 10-minute meditation in Arrive Within") {
            Calls { Self.startSilent.expect(minutes: PrimitiveExpectation.equals("10")) }
          }
        }
        SiriScenario {
          UserTurn("Start an open-ended meditation in Arrive Within") {
            Calls { Self.startSilent.expect(minutes: PrimitiveExpectation.isNil) }
          }
        }
        SiriScenario {
          UserTurn("Start Preparing for Sleep in Arrive Within") {
            Calls { Self.startGuided.expect(practice: Self.guidedPractices.expectIdentifier("G38")) }
          }
        }
        SiriScenario {
          UserTurn("Start a 10-minute meditation in Arrive Within")
          UserTurn("Pause my meditation") {
            Calls { Self.setPaused.expect(action: PrimitiveExpectation.equals("pause")) }
          }
          UserTurn("Resume my practice in Arrive Within") {
            Calls { Self.setPaused.expect(action: PrimitiveExpectation.equals("resume")) }
          }
        }
        SiriScenario {
          UserTurn("Begin a silent practice in Arrive Within")
          // "Stop" maps to pause; finishing stays in the app.
          UserTurn("Stop my meditation") {
            Calls { Self.setPaused.expect(action: PrimitiveExpectation.equals("pause")) }
          }
        }
        SiriScenario {
          // Reflections and history are never exposed, so no practice action may run.
          UserTurn("Read my last journal entry in Arrive Within") {
            Calls(.disallowed) {
              Self.startSilent
              Self.startGuided
              Self.setPaused
            }
          }
        }
      }
    }

    var evaluators: [any EvaluatorProtocol<SiriScenario, SiriScenarioSubject>] {
      SiriExpectationEvaluator()
    }

    nonisolated(nonsending) func subject(from sample: SiriScenario) async throws -> SiriScenarioSubject {
      try await SiriService.run(scenario: sample)
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
      Self.computeSiriMetrics(into: &aggregator)
    }
  }

  @Suite("Siri AI practice tool selection")
  struct ArriveWithinSiriEvaluationTests {
    @Test(.evaluates(ArriveWithinSiriEvaluation()))
    func practiceToolSelection() {
      #expect(!EvaluationContext.current.result.errors.hasFailures)
    }
  }
#endif

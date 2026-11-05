#if ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW
  import AppIntents

  // Beta-only Siri AI tool exposure (ADR-0015). Only the SiriPreview build
  // configuration compiles this file, with an iOS 27.3 beta SDK. Debug and
  // Release exclude it, so default builds expose zero tools.
  @available(iOS 27.3, *)
  extension StartSilentPracticeIntent: ToolIntent {}

  @available(iOS 27.3, *)
  extension StartGuidedPracticeIntent: ToolIntent {}

  @available(iOS 27.3, *)
  extension SetPracticePausedIntent: ToolIntent {}
#endif

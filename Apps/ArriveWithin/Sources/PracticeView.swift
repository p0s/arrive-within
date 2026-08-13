import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import SwiftUI

struct PracticeView: View {
  let model: AppModel
  @State private var selectedMode: PracticeMode = .timer
  @State private var timerMinutes = 3
  @State private var preparation: PreparationDuration = .off
  @State private var intervalBellMinutes: Int?
  @State private var openingBellEnabled = true
  @State private var closingBellEnabled = true
  @State private var ambienceEnabled = false
  @State private var mixWithOthers = false
  @State private var hapticsEnabled = true
  @State private var backgroundEndAlertEnabled = false

  var body: some View {
    Group {
      if let completion = model.completionPresentation {
        PracticeCompletionView(model: model, completion: completion)
      } else if let session = model.activeSession {
        ActivePracticeView(model: model, session: session)
      } else {
        PracticeChooserView(
          model: model,
          selectedMode: $selectedMode,
          timerMinutes: $timerMinutes,
          preparation: $preparation,
          intervalBellMinutes: $intervalBellMinutes,
          openingBellEnabled: $openingBellEnabled,
          closingBellEnabled: $closingBellEnabled,
          ambienceEnabled: $ambienceEnabled,
          mixWithOthers: $mixWithOthers,
          hapticsEnabled: $hapticsEnabled,
          backgroundEndAlertEnabled: $backgroundEndAlertEnabled
        )
      }
    }
    .navigationTitle("practice.title")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      let preferences = model.timerPreferences
      timerMinutes = preferences.durationMinutes
      preparation = preferences.preparation
      intervalBellMinutes = preferences.audio.intervalBellMinutes
      openingBellEnabled = preferences.audio.openingBellEnabled
      closingBellEnabled = preferences.audio.closingBellEnabled
      ambienceEnabled = preferences.audio.ambienceID != nil
      mixWithOthers = preferences.audio.otherAudioPolicy == .mixWithOthers
      hapticsEnabled = preferences.audio.hapticsEnabled
      backgroundEndAlertEnabled = preferences.audio.backgroundEndAlertEnabled
    }
  }
}

private struct PracticeChooserView: View {
  let model: AppModel
  @Binding var selectedMode: PracticeMode
  @Binding var timerMinutes: Int
  @Binding var preparation: PreparationDuration
  @Binding var intervalBellMinutes: Int?
  @Binding var openingBellEnabled: Bool
  @Binding var closingBellEnabled: Bool
  @Binding var ambienceEnabled: Bool
  @Binding var mixWithOthers: Bool
  @Binding var hapticsEnabled: Bool
  @Binding var backgroundEndAlertEnabled: Bool
  @Environment(\.locale) private var locale
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  private var availableModes: [PracticeMode] {
    guidedNarrationIsAvailable ? [.guided, .timer, .stopwatch] : [.timer, .stopwatch]
  }

  private var guidedNarrationIsAvailable: Bool {
    let language: GuidedLanguage = locale.language.languageCode?.identifier == "de" ? .german : .english
    return model.guidedPractices.contains { practice in
      let text = practice.localized[language]
      guard text.editorialState.isPackagedForPlayback else { return false }
      return BundledAudioAssetResolver.packagedNarrationURL(
        bundle: .main,
        contentID: practice.id,
        languageCode: language.rawValue
      ) != nil
    }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
        VStack(alignment: .leading, spacing: 6) {
          Text("practice.title")
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
            .fixedSize(horizontal: false, vertical: true)
          Text("practice.subtitle")
            .font(.title3)
            .accessibleSecondaryText()
            .fixedSize(horizontal: false, vertical: true)
        }

        if dynamicTypeSize.isAccessibilitySize {
          modePicker
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
          modePicker
            .pickerStyle(.segmented)
        }

        ModePortrait(mode: selectedMode)

        if let audioNotice = model.audioNotice {
          AudioNoticeView(notice: audioNotice)
        }

        if selectedMode == .timer {
          VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
            Text("practice.duration")
              .font(.headline)
            LazyVGrid(
              columns: [GridItem(.adaptive(minimum: 66), spacing: 8)],
              spacing: 8
            ) {
              ForEach(TimerPreferences.presets, id: \.self) { minutes in
                Button {
                  timerMinutes = minutes
                  if let intervalBellMinutes, intervalBellMinutes >= minutes {
                    self.intervalBellMinutes = nil
                  }
                } label: {
                  Text(
                    String(
                      format: AppLocalization.string("practice.minutes.format", locale: locale),
                      locale: locale,
                      minutes
                    )
                  )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                      timerMinutes == minutes ? AppTheme.moss : Color.secondary.opacity(0.08),
                      in: Capsule()
                    )
                    .foregroundStyle(timerMinutes == minutes ? Color.white : Color.primary)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("practice.duration.\(minutes)")
              }
            }
            Stepper(value: $timerMinutes, in: 1...180) {
              Text(
                String(
                  format: AppLocalization.string("practice.custom.duration.format", locale: locale),
                  locale: locale,
                  timerMinutes
                )
              )
            }
            .onChange(of: timerMinutes) { _, minutes in
              if let intervalBellMinutes, intervalBellMinutes >= minutes {
                self.intervalBellMinutes = nil
              }
            }
            if timerMinutes < 3 {
              Label("practice.short.note", systemImage: "leaf")
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Divider()

            Picker("practice.preparation", selection: $preparation) {
              ForEach(PreparationDuration.allCases, id: \.rawValue) { duration in
                Text(preparationTitle(duration)).tag(duration)
              }
            }

            Picker("practice.interval", selection: $intervalBellMinutes) {
              Text("practice.interval.off").tag(Int?.none)
              ForEach(intervalOptions, id: \.self) { minutes in
                Text(intervalTitle(minutes))
                .tag(Int?.some(minutes))
              }
            }

            Toggle("practice.opening.bell", isOn: $openingBellEnabled)
            Toggle("practice.closing.bell", isOn: $closingBellEnabled)
            Toggle("practice.ambience", isOn: $ambienceEnabled)
            Toggle("practice.mix.other.audio", isOn: $mixWithOthers)
            Toggle("practice.haptics", isOn: $hapticsEnabled)
            Toggle("practice.background.end.alert", isOn: $backgroundEndAlertEnabled)
              .onChange(of: backgroundEndAlertEnabled) { _, enabled in
                guard enabled else { return }
                Task {
                  if !(await model.requestTimerEndAlertAuthorization()) {
                    backgroundEndAlertEnabled = false
                  }
                }
              }
            if !ambienceEnabled && !backgroundEndAlertEnabled {
              Text("practice.background.end.note")
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
          }
          .quietCard()
        } else if selectedMode == .guided {
          VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
            if model.guidedPractices.isEmpty {
              Label("guided.catalog.unavailable", systemImage: "exclamationmark.triangle")
                .foregroundStyle(.secondary)
            } else {
              NavigationLink {
                GuidedLibraryView(model: model)
              } label: {
                HStack {
                  HStack(spacing: 8) {
                    Image(systemName: "waveform")
                      .accessibilityHidden(true)
                    Text("guided.library.browse")
                      .lineLimit(nil)
                      .fixedSize(horizontal: false, vertical: true)
                  }
                  .padding(.vertical, 2)
                  Spacer()
                  Text(
                    String(
                      format: AppLocalization.string("guided.catalog.count.format", locale: locale),
                      locale: locale,
                      model.guidedPractices.count
                    )
                  )
                  .font(.body.weight(.semibold))
                  .foregroundStyle(.primary)
                  .fixedSize(horizontal: false, vertical: true)
                }
              }
              .accessibilityIdentifier("guided.library.open")
              .accessibilityHint(Text("guided.library.detail"))
              Text("guided.library.detail")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color(uiColor: .label))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("guided.library.detail")
                .accessibilityHidden(true)
            }
          }
          .quietCard()
        }

        if selectedMode != .guided {
          Button {
            Task {
              if selectedMode == .timer {
                do {
                  let audio = try MeditationAudioConfiguration(
                    openingBellEnabled: openingBellEnabled,
                    closingBellEnabled: closingBellEnabled,
                    intervalBellMinutes: intervalBellMinutes,
                    ambienceID: ambienceEnabled ? "still-air-v1" : nil,
                    ambienceVolume: 0.3,
                    otherAudioPolicy: mixWithOthers ? .mixWithOthers : .pauseOthers,
                    hapticsEnabled: hapticsEnabled,
                    backgroundEndAlertEnabled: backgroundEndAlertEnabled
                  )
                  let preferences = try TimerPreferences(
                    durationMinutes: timerMinutes,
                    preparation: preparation,
                    audio: audio
                  )
                  await model.saveTimerPreferences(preferences)
                  try await model.startPractice(
                    mode: .timer,
                    targetMinutes: preferences.durationMinutes,
                    configuration: MeditationSessionConfiguration(
                      preparation: preferences.preparation,
                      audio: preferences.audio
                    )
                  )
                } catch {
                  return
                }
              } else {
                await model.beginPractice(
                  mode: selectedMode,
                  targetMinutes: selectedMode == .guided ? 3 : nil
                )
              }
            }
          } label: {
            Label("practice.start", systemImage: "play.fill")
              .frame(maxWidth: .infinity)
          }
          .prominentActionButton()
          .controlSize(.large)
          .accessibilityIdentifier("practice.start")
        }
      }
      .padding(AppTheme.Spacing.generous)
      .frame(maxWidth: AppTheme.maximumReadableWidth)
      .frame(maxWidth: .infinity)
    }
    .background(Color("LaunchBackground").ignoresSafeArea())
  }

  private func title(for mode: PracticeMode) -> LocalizedStringKey {
    switch mode {
    case .guided: "mode.guided"
    case .timer: "mode.timer"
    case .stopwatch: "mode.stopwatch"
    }
  }

  private var intervalOptions: [Int] {
    [1, 2, 3, 5, 10, 15, 20, 30, 45, 60].filter { $0 < timerMinutes }
  }

  private func preparationTitle(_ duration: PreparationDuration) -> String {
    guard duration != .off else {
      return AppLocalization.string("practice.preparation.immediate", locale: locale)
    }
    return String(
      format: AppLocalization.string("practice.preparation.seconds.format", locale: locale),
      locale: locale,
      duration.rawValue
    )
  }

  private func intervalTitle(_ minutes: Int) -> String {
    guard minutes != 1 else {
      return AppLocalization.string("practice.interval.one.minute", locale: locale)
    }
    return String(
      format: AppLocalization.string("practice.interval.minutes.format", locale: locale),
      locale: locale,
      minutes
    )
  }

  private var modePicker: some View {
    Picker("practice.title", selection: $selectedMode) {
      ForEach(availableModes, id: \.rawValue) { mode in
        Text(title(for: mode)).tag(mode)
      }
    }
    .accessibilityIdentifier("practice.mode")
  }
}

private struct ModePortrait: View {
  let mode: PracticeMode
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
          portraitSymbol
            .frame(width: 84, height: 84)
          portraitCopy
        }
      } else {
        HStack(spacing: AppTheme.Spacing.generous) {
          portraitSymbol
            .frame(width: 104, height: 104)
          portraitCopy
          Spacer(minLength: 0)
        }
      }
    }
    .quietCard()
  }

  private var portraitSymbol: some View {
    ZStack {
      Circle().fill(AppTheme.moss.opacity(0.12))
      Circle().stroke(AppTheme.moss.opacity(0.24), lineWidth: 1).padding(9)
      Image(systemName: icon)
        .font(.system(size: 34, weight: .light))
        .foregroundStyle(.tint)
    }
  }

  private var portraitCopy: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.title2.bold())
        .fixedSize(horizontal: false, vertical: true)
      Text(detail)
        .font(.body)
        .accessibleSecondaryText()
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var title: LocalizedStringKey {
    switch mode {
    case .guided: "mode.guided"
    case .timer: "mode.timer"
    case .stopwatch: "mode.stopwatch"
    }
  }

  private var detail: LocalizedStringKey {
    switch mode {
    case .guided: "mode.guided.detail"
    case .timer: "mode.timer.detail"
    case .stopwatch: "mode.stopwatch.detail"
    }
  }

  private var icon: String {
    switch mode {
    case .guided: "waveform"
    case .timer: "timer"
    case .stopwatch: "stopwatch"
    }
  }
}

private struct ActivePracticeView: View {
  let model: AppModel
  let session: MeditationSession
  @Environment(\.locale) private var locale
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var captionTimeline: GuidedCaptionTimeline?
  @State private var presentedTranscript: GuidedCaptionTimeline?
  @State private var showsEndEarlyConfirmation = false
  @State private var narrationVolume = 1.0
  @State private var ambienceVolume: Double

  init(model: AppModel, session: MeditationSession) {
    self.model = model
    self.session = session
    _ambienceVolume = State(initialValue: session.configuration.audio.ambienceVolume)
  }

  private var qualifies: Bool {
    model.elapsedMilliseconds >= PracticeEvent.qualificationMilliseconds
  }

  private var progress: Double {
    let target =
      session.targetDurationMilliseconds
      ?? max(
        PracticeEvent.qualificationMilliseconds,
        model.elapsedMilliseconds
      )
    return min(1, Double(model.elapsedMilliseconds) / Double(max(1, target)))
  }

  private var displayedMilliseconds: Int64 {
    guard let target = session.targetDurationMilliseconds else {
      return model.elapsedMilliseconds
    }
    return max(0, target - model.elapsedMilliseconds)
  }

  private var timerLabel: LocalizedStringKey {
    session.targetDurationMilliseconds == nil ? "session.elapsed" : "session.remaining"
  }

  private var transcriptIdentity: String? {
    guard session.mode == .guided,
      let practiceID = session.guidedContentID,
      let languageCode = session.configuration.audio.narrationLanguageCode
    else { return nil }
    return "\(practiceID)-\(languageCode)"
  }

  var body: some View {
    ZStack {
      GardenBackdrop()
      if session.phase == .prepared {
        PreparationCountdownView(model: model)
      } else {
        GeometryReader { proxy in
          ScrollView {
            VStack(spacing: AppTheme.Spacing.spacious) {
              Spacer(minLength: AppTheme.Spacing.generous)
          Label(modeTitle(session.mode), systemImage: modeIcon(session.mode))
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("session.mode")
          ZStack {
            Circle()
              .stroke(AppTheme.forest.opacity(0.12), lineWidth: 13)
            Circle()
              .trim(from: 0, to: progress)
              .stroke(
                qualifies ? AppTheme.amber : AppTheme.moss,
                style: StrokeStyle(lineWidth: 13, lineCap: .round)
              )
              .rotationEffect(.degrees(-90))
            VStack(spacing: 6) {
              Text(timerLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
              Text(Self.timeString(displayedMilliseconds))
                .font(.system(size: 48, weight: .medium, design: .rounded).monospacedDigit())
                .contentTransition(.numericText(countsDown: session.targetDurationMilliseconds != nil))
                .accessibilityIdentifier("session.timer")
                .accessibilityLabel(Text(timerLabel))
                .accessibilityValue(
                  Self.accessibilityTimeString(displayedMilliseconds, locale: locale)
                )
            }
          }
          .frame(width: 236, height: 236)

          Group {
            if qualifies {
              Label("session.qualifies", systemImage: "leaf.fill")
                .foregroundStyle(.tint)
                .accessibilityIdentifier("session.qualifies")
            } else {
              let remaining = PracticeEvent.qualificationMilliseconds - model.elapsedMilliseconds
              Text(
                String(
                  format: AppLocalization.string("session.qualifies.in.format", locale: locale),
                  locale: locale,
                  Self.timeString(remaining)
                )
              )
              .foregroundStyle(.secondary)
            }
          }
          .font(.subheadline.weight(.semibold))

          if session.mode == .guided, let captionTimeline {
            VStack(spacing: AppTheme.Spacing.compact) {
              if let cue = captionTimeline.cue(at: model.elapsedMilliseconds) {
                Text(cue.text)
                  .font(.title3)
                  .multilineTextAlignment(.center)
                  .fixedSize(horizontal: false, vertical: true)
                  .accessibilityIdentifier("session.caption")
              }
              Button {
                presentedTranscript = captionTimeline
              } label: {
                Label("session.transcript", systemImage: "captions.bubble")
              }
              .buttonStyle(.bordered)
              .accessibilityIdentifier("session.transcript")
            }
            .frame(maxWidth: 520)
          }

          if session.mode == .guided || session.configuration.audio.ambienceID != nil {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
              if session.mode == .guided {
                audioSlider(
                  title: "session.voice.volume",
                  systemImage: "waveform",
                  value: $narrationVolume,
                  identifier: "session.voice.volume"
                ) { model.setNarrationVolume($0) }
              }
              if session.configuration.audio.ambienceID != nil {
                audioSlider(
                  title: "session.ambience.volume",
                  systemImage: "wind",
                  value: $ambienceVolume,
                  identifier: "session.ambience.volume"
                ) { model.setAmbienceVolume($0) }
              }
            }
            .frame(maxWidth: 460)
            .quietCard()
          }

          if let notice = model.audioNotice {
            AudioNoticeView(notice: notice)
              .frame(maxWidth: 460)
          }

          HStack(spacing: AppTheme.Spacing.standard) {
            if session.phase == .paused {
              Button {
                Task { await model.resumePractice() }
              } label: {
                Label("session.resume", systemImage: "play.fill")
                  .frame(maxWidth: .infinity)
              }
              .accessibilityIdentifier("session.resume")
            } else {
              Button {
                Task { await model.pausePractice() }
              } label: {
                Label("session.pause", systemImage: "pause.fill")
                  .frame(maxWidth: .infinity)
              }
              .accessibilityIdentifier("session.pause")
            }

            Button {
              if qualifies {
                Task { await model.finishPractice() }
              } else {
                showsEndEarlyConfirmation = true
              }
            } label: {
              Text(qualifies ? "session.finish" : "session.end.early")
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("session.finish")
          }
          .buttonStyle(.bordered)
          .controlSize(.large)
          .frame(maxWidth: 460)
              Spacer(minLength: AppTheme.Spacing.generous)
            }
            .padding(AppTheme.Spacing.generous)
            .frame(minHeight: proxy.size.height)
            .frame(maxWidth: .infinity)
          }
          .scrollDismissesKeyboard(.interactively)
        }
      }
    }
    .task(id: transcriptIdentity) {
      guard let practiceID = session.guidedContentID,
        let languageCode = session.configuration.audio.narrationLanguageCode
      else {
        captionTimeline = nil
        return
      }
      captionTimeline = GuidedCaptionLoader.load(
        practiceID: practiceID,
        languageCode: languageCode
      )
    }
    .sheet(item: $presentedTranscript) { timeline in
      GuidedTranscriptView(timeline: timeline, elapsedMilliseconds: model.elapsedMilliseconds)
    }
    .confirmationDialog(
      "session.end.early.confirm.title",
      isPresented: $showsEndEarlyConfirmation,
      titleVisibility: .visible
    ) {
      Button("session.end.early.confirm.action", role: .destructive) {
        Task { await model.finishPractice() }
      }
      Button("common.cancel", role: .cancel) {}
    } message: {
      Text("session.end.early.confirm.body")
    }
    .animation(
      AppMotion.quick(
        reduceMotion: reduceMotion || UITestAccessibilityOverrides.reduceMotion
      ),
      value: session.phase
    )
    .animation(
      AppMotion.gentle(
        reduceMotion: reduceMotion || UITestAccessibilityOverrides.reduceMotion
      ),
      value: qualifies
    )
  }

  private func audioSlider(
    title: LocalizedStringKey,
    systemImage: String,
    value: Binding<Double>,
    identifier: String,
    onChange: @escaping (Double) -> Void
  ) -> some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.compact) {
      HStack {
        Label(title, systemImage: systemImage)
        Spacer()
        Text(value.wrappedValue, format: .percent.precision(.fractionLength(0)))
          .foregroundStyle(.secondary)
          .monospacedDigit()
      }
      Slider(value: value, in: 0...1, step: 0.05)
        .onChange(of: value.wrappedValue) { _, newValue in onChange(newValue) }
        .accessibilityIdentifier(identifier)
    }
  }

  static func timeString(_ milliseconds: Int64) -> String {
    let seconds = max(0, milliseconds / 1_000)
    return String(format: "%02lld:%02lld", seconds / 60, seconds % 60)
  }

  static func accessibilityTimeString(
    _ milliseconds: Int64,
    locale: Locale = .current
  ) -> String {
    let seconds = max(0, milliseconds / 1_000)
    return String(
      format: AppLocalization.string("session.elapsed.accessibility.format", locale: locale),
      locale: locale,
      seconds / 60,
      seconds % 60
    )
  }

  private func modeTitle(_ mode: PracticeMode) -> LocalizedStringKey {
    switch mode {
    case .guided: "mode.guided"
    case .timer: "mode.timer"
    case .stopwatch: "mode.stopwatch"
    }
  }

  private func modeIcon(_ mode: PracticeMode) -> String {
    switch mode {
    case .guided: "waveform"
    case .timer: "timer"
    case .stopwatch: "stopwatch"
    }
  }
}

private struct GuidedTranscriptView: View {
  let timeline: GuidedCaptionTimeline
  let elapsedMilliseconds: Int64
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List(timeline.cues) { cue in
        let isCurrent = cue.startMilliseconds <= elapsedMilliseconds
          && elapsedMilliseconds < cue.endMilliseconds
        HStack(alignment: .firstTextBaseline, spacing: AppTheme.Spacing.standard) {
          Image(systemName: isCurrent ? "speaker.wave.2.fill" : "circle.fill")
            .font(isCurrent ? .body : .system(size: 5))
            .foregroundStyle(isCurrent ? Color.accentColor : Color.secondary)
            .frame(width: 22)
            .accessibilityHidden(true)
          Text(cue.text)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
      }
      .navigationTitle("session.transcript")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("common.done") { dismiss() }
        }
      }
    }
  }
}

private struct PreparationCountdownView: View {
  let model: AppModel
  @Environment(\.locale) private var locale

  var body: some View {
    VStack(spacing: AppTheme.Spacing.spacious) {
      Spacer()
      Text("session.preparing")
        .font(.title2.bold())
      Text(
        String(
          format: AppLocalization.string("session.preparing.seconds.format", locale: locale),
          locale: locale,
          max(0, Int((model.preparationRemainingMilliseconds + 999) / 1_000))
        )
      )
      .font(.system(size: 64, weight: .medium, design: .rounded).monospacedDigit())
      .accessibilityIdentifier("session.preparation")
      Text("session.preparing.body")
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("session.cancel") {
        Task { await model.finishPractice() }
      }
      .buttonStyle(.bordered)
      .controlSize(.large)
      Spacer()
    }
    .padding(AppTheme.Spacing.generous)
  }
}

private struct AudioNoticeView: View {
  let notice: AppModel.AudioNotice

  var body: some View {
    Label(text, systemImage: icon)
      .font(.footnote)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(AppTheme.Spacing.standard)
      .background(AppTheme.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
      .accessibilityIdentifier("session.audio.notice")
  }

  private var text: LocalizedStringKey {
    switch notice {
    case .guidedNarrationPendingApproval: "audio.notice.guided.pending"
    case .playbackUnavailable: "audio.notice.unavailable"
    case .interrupted: "audio.notice.interrupted"
    case .outputRouteLost: "audio.notice.route.lost"
    case .audioSystemReset: "audio.notice.system.reset"
    case .guidedInterrupted: "audio.notice.guided.interrupted"
    case .guidedOutputRouteLost: "audio.notice.guided.route.lost"
    case .guidedAudioSystemReset: "audio.notice.guided.system.reset"
    case .backgroundEndAlertDenied: "audio.notice.background.alert.denied"
    case .guidedCatalogUnavailable: "audio.notice.guided.catalog.unavailable"
    }
  }

  private var icon: String {
    switch notice {
    case .guidedNarrationPendingApproval: "waveform.badge.exclamationmark"
    case .playbackUnavailable, .audioSystemReset, .guidedAudioSystemReset: "speaker.slash"
    case .interrupted: "pause.circle"
    case .outputRouteLost: "headphones.slash"
    case .guidedInterrupted: "pause.circle"
    case .guidedOutputRouteLost: "headphones.slash"
    case .backgroundEndAlertDenied: "bell.slash"
    case .guidedCatalogUnavailable: "doc.badge.exclamationmark"
    }
  }
}

private struct PracticeCompletionView: View {
  let model: AppModel
  let completion: AppModel.CompletionPresentation

  var body: some View {
    ZStack {
      GardenBackdrop()
      VStack(spacing: AppTheme.Spacing.generous) {
        Spacer()
        ZStack {
          Circle().fill(AppTheme.amber.opacity(0.15))
          Image(systemName: completion.qualifiedForGrowth ? "tree.fill" : "checkmark")
            .font(.system(size: 48, weight: .light))
            .foregroundStyle(.tint)
        }
        .frame(width: 132, height: 132)

        VStack(spacing: 8) {
          Text(completion.qualifiedForGrowth ? "session.completed.title" : "session.short.title")
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
            .multilineTextAlignment(.center)
            .accessibilityIdentifier("session.completed")
          Text(completion.qualifiedForGrowth ? "session.completed.body" : "session.short.body")
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 420)
        }

        Button("session.reflect") {
          model.beginReflectionFromCompletion()
        }
        .prominentActionButton()
        .controlSize(.large)
        .accessibilityIdentifier("session.reflect")

        Button("session.return.garden") {
          model.dismissCompletion(showGarden: true)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .accessibilityIdentifier("session.return.garden")

        Button("common.done") {
          model.dismissCompletion(showGarden: false)
        }
        Spacer()
      }
      .padding(AppTheme.Spacing.generous)
    }
  }
}

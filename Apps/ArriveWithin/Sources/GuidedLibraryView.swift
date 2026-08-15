import ArriveWithinContent
import SwiftUI

struct GuidedLibraryView: View {
  @Bindable var model: AppModel
  @State private var searchText = ""
  @State private var selectedCategory: GuidedCategory?
  @State private var durationFilter: DurationFilter = .all
  @State private var favoritesOnly = false
  @Environment(\.dismiss) private var dismiss
  @Environment(\.locale) private var locale

  private var language: GuidedLanguage {
    locale.language.languageCode?.identifier == "de" ? .german : .english
  }

  private var filteredPractices: [GuidedPractice] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    let recentRanks = recentPracticeRanks
    return model.guidedPractices.filter { practice in
      let text = practice.localized[language]
      let matchesQuery =
        query.isEmpty
        || text.title.localizedCaseInsensitiveContains(query)
        || text.purpose.localizedCaseInsensitiveContains(query)
        || practice.purposeTags.contains(where: {
          $0.localizedCaseInsensitiveContains(query)
        })
      let matchesCategory = selectedCategory.map { practice.category == $0 } ?? true
      let matchesDuration = durationFilter.contains(practice.targetMinutes)
      let matchesFavorite = !favoritesOnly || model.favoriteGuidedPracticeIDs.contains(practice.id)
      return matchesQuery && matchesCategory && matchesDuration && matchesFavorite
    }
    .sorted { lhs, rhs in
      let lhsRank = recentRanks[lhs.id] ?? Int.max
      let rhsRank = recentRanks[rhs.id] ?? Int.max
      if lhsRank != rhsRank { return lhsRank < rhsRank }
      return lhs.id < rhs.id
    }
  }

  private var recentPracticeRanks: [String: Int] {
    var result: [String: Int] = [:]
    for item in model.journeyProjection?.history ?? [] {
      guard let practiceID = item.guidedContentID, result[practiceID] == nil else { continue }
      result[practiceID] = result.count
    }
    return result
  }

  var body: some View {
    let visiblePractices = filteredPractices
    let recentPracticeIDs = Set(recentPracticeRanks.keys)
    List {
      Section {
        TextField("guided.search.prompt", text: $searchText)
          .textFieldStyle(.roundedBorder)
          .accessibilityIdentifier("guided.search")
        Picker("guided.filter.category", selection: $selectedCategory) {
          Text("guided.filter.all.categories").tag(GuidedCategory?.none)
          ForEach(GuidedCategory.allCases, id: \.rawValue) { category in
            Text(categoryTitle(category)).tag(GuidedCategory?.some(category))
          }
        }
        Picker("guided.filter.duration", selection: $durationFilter) {
          ForEach(DurationFilter.allCases) { filter in
            Text(filter.title).tag(filter)
          }
        }
        Toggle("guided.filter.favorites", isOn: $favoritesOnly)
      }

      Section {
        if visiblePractices.isEmpty {
          ContentUnavailableView(
            "guided.empty.title",
            systemImage: "leaf",
            description: Text("guided.empty.body")
          )
        } else {
          ForEach(visiblePractices) { practice in
            NavigationLink {
              GuidedPracticeDetailView(
                model: model,
                practice: practice,
                initialLanguage: language
              )
            } label: {
              GuidedPracticeRow(
                practice: practice,
                language: language,
                favorite: model.favoriteGuidedPracticeIDs.contains(practice.id),
                recent: recentPracticeIDs.contains(practice.id)
              )
            }
            .accessibilityIdentifier("guided.row.\(practice.id)")
          }
        }
      } header: {
        Text(
          String(
            format: AppLocalization.string("guided.results.count.format", locale: locale),
            locale: locale,
            visiblePractices.count
          )
        )
      }
    }
    .navigationTitle("guided.library.title")
    .accessibilityIdentifier("guided.library")
    .onChange(of: model.activeSession?.id) { _, sessionID in
      guard sessionID != nil else { return }
      // Begin is initiated from a detail destination nested inside this
      // library. Return to the Practice root so the active player is visible
      // instead of leaving it behind the browsing stack.
      dismiss()
    }
  }

  private func categoryTitle(_ category: GuidedCategory) -> LocalizedStringKey {
    switch category {
    case .foundations: "guided.category.foundations"
    case .calm: "guided.category.calm"
    case .body: "guided.category.body"
    case .focus: "guided.category.focus"
    case .selfKindness: "guided.category.self-kindness"
    case .emotions: "guided.category.emotions"
    case .morning: "guided.category.morning"
    case .evening: "guided.category.evening"
    case .sleep: "guided.category.sleep"
    }
  }
}

private struct GuidedPracticeRow: View {
  let practice: GuidedPractice
  let language: GuidedLanguage
  let favorite: Bool
  let recent: Bool
  @Environment(\.locale) private var locale

  var body: some View {
    let text = practice.localized[language]
    HStack(alignment: .top, spacing: AppTheme.Spacing.standard) {
      VStack(alignment: .leading, spacing: 5) {
        Text(text.title)
          .font(.headline)
        Text(text.purpose)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(2)
        HStack(spacing: 10) {
          Label(
            String(
              format: AppLocalization.string("practice.minutes.format", locale: locale),
              locale: locale,
              practice.targetMinutes
            ),
            systemImage: "clock"
          )
          Text(categoryTitle(practice.category))
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      VStack(spacing: AppTheme.Spacing.compact) {
        if favorite {
          Image(systemName: "heart.fill")
            .foregroundStyle(AppTheme.amber)
            .accessibilityLabel("guided.favorite.on")
        }
        if recent {
          Image(systemName: "clock.arrow.circlepath")
            .foregroundStyle(.secondary)
            .accessibilityLabel("guided.recent")
        }
      }
    }
    .padding(.vertical, 3)
  }

  private func categoryTitle(_ category: GuidedCategory) -> LocalizedStringKey {
    switch category {
    case .foundations: "guided.category.foundations"
    case .calm: "guided.category.calm"
    case .body: "guided.category.body"
    case .focus: "guided.category.focus"
    case .selfKindness: "guided.category.self-kindness"
    case .emotions: "guided.category.emotions"
    case .morning: "guided.category.morning"
    case .evening: "guided.category.evening"
    case .sleep: "guided.category.sleep"
    }
  }
}

private struct GuidedPracticeDetailView: View {
  @Bindable var model: AppModel
  let practice: GuidedPractice
  @State private var language: GuidedLanguage
  @State private var ambienceEnabled = false
  @State private var ambienceVolume = 0.18
  @Environment(\.dismiss) private var dismiss
  @Environment(\.locale) private var locale
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  init(model: AppModel, practice: GuidedPractice, initialLanguage: GuidedLanguage) {
    self.model = model
    self.practice = practice
    _language = State(initialValue: initialLanguage)
  }

  private var text: GuidedPracticeText { practice.localized[language] }

  private var approvedAudioURL: URL? {
    guard text.editorialState.isPackagedForPlayback else { return nil }
    return BundledAudioAssetResolver.approvedNarrationURL(
      bundle: .main,
      contentID: practice.id,
      languageCode: language.rawValue
    )
  }

  private var narrationIsAvailable: Bool { approvedAudioURL != nil }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
        VStack(alignment: .leading, spacing: 8) {
          Text(text.title)
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
          Text(text.purpose)
            .font(.title3)
            .foregroundStyle(.secondary)
          Label(
            String(
              format: AppLocalization.string("practice.minutes.format", locale: locale),
              locale: locale,
              practice.targetMinutes
            ),
            systemImage: "clock"
          )
        }

        if dynamicTypeSize.isAccessibilitySize {
          languagePicker
            .pickerStyle(.menu)
        } else {
          languagePicker
            .pickerStyle(.segmented)
        }

        VStack(alignment: .leading, spacing: 8) {
          Label(
            narrationIsAvailable ? "guided.offline.ready" : "guided.offline.pending",
            systemImage: narrationIsAvailable ? "arrow.down.circle.fill" : "clock.badge"
          )
          Text(text.accessibilitySummary)
            .foregroundStyle(.secondary)
          Text("guided.safety.nonclinical")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .quietCard()

        VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
          Toggle("practice.ambience", isOn: $ambienceEnabled)
            .accessibilityIdentifier("guided.ambience")
          if ambienceEnabled {
            HStack {
              Label("session.ambience.volume", systemImage: "waveform")
              Spacer()
              Text(ambienceVolume, format: .percent.precision(.fractionLength(0)))
                .foregroundStyle(.secondary)
                .monospacedDigit()
            }
            Slider(value: $ambienceVolume, in: 0...0.6, step: 0.05)
              .accessibilityIdentifier("guided.ambience.volume")
          }
        }
        .quietCard()

        Button {
          Task { await model.toggleFavorite(practiceID: practice.id) }
        } label: {
          Label(
            model.favoriteGuidedPracticeIDs.contains(practice.id)
              ? "guided.favorite.remove" : "guided.favorite.add",
            systemImage: model.favoriteGuidedPracticeIDs.contains(practice.id)
              ? "heart.fill" : "heart"
          )
        }
        .buttonStyle(.bordered)

        Button {
          Task {
            let started = await model.startGuidedPractice(
              practiceID: practice.id,
              language: language,
              ambienceEnabled: ambienceEnabled,
              ambienceVolume: ambienceVolume
            )
            guard started else { return }
            dismiss()
            await Task.yield()
            dismiss()
          }
        } label: {
          Label("guided.begin", systemImage: "play.fill")
            .frame(maxWidth: .infinity)
        }
        .prominentActionButton()
        .controlSize(.large)
        .disabled(!narrationIsAvailable)
        .accessibilityIdentifier("guided.begin.\(practice.id)")

        if !narrationIsAvailable {
          Text("guided.pending.explanation")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .padding(AppTheme.Spacing.generous)
      .frame(maxWidth: AppTheme.maximumReadableWidth, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(Color("LaunchBackground").ignoresSafeArea())
    .navigationTitle(practice.id)
    .navigationBarTitleDisplayMode(.inline)
  }

  private var languagePicker: some View {
    Picker("guided.language", selection: $language) {
      Text("guided.language.en").tag(GuidedLanguage.english)
      Text("guided.language.de").tag(GuidedLanguage.german)
    }
  }
}

private enum DurationFilter: String, CaseIterable, Identifiable {
  case all
  case short
  case medium
  case long

  var id: String { rawValue }

  var title: LocalizedStringKey {
    switch self {
    case .all: "guided.duration.all"
    case .short: "guided.duration.short"
    case .medium: "guided.duration.medium"
    case .long: "guided.duration.long"
    }
  }

  func contains(_ minutes: Int) -> Bool {
    switch self {
    case .all: true
    case .short: minutes <= 5
    case .medium: (6...10).contains(minutes)
    case .long: minutes >= 11
    }
  }
}

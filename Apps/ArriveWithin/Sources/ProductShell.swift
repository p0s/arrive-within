import SwiftUI

struct ProductShell: View {
  @Bindable var model: AppModel
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      if horizontalSizeClass == .regular {
        TabletShell(model: model)
      } else {
        PhoneShell(model: model)
      }
    }
    .overlay(alignment: .topLeading) {
      captureProvenance
    }
  }

  @ViewBuilder
  private var captureProvenance: some View {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-ui-test-capture-provenance") {
        let info = Bundle.main.infoDictionary ?? [:]
        let label = [
          "source_commit=\(info["V2N_BUILD_SOURCE_COMMIT"] as? String ?? "")",
          "source_revision=\(info["V2N_CAPTURE_SOURCE_REVISION"] as? String ?? "")",
          "bundle_id=\(Bundle.main.bundleIdentifier ?? "")",
          "marketing_version=\(info["CFBundleShortVersionString"] as? String ?? "")",
          "build_number=\(info["CFBundleVersion"] as? String ?? "")",
          "appearance=\(colorScheme == .dark ? "dark" : "light")",
        ] + model.simulatorMarketingClockProvenance
        let provenanceLabel = label.joined(separator: ";")
        Text(provenanceLabel)
          .font(.system(size: 1))
          .foregroundStyle(.clear)
          .frame(width: 1, height: 1)
          .accessibilityElement()
          .accessibilityIdentifier("marketing.capture.provenance")
          .accessibilityLabel(provenanceLabel)
      }
    #endif
  }
}

private struct PhoneShell: View {
  @Bindable var model: AppModel
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    TabView(selection: $model.selectedSection) {
      ForEach(AppSection.allCases) { section in
        NavigationStack {
          SectionDestination(section: section, model: model)
            .environment(\.dynamicTypeSize, dynamicTypeSize)
        }
        .tabItem {
          Label(section.title, systemImage: section.systemImage)
            .dynamicTypeSize(.xSmall ... .xxxLarge)
            .accessibilityIdentifier("navigation.tab.\(section.rawValue)")
        }
        .tag(section)
      }
    }
    .accessibilityIdentifier("navigation.tabs")
  }
}

private struct TabletShell: View {
  @Bindable var model: AppModel
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var columnVisibility: NavigationSplitViewVisibility = .detailOnly

  var body: some View {
    NavigationSplitView(columnVisibility: $columnVisibility) {
      List(AppSection.allCases) { section in
        Button {
          withAnimation(
            AppMotion.quick(
              reduceMotion: reduceMotion || UITestAccessibilityOverrides.reduceMotion
            )
          ) {
            model.selectedSection = section
          }
        } label: {
          Label(section.title, systemImage: section.systemImage)
            .foregroundStyle(section == model.selectedSection ? Color.white : Color.primary)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
              section == model.selectedSection ? AppTheme.forest : Color.clear,
              in: RoundedRectangle(cornerRadius: AppTheme.Radius.standard, style: .continuous)
            )
            .accessibilityIdentifier("navigation.sidebar.\(section.rawValue)")
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(section == model.selectedSection ? .isSelected : [])
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
      }
      .listStyle(.sidebar)
      .navigationTitle("Arrive Within")
      .navigationSplitViewColumnWidth(
        min: dynamicTypeSize.isAccessibilitySize ? 300 : 190,
        ideal: dynamicTypeSize.isAccessibilitySize ? 340 : 230,
        max: dynamicTypeSize.isAccessibilitySize ? 380 : 280
      )
    } detail: {
      NavigationStack {
        SectionDestination(section: model.selectedSection, model: model)
      }
    }
    .onChange(of: model.selectedSection) { _, section in
      columnVisibility = section == .garden ? .detailOnly : .all
    }
  }
}

private struct SectionDestination: View {
  let section: AppSection
  let model: AppModel
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      switch section {
      case .garden:
        GardenView(model: model)
      case .practice:
        PracticeView(model: model)
      case .journey:
        JourneyView(model: model)
      case .journal:
        JournalView(model: model)
      }
    }
    .toolbar {
      if section != .garden {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink {
            SettingsView(model: model)
          } label: {
            Label("garden.settings", systemImage: "gearshape")
          }
          .keyboardShortcut(",", modifiers: .command)
          .accessibilityIdentifier("garden.settings")
        }
      }
    }
    .onAppear {
      #if DEBUG
        let surface = section == .garden ? "garden" : section == .journey ? "journey" : section.rawValue
        model.reportMarketingCaptureSurfaceAppeared(
          surface,
          actualAppearance: colorScheme == .dark ? "dark" : "light"
        )
      #endif
    }
  }
}

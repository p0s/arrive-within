import ArriveWithinDomain
import Foundation
import SwiftUI

struct GardenView: View {
  let model: AppModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.locale) private var locale
  @Environment(\.scenePhase) private var scenePhase

  private var effectiveReduceMotion: Bool {
    reduceMotion || UITestAccessibilityOverrides.reduceMotion
  }

  private var usesNativeFallback: Bool {
    model.forceNativeGarden || model.rendererFailureMessage != nil
  }

  var body: some View {
    ZStack {
      GardenBackdrop()
      if let state = model.gardenState {
        if usesNativeFallback {
          NativeGardenView(
            state: state,
            accessibilityDescription: model.gardenDescription()
          )
          .ignoresSafeArea(.container, edges: [.top, .bottom])
          .transition(.opacity)
        } else {
          GardenWebView(
            state: state,
            isActive: model.selectedSection == .garden && scenePhase == .active,
            resetViewRequest: 0,
            onReady: model.reportRendererReady,
            onFailure: model.reportRendererFailure,
            onObservation: model.reportRendererObservation
          )
          .id(model.rendererGeneration)
          .ignoresSafeArea(.container, edges: [.top, .bottom])
          .accessibilityLabel(Text("garden.renderer.web"))
          .accessibilityValue(Text(model.gardenDescription()))
          .accessibilityIdentifier(rendererAccessibilityIdentifier)
          .transition(.opacity)
        }

        overlayControls(state: state)
      }
    }
    .toolbar(.hidden, for: .navigationBar)
    .toolbarBackground(.ultraThinMaterial, for: .tabBar)
    .toolbarBackground(.visible, for: .tabBar)
    .task { await model.updateReduceMotion(effectiveReduceMotion) }
    .animation(AppMotion.gentle(reduceMotion: effectiveReduceMotion), value: usesNativeFallback)
    .onChange(of: reduceMotion) { _, value in
      Task { await model.updateReduceMotion(value || UITestAccessibilityOverrides.reduceMotion) }
    }
  }

  @ViewBuilder
  private func overlayControls(state: GardenState) -> some View {
    VStack(spacing: AppTheme.Spacing.compact) {
      HStack(alignment: .center, spacing: AppTheme.Spacing.compact) {
        HStack(spacing: 6) {
          Text(dayLabel(state.journeyDay))
          Text("·")
            .accessibilityHidden(true)
          Text(stageTitle(for: state.journeyDay))
            .accessibilityIdentifier("garden.stage")
        }
        .font(.footnote.weight(.semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.82)
        .foregroundStyle(.primary.opacity(0.88))
        .padding(.horizontal, 12)
        .frame(minHeight: AppTheme.Size.minimumTouchTarget)
        .background {
          Capsule().fill(.ultraThinMaterial)
        }

        Spacer()

        NavigationLink {
          SettingsView(model: model)
        } label: {
          Image(systemName: "gearshape")
            .font(.body.weight(.semibold))
            .frame(
              width: AppTheme.Size.minimumTouchTarget,
              height: AppTheme.Size.minimumTouchTarget
            )
            .background {
              AdaptiveCircleMaterial(material: .ultraThinMaterial)
            }
        }
        .keyboardShortcut(",", modifiers: .command)
        .accessibilityLabel(Text("garden.settings"))
        .accessibilityIdentifier("garden.settings")
      }

      Spacer(minLength: AppTheme.Spacing.compact)

      if usesNativeFallback {
        fallbackRecoveryControls
      }

      Button {
        model.selectedSection = .practice
      } label: {
        Label("garden.meditate", systemImage: "circle.hexagongrid.fill")
          .frame(maxWidth: 300)
          .foregroundStyle(.white)
      }
      .prominentActionButton()
      .controlSize(.large)
      .accessibilityIdentifier("garden.meditate")

      if horizontalSizeClass == .regular {
        floatingSectionNavigation
      }
    }
    .padding(.horizontal, AppTheme.Spacing.standard)
    .padding(.vertical, AppTheme.Spacing.compact)
  }

  private var floatingSectionNavigation: some View {
    HStack(spacing: 2) {
      ForEach(AppSection.allCases) { section in
        Button {
          withAnimation(AppMotion.quick(reduceMotion: effectiveReduceMotion)) {
            model.selectedSection = section
          }
        } label: {
          Label(section.title, systemImage: section.systemImage)
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: AppTheme.Size.minimumTouchTarget)
            .foregroundStyle(section == .garden ? Color.white : Color.primary)
            .background(
              section == .garden ? AppTheme.forest : Color.clear,
              in: Capsule()
            )
            .accessibilityIdentifier("navigation.sidebar.\(section.rawValue)")
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(section == .garden ? .isSelected : [])
      }
    }
    .padding(4)
    .background {
      Capsule().fill(.ultraThinMaterial)
    }
  }

  private var fallbackRecoveryControls: some View {
    VStack(spacing: 8) {
      Label("garden.renderer.unavailable", systemImage: "leaf")
        .font(.body.weight(.semibold))
        .foregroundStyle(Color(uiColor: .label))
        .fixedSize(horizontal: false, vertical: true)
        .multilineTextAlignment(.leading)
        .accessibilityIdentifier("garden.nativeFallback.message")
      Button {
        model.retryRenderer()
      } label: {
        Text("garden.renderer.retry")
          .font(.body.weight(.semibold))
          .foregroundStyle(.white)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.vertical, 2)
          .frame(maxWidth: .infinity, minHeight: AppTheme.Size.minimumTouchTarget)
          .contentShape(Rectangle())
      }
      .prominentActionButton()
      .controlSize(.regular)
      .accessibilityIdentifier("garden.renderer.retry")
      Button {
        model.prepareRendererDiagnosticsExport()
      } label: {
        Label("garden.renderer.diagnostics.prepare", systemImage: "doc.text.magnifyingglass")
          .fixedSize(horizontal: false, vertical: true)
          .multilineTextAlignment(.center)
          .padding(.vertical, 4)
      }
      .font(.footnote.weight(.semibold))
      .foregroundStyle(.primary)
      .frame(maxWidth: .infinity, minHeight: AppTheme.Size.minimumTouchTarget)
      .contentShape(Rectangle())
      .accessibilityIdentifier("garden.renderer.diagnostics.prepare")
      if let diagnostics = model.rendererDiagnosticsExportURL {
        ShareLink(item: diagnostics) {
          Label("garden.renderer.diagnostics.share", systemImage: "square.and.arrow.up")
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.center)
            .padding(.vertical, 4)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity, minHeight: AppTheme.Size.minimumTouchTarget)
        .contentShape(Rectangle())
        .accessibilityIdentifier("garden.renderer.diagnostics.share")
      }
      Text("garden.renderer.diagnostics.detail")
        .font(.body.weight(.semibold))
        .foregroundStyle(Color(uiColor: .label))
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 320)
    }
    .padding(12)
    .frame(maxWidth: 420)
    .background(
      AdaptiveRoundedSurface(cornerRadius: AppTheme.Radius.standard)
    )
  }

  private var rendererAccessibilityIdentifier: String {
    if model.rendererIsReady, model.rendererRecoveryCount > 0 {
      return "garden.renderer.recovered"
    }
    return model.rendererIsReady ? "garden.renderer.ready" : "garden.renderer.loading"
  }

  private func dayLabel(_ day: Int) -> String {
    String(
      format: AppLocalization.string("garden.day.format", locale: locale),
      locale: locale,
      day
    )
  }

  private func stageTitle(for day: Int) -> LocalizedStringKey {
    if day == 0 { return "garden.seed.title" }
    if day == 30 { return "garden.mature.title" }
    return "garden.growing.title"
  }
}

private struct NativeGardenView: View {
  let state: GardenState
  let accessibilityDescription: String

  var body: some View {
    GeometryReader { proxy in
      let size = min(proxy.size.width, proxy.size.height)
      ZStack {
        Ellipse()
          .fill(AppTheme.forest.opacity(0.16))
          .frame(width: size * 0.88, height: size * 0.25)
          .offset(y: size * 0.3)

        RoundedRectangle(cornerRadius: size * 0.04)
          .fill(
            LinearGradient(
              colors: [
                Color(red: 0.43, green: 0.31, blue: 0.22),
                Color(red: 0.31, green: 0.23, blue: 0.17),
              ],
              startPoint: .top,
              endPoint: .bottom
            )
          )
          .frame(
            width: size * (0.08 + Double(state.journeyDay) / 30 * 0.05),
            height: size * (0.28 + Double(state.journeyDay) / 30 * 0.2)
          )
          .offset(y: size * 0.11)

        ForEach(0..<clusterCount, id: \.self) { index in
          let angle = Double(index) * 2.399963
          let radius = size * (0.1 + Double(state.journeyDay) / 30 * 0.13)
          let scale = 0.72 + Double(index % 3) * 0.12
          Circle()
            .fill(canopyColor(index))
            .frame(width: size * 0.2 * scale, height: size * 0.17 * scale)
            .offset(
              x: cos(angle) * radius,
              y: -size * 0.13 + sin(angle) * radius * 0.46
            )
        }

        Circle()
          .stroke(AppTheme.amber.opacity(0.55), lineWidth: 2)
          .frame(width: size * 0.54, height: size * 0.54)
          .offset(y: size * 0.2)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text("garden.renderer.native"))
    .accessibilityValue(Text(accessibilityDescription))
  }

  private var clusterCount: Int {
    min(18, 3 + state.highestMilestone)
  }

  private func canopyColor(_ index: Int) -> Color {
    [AppTheme.forest, AppTheme.moss, AppTheme.sage][index % 3]
  }
}

import SwiftUI

struct PremiumGardenStylesView: View {
  @Bindable var model: AppModel
  @Environment(\.locale) private var locale
  @State private var requestedStyle: GardenRenderStyle?
  @State private var showsPaywall = false

  var body: some View {
    Form {
      Section {
        ForEach(GardenRenderStyle.allCases) { style in
          Button {
            choose(style)
          } label: {
            GardenStyleRow(
              style: style,
              isSelected: model.gardenRenderStyle == style,
              isLocked: style.isPremium && !model.premiumGardenAccess.isOwned
            )
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("garden.style.\(style.rawValue)")
        }
        if model.settingsNotice == .couldNotSaveGardenStyle {
          Label("settings.garden.style.save.error", systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("garden.styles.title")
      } footer: {
        Text("garden.styles.detail")
      }

      Section {
        if model.premiumGardenAccess.isOwned {
          Label("garden.styles.owned", systemImage: "checkmark.seal.fill")
            .foregroundStyle(.tint)
        } else {
          Button {
            requestedStyle = .handDrawn
            showsPaywall = true
          } label: {
            Label(premiumActionTitle, systemImage: "sparkles")
          }
          .disabled(
            model.premiumGardenPurchaseIsInProgress
              || !model.premiumGardenAccess.productIsAvailable
          )
          .accessibilityIdentifier("garden.styles.unlock")

          if !model.premiumGardenAccess.productIsAvailable {
            Text("garden.styles.unavailable")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }

        Button("garden.styles.restore") {
          Task { await model.restorePremiumGardenStyles() }
        }
        .disabled(model.premiumGardenPurchaseIsInProgress)
        .accessibilityIdentifier("garden.styles.restore")
      } footer: {
        Text("garden.styles.purchase.detail")
      }
    }
    .navigationTitle("garden.styles.title")
    .sheet(isPresented: $showsPaywall) {
      PremiumGardenPaywallView(model: model, requestedStyle: requestedStyle)
    }
    .alert(
      premiumNoticeText,
      isPresented: Binding(
        get: { model.premiumGardenNotice != nil },
        set: { if !$0 { model.dismissPremiumGardenNotice() } }
      )
    ) {
      Button("common.ok") { model.dismissPremiumGardenNotice() }
    }
  }

  private var premiumActionTitle: String {
    let price = model.premiumGardenAccess.displayPrice ?? PremiumGardenProduct.proposedUSDPrice
    return "\(AppLocalization.string("garden.styles.unlock", locale: locale)) · \(price)"
  }

  private var premiumNoticeText: LocalizedStringKey {
    switch model.premiumGardenNotice {
    case .purchasePending: "garden.styles.purchase.pending"
    case .purchaseFailed: "garden.styles.purchase.failed"
    case .restoreFoundNoPurchase: "garden.styles.restore.none"
    case .restoreFailed: "garden.styles.restore.failed"
    case nil: "common.error"
    }
  }

  private func choose(_ style: GardenRenderStyle) {
    if style.isPremium, !model.premiumGardenAccess.isOwned {
      requestedStyle = style
      showsPaywall = true
    } else {
      Task { await model.setGardenRenderStyle(style) }
    }
  }
}

private struct GardenStyleRow: View {
  let style: GardenRenderStyle
  let isSelected: Bool
  let isLocked: Bool

  var body: some View {
    HStack(spacing: 14) {
      GardenStyleSwatch(style: style)
        .frame(width: 64, height: 48)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 3) {
        Text(style.titleKey)
          .font(.body.weight(.semibold))
          .foregroundStyle(.primary)
        Text(style.detailKey)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }

      Spacer(minLength: 8)
      if isSelected {
        Image(systemName: "checkmark.circle.fill")
          .foregroundStyle(.tint)
          .accessibilityLabel(Text("garden.styles.selected"))
      } else if isLocked {
        Image(systemName: "lock.fill")
          .foregroundStyle(.secondary)
          .accessibilityLabel(Text("garden.styles.locked"))
      }
    }
    .contentShape(Rectangle())
    .frame(minHeight: 58)
  }
}

private struct GardenStyleSwatch: View {
  let style: GardenRenderStyle

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 11, style: .continuous)
        .fill(style.background)
      Capsule()
        .fill(style.ground)
        .frame(width: 52, height: 13)
        .offset(y: 15)
      Capsule()
        .fill(style.trunk)
        .frame(width: 7, height: 25)
        .offset(y: 5)
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(style.foliage.opacity(0.94 - Double(index) * 0.08))
          .frame(width: 25, height: 22)
          .offset(x: CGFloat(index - 1) * 13, y: -9 + CGFloat(index % 2) * 3)
      }
    }
    .overlay {
      RoundedRectangle(cornerRadius: 11, style: .continuous)
        .stroke(
          .primary.opacity(style == .handDrawn ? 0.45 : 0.12),
          lineWidth: style == .handDrawn ? 1.5 : 0.7)
    }
  }
}

private struct PremiumGardenPaywallView: View {
  @Bindable var model: AppModel
  let requestedStyle: GardenRenderStyle?
  @Environment(\.dismiss) private var dismiss
  @Environment(\.locale) private var locale

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          GardenStyleSwatch(style: requestedStyle ?? .handDrawn)
            .frame(height: 190)
            .frame(maxWidth: .infinity)

          VStack(alignment: .leading, spacing: 8) {
            Text("garden.styles.paywall.title")
              .font(.largeTitle.bold())
            Text("garden.styles.paywall.body")
              .font(.title3)
              .foregroundStyle(.secondary)
          }

          VStack(alignment: .leading, spacing: 13) {
            ForEach(GardenRenderStyle.allCases.filter(\.isPremium)) { style in
              Label(style.titleKey, systemImage: style.symbolName)
                .font(.body.weight(.semibold))
            }
          }

          Button {
            Task {
              await model.purchasePremiumGardenStyles(selecting: requestedStyle)
              if model.premiumGardenAccess.isOwned { dismiss() }
            }
          } label: {
            Text(purchaseTitle)
              .frame(maxWidth: .infinity)
          }
          .prominentActionButton()
          .disabled(
            model.premiumGardenPurchaseIsInProgress
              || !model.premiumGardenAccess.productIsAvailable
          )
          .accessibilityIdentifier("garden.styles.paywall.purchase")

          Button("garden.styles.restore") {
            Task {
              await model.restorePremiumGardenStyles()
              if model.premiumGardenAccess.isOwned { dismiss() }
            }
          }
          .frame(maxWidth: .infinity)
          .disabled(model.premiumGardenPurchaseIsInProgress)

          Text("garden.styles.purchase.detail")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("garden.styles.paywall.navigation")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("common.cancel") { dismiss() }
        }
      }
    }
  }

  private var purchaseTitle: String {
    let price = model.premiumGardenAccess.displayPrice ?? PremiumGardenProduct.proposedUSDPrice
    return "\(AppLocalization.string("garden.styles.unlock", locale: locale)) · \(price)"
  }
}

extension GardenRenderStyle {
  fileprivate var titleKey: LocalizedStringKey {
    LocalizedStringKey("garden.styles.\(rawValue).title")
  }
  fileprivate var detailKey: LocalizedStringKey {
    LocalizedStringKey("garden.styles.\(rawValue).detail")
  }

  fileprivate var symbolName: String {
    switch self {
    case .twilight: "moon.stars"
    case .handDrawn: "pencil.and.scribble"
    case .stopMotion: "film.stack"
    case .crochet: "circle.grid.cross"
    case .claymation: "hand.raised.fingers.spread"
    }
  }

  fileprivate var background: Color {
    switch self {
    case .twilight: Color(red: 0.14, green: 0.18, blue: 0.32)
    case .handDrawn: Color(red: 0.86, green: 0.84, blue: 0.76)
    case .stopMotion: Color(red: 0.42, green: 0.49, blue: 0.53)
    case .crochet: Color(red: 0.49, green: 0.53, blue: 0.61)
    case .claymation: Color(red: 0.47, green: 0.54, blue: 0.59)
    }
  }

  fileprivate var foliage: Color {
    switch self {
    case .twilight: Color(red: 0.31, green: 0.44, blue: 0.4)
    case .handDrawn: Color(red: 0.39, green: 0.47, blue: 0.37)
    case .stopMotion: Color(red: 0.38, green: 0.47, blue: 0.33)
    case .crochet: Color(red: 0.41, green: 0.49, blue: 0.38)
    case .claymation: Color(red: 0.4, green: 0.46, blue: 0.36)
    }
  }

  fileprivate var ground: Color { foliage.opacity(0.72) }
  fileprivate var trunk: Color { Color(red: 0.37, green: 0.29, blue: 0.24) }
}

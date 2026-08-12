import SwiftUI
import UIKit

enum AppTheme {
  static let maximumReadableWidth: CGFloat = 680
  static let forest = Color(red: 0.08, green: 0.22, blue: 0.17)
  static let moss = Color(red: 0.26, green: 0.45, blue: 0.31)
  static let sage = Color(red: 0.55, green: 0.67, blue: 0.49)
  static let cream = Color(red: 0.96, green: 0.94, blue: 0.86)
  static let amber = Color(red: 0.86, green: 0.66, blue: 0.31)
  static let twilight = Color(red: 0.08, green: 0.10, blue: 0.24)
  static let twilightDeep = Color(red: 0.03, green: 0.04, blue: 0.12)

  static func accent(for colorScheme: ColorScheme) -> Color {
    colorScheme == .dark ? amber : forest
  }

  enum Spacing {
    static let compact: CGFloat = 8
    static let standard: CGFloat = 16
    static let generous: CGFloat = 24
    static let spacious: CGFloat = 36
  }

  enum Radius {
    static let compact: CGFloat = 12
    static let standard: CGFloat = 18
    static let generous: CGFloat = 24
  }

  enum Size {
    static let minimumTouchTarget: CGFloat = 44
    static let primaryMark: CGFloat = 118
  }

  enum Typography {
    static let display = Font.system(.largeTitle, design: .rounded, weight: .bold)
    static let screenTitle = Font.system(.title, design: .rounded, weight: .bold)
    static let sectionTitle = Font.system(.title2, design: .rounded, weight: .bold)
    static let supporting = Font.footnote
  }
}

enum AppMotion {
  enum Rhythm {
    static let instant: TimeInterval = 0
    static let quick: TimeInterval = 0.18
    static let gentle: TimeInterval = 0.42
    static let reveal: TimeInterval = 0.82
  }

  static func quick(reduceMotion: Bool) -> Animation? {
    reduceMotion ? nil : .easeInOut(duration: Rhythm.quick)
  }

  static func gentle(reduceMotion: Bool) -> Animation? {
    reduceMotion ? nil : .easeOut(duration: Rhythm.gentle)
  }

  static func reveal(reduceMotion: Bool) -> Animation? {
    reduceMotion ? .linear(duration: 0.12) : .spring(duration: Rhythm.reveal, bounce: 0.08)
  }
}

enum UITestAccessibilityOverrides {
  static var reduceMotion: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-test-reduce-motion")
    #else
      false
    #endif
  }

  static var reduceTransparency: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-test-reduce-transparency")
    #else
      false
    #endif
  }

  static var increasedContrast: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-test-increased-contrast")
    #else
      false
    #endif
  }
}

struct GardenBackdrop: View {
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    LinearGradient(
      colors: colors,
      startPoint: .top,
      endPoint: .bottom
    )
    .ignoresSafeArea()
  }

  private var colors: [Color] {
    if colorScheme == .dark {
      return [
        AppTheme.twilightDeep,
        AppTheme.twilight,
        Color(red: 0.05, green: 0.08, blue: 0.14),
      ]
    }
    return [
      Color(red: 0.82, green: 0.86, blue: 0.90),
      AppTheme.cream,
      Color(red: 0.37, green: 0.43, blue: 0.50),
    ]
  }
}

struct QuietCardModifier: ViewModifier {
  func body(content: Content) -> some View {
    content
      .padding(AppTheme.Spacing.standard)
      .background {
        AdaptiveRoundedSurface(cornerRadius: 24)
      }
  }
}

struct AdaptiveRoundedSurface: View {
  let cornerRadius: CGFloat
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
      .fill(Color(uiColor: .secondarySystemBackground))
      .overlay {
        if contrast == .increased || UITestAccessibilityOverrides.increasedContrast {
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .stroke(.primary.opacity(0.28), lineWidth: 1.5)
        }
      }
  }
}

struct AdaptiveRoundedMaterial: View {
  let cornerRadius: CGFloat
  let material: Material
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
      .fill(
        reduceTransparency || UITestAccessibilityOverrides.reduceTransparency
          ? AnyShapeStyle(Color(uiColor: .secondarySystemBackground))
          : AnyShapeStyle(material)
      )
      .overlay {
        if contrast == .increased || UITestAccessibilityOverrides.increasedContrast {
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .stroke(.primary.opacity(0.28), lineWidth: 1.5)
        }
      }
  }
}

struct AdaptiveCircleMaterial: View {
  let material: Material
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    Circle()
      .fill(
        reduceTransparency || UITestAccessibilityOverrides.reduceTransparency
          ? AnyShapeStyle(Color(uiColor: .secondarySystemBackground))
          : AnyShapeStyle(material)
      )
      .overlay {
        if contrast == .increased || UITestAccessibilityOverrides.increasedContrast {
          Circle().stroke(.primary.opacity(0.32), lineWidth: 1.5)
        }
      }
  }
}

private struct ProminentActionButtonModifier: ViewModifier {
  func body(content: Content) -> some View {
    content
      .buttonStyle(.borderedProminent)
      .tint(AppTheme.forest)
  }
}

private struct AccessibleSecondaryTextModifier: ViewModifier {
  @Environment(\.colorSchemeContrast) private var contrast

  @ViewBuilder
  func body(content: Content) -> some View {
    if contrast == .increased || UITestAccessibilityOverrides.increasedContrast {
      content.foregroundStyle(.primary)
    } else {
      content.foregroundStyle(.primary.opacity(0.9))
    }
  }
}

extension View {
  func quietCard() -> some View {
    modifier(QuietCardModifier())
  }

  func prominentActionButton() -> some View {
    modifier(ProminentActionButtonModifier())
  }

  func accessibleSecondaryText() -> some View {
    modifier(AccessibleSecondaryTextModifier())
  }
}
